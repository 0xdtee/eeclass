/**
 * 接课堂实时字幕后端服务(backend/)。
 *
 * 两种音源：
 *   · 本机声卡  —— 服务自己开麦（也能采系统声音，网课用）。只有坐在这台电脑前才有意义。
 *   · 浏览器麦克风 —— 手机/平板/别的电脑登录时用。页面拿 getUserMedia，
 *     降采样到 16k 单声道 Int16，通过 WebSocket 二进制帧推给服务。
 *
 * 注意：**浏览器只在 HTTPS 下给麦克风权限**，所以页面必须由服务同源托管
 * （https://<内网IP>:5901/app/...），不能用 http 开。
 *
 * 服务地址不写死：页面从服务托管时用 location.origin，
 * 开发时（Vite 3000 端口）回落到 https://localhost:5901。
 */
import { useCallback, useEffect, useRef, useState } from 'react';

/** 页面是不是由字幕服务自己托管的（手机访问就是这种） */
const servedByService =
  typeof window !== 'undefined' && window.location.pathname.startsWith('/app');

export const SERVICE_ORIGIN =
  typeof window === 'undefined'
    ? 'https://localhost:5901'
    : servedByService
      ? window.location.origin
      : 'https://localhost:5901';

const TOKEN_KEY = 'live_caption_token';

/** 令牌：优先取地址栏 ?token=，其次取上次存下的 */
export function getToken(): string {
  if (typeof window === 'undefined') return '';
  const q = new URLSearchParams(window.location.search).get('token');
  if (q) {
    localStorage.setItem(TOKEN_KEY, q);
    return q;
  }
  return localStorage.getItem(TOKEN_KEY) || '';
}

export function setToken(t: string) {
  localStorage.setItem(TOKEN_KEY, t.trim());
}

let _redirecting = false;
/** 令牌失效(接口返回 401/403):清掉令牌并回登录页(只跳一次,防循环)。 */
export function authFailed() {
  try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
  if (_redirecting || typeof window === 'undefined') return;
  if (window.location.pathname.endsWith('/login')) return;
  _redirecting = true;
  window.location.href = SERVICE_ORIGIN + '/app/login';
}

const CID_KEY = 'live_caption_cid';

/** 客户端标识：断线重连时服务端靠它找回同一路会话（不丢转写）。存本地，长期固定。 */
export function getCid(): string {
  if (typeof window === 'undefined') return '';
  let c = localStorage.getItem(CID_KEY);
  if (!c) {
    c = Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem(CID_KEY, c);
  }
  return c;
}

export interface CaptionLine {
  id: number;
  ts: string;
  start: number;
  end: number;
  speaker: string;
  speaker_id: number;
  text: string;
  kind: 'key' | 'define' | null;
  reasons: string[];
  new_para: boolean;
  aiFixed?: boolean;   // 被 AI 实时纠错改过
  translation?: string;   // 英文句的中文字幕(挂在下面)
}

export interface AudioDevice {
  id: string;
  name: string;
  api: string;
  kind: 'mic' | 'loopback';
  default: boolean;
  shaky?: boolean;
}

export interface SpeakerStat {
  id: number;
  name: string;
  seconds: number;
  utterances: number;
}

export interface LiveStatus {
  elapsed: number;
  level: number;
  backlog: number;
  rtf: number;
  lines: number;
  speakers: SpeakerStat[];
  dir?: string;
}

export interface AiSummary {
  summary: string;
  key_points: string[];
  formulas?: string[];
  exam_hints?: string[];
  questions?: string[];
  corrections?: string[];
}

export interface StartOptions {
  title?: string | null;
  device?: string | null;
  toWord?: boolean;
  onlyKey?: boolean;
  sensitivity?: 'std' | 'high' | 'max';
  courseId?: string | null;
  /** 识别模型:'sensevoice'/'paraformer'=整句;'stream'=流式(zipformer,边说边出字);'shanghainese'=上海话(wenet_ctc);'aliyun'=阿里云普通话;'aliyun_wu'=阿里云上海话 */
  model?: 'sensevoice' | 'paraformer' | 'stream' | 'shanghainese' | 'aliyun' | 'aliyun_wu';
  /** AI 实时纠错：出字后让 DeepSeek 异步改同音错字 */
  aiCorrect?: boolean;
  /** AI 智能分句:让 DeepSeek 按语意把 VAD 碎片合并成完整句(仅整句模式) */
  smartSeg?: boolean;
  /** 英文自动翻译:英文句下面加一行中文字幕 */
  translateEn?: boolean;
  /** 勾选的学科标签(高等数学/大学物理…),给 AI 纠错/翻译提供学科上下文 */
  subjects?: string[];
  /** 续录:接着这节已录过的课往下录(音频/转写接上),传它的 sid */
  appendSid?: string | null;
}

/** 拾音灵敏度。数字是在本机用真实课堂录音扫出来的，别随手改。 */
const SENS: Record<string, { threshold: number; exit_threshold: number; min_speech_ms: number }> = {
  std: { threshold: 0.5, exit_threshold: 0.35, min_speech_ms: 250 },
  high: { threshold: 0.35, exit_threshold: 0.22, min_speech_ms: 180 },
  max: { threshold: 0.3, exit_threshold: 0.2, min_speech_ms: 150 },
};

const EMPTY_STATUS: LiveStatus = {
  elapsed: 0, level: 0, backlog: 0, rtf: 0, lines: 0, speakers: [],
};

const TARGET_SR = 16000;

export function useLiveCaption() {
  const [connected, setConnected] = useState(false);
  const [authFailed, setAuthFailed] = useState(false);
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [starting, setStarting] = useState(false);
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [defaultDevice, setDefaultDevice] = useState<string | null>(null);
  const [lines, setLines] = useState<CaptionLine[]>([]);
  const [partial, setPartial] = useState('');
  const [status, setStatus] = useState<LiveStatus>(EMPTY_STATUS);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [lastDir, setLastDir] = useState('');
  const [liveSid, setLiveSid] = useState('');   // 正在录的这节课的目录名，拍板书要用
  const [micActive, setMicActive] = useState(false);
  const [deepseekReady, setDeepseekReady] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aliveRef = useRef(true);
  const micRef = useRef<{ ctx: AudioContext; stream: MediaStream; node: ScriptProcessorNode } | null>(null);
  // 断线重连恢复用：是否在录、录的哪个设备（浏览器麦要在恢复时重新开麦推流）
  const recordingRef = useRef(false);
  const deviceRef = useRef<string | null>(null);
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null);

  const send = useCallback((msg: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }, []);

  /* ---------- 浏览器麦克风 ---------- */
  const stopMic = useCallback(() => {
    const m = micRef.current;
    if (!m) return;
    try { m.node.disconnect(); } catch { /* 已经断了 */ }
    try { m.stream.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
    try { void m.ctx.close(); } catch { /* ignore */ }
    micRef.current = null;
    setMicActive(false);
  }, []);

  // 把一路 MediaStream(麦克风 or 系统声音)接到降采样→WS 推流管线上。
  const pipeStream = useCallback((stream: MediaStream) => {
    const Ctx: typeof AudioContext =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx({ sampleRate: TARGET_SR });
    const src = ctx.createMediaStreamSource(stream);
    // 用 ScriptProcessor 而不是 AudioWorklet：活儿很轻（降采样+转 Int16），
    // 但兼容性好太多，iOS Safari 上不用折腾。
    const node = ctx.createScriptProcessor(4096, 1, 1);
    const ratio = ctx.sampleRate / TARGET_SR;

    node.onaudioprocess = (e) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      const input = e.inputBuffer.getChannelData(0);
      const outLen = Math.floor(input.length / ratio);
      const pcm = new Int16Array(outLen);
      for (let i = 0; i < outLen; i++) {
        // 线性插值降采样，够用；音频质量瓶颈在手机麦克风不在这儿
        const pos = i * ratio;
        const i0 = Math.floor(pos);
        const frac = pos - i0;
        const s = input[i0] * (1 - frac) + (input[i0 + 1] ?? input[i0]) * frac;
        pcm[i] = Math.max(-1, Math.min(1, s)) * 32767;
      }
      ws.send(pcm.buffer);
    };
    src.connect(node);
    // 不接扬声器（会啸叫），但有些浏览器不接目的地就不跑，所以接一个静音增益
    const mute = ctx.createGain();
    mute.gain.value = 0;
    node.connect(mute);
    mute.connect(ctx.destination);

    micRef.current = { ctx, stream, node };
    setMicActive(true);
  }, []);

  const startMic = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error(
        '这个浏览器不给用麦克风。多半是页面不是用 https 打开的——' +
        '手机上必须用 https://<内网IP>:5901/app/course 这个地址。'
      );
    }
    // 直接要 16k，拿不到就自己降采样（Safari 会忽略这个参数）
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    pipeStream(stream);
  }, [pipeStream]);

  /* ---------- 本设备的“系统声音”（网课/播放的音频）：走屏幕共享抓音频 ---------- */
  const startSystemAudio = useCallback(async () => {
    // Safari / iOS（本质都是 WebKit）：getDisplayMedia 只给画面、从不给音频轨，
    // 采不到系统声音。先拦下来给清楚提示,别让用户白点。
    const ua = navigator.userAgent;
    const isIOS = /iPad|iPhone|iPod/.test(ua) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isChromium = /Chrome|CriOS|Edg|EdgiOS|OPR/.test(ua);
    const isSafariLike = isIOS || (/Apple/.test(navigator.vendor || '') && !isChromium);
    if (isSafariLike) {
      throw new Error(
        'Safari 不支持采集系统声音（这是 Safari 本身的限制,采不到)。请在电脑上改用 Chrome 或 Edge;' +
        '或改选「本设备的麦克风」,让电脑外放声音被麦克风采到。'
      );
    }
    const md = navigator.mediaDevices as (MediaDevices & {
      getDisplayMedia?: (c: MediaStreamConstraints) => Promise<MediaStream>;
    }) | undefined;
    if (!md?.getDisplayMedia) {
      throw new Error('这个浏览器不支持采集系统声音。请在电脑上用 Chrome 或 Edge（手机浏览器不行）。');
    }
    // 必须带 video:true，浏览器才会给“共享音频”的选项；音频轨才是我们要的。
    const stream = await md.getDisplayMedia({ video: true, audio: true });
    const audioTracks = stream.getAudioTracks();
    if (!audioTracks.length) {
      stream.getTracks().forEach((t) => t.stop());
      throw new Error(
        '没采到系统声音。共享时请勾选左下角的「分享系统音频 / 分享标签页音频」，' +
        '并选择「整个屏幕」或正在播放声音的那个标签页。'
      );
    }
    // 视频轨用不到，停掉省资源（音频轨继续）；用户点“停止共享”时自动停录。
    stream.getVideoTracks().forEach((t) => t.stop());
    audioTracks[0].addEventListener('ended', () => {
      setNotice('系统声音共享已停止');
      stopMic();
    });
    pipeStream(stream);
  }, [pipeStream, stopMic]);

  /* ---------- 屏幕常亮（防锁屏中断录音）---------- */
  const requestWakeLock = useCallback(async () => {
    try {
      const nav = navigator as unknown as {
        wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> };
      };
      if (nav.wakeLock && document.visibilityState === 'visible' && !wakeLockRef.current) {
        wakeLockRef.current = await nav.wakeLock.request('screen');
      }
    } catch {
      /* 不支持或被拒（如 iOS 低电量模式），忽略 */
    }
  }, []);

  const releaseWakeLock = useCallback(() => {
    try { void wakeLockRef.current?.release(); } catch { /* ignore */ }
    wakeLockRef.current = null;
  }, []);

  /* ---------- 与服务通信 ---------- */
  const connect = useCallback(() => {
    if (!aliveRef.current) return;
    const token = getToken();
    const params = new URLSearchParams();
    if (token) params.set('token', token);
    params.set('cid', getCid());       // 带上客户端标识，断线重连能恢复会话
    const wsUrl = SERVICE_ORIGIN.replace(/^http/, 'ws') + '/ws?' + params.toString();
    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl);
    } catch {
      retryRef.current = setTimeout(connect, 3000);
      return;
    }
    wsRef.current = ws;
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      setConnected(true);
      setAuthFailed(false);
      setError('');
      fetch(SERVICE_ORIGIN + '/health')
        .then((r) => r.json())
        .then((j) => setDeepseekReady(!!j.deepseek))
        .catch(() => undefined);
    };

    ws.onclose = (ev) => {
      setConnected(false);
      setRunning(false);
      setStarting(false);
      stopMic();
      // 令牌不对时服务直接 401，握手就没成功
      if (!ev.wasClean && ev.code === 1006 && getToken() === '') setAuthFailed(true);
      if (aliveRef.current) retryRef.current = setTimeout(connect, 3000);
    };

    ws.onerror = () => {
      setError(
        '连不上字幕服务。确认：① 电脑上的「课堂字幕」已启动；' +
        '② 手机和电脑在同一个 WiFi；③ 用的是 https 地址并已在浏览器里选「继续访问」信任证书。'
      );
    };

    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return;
      let m: Record<string, unknown> & { type?: string };
      try {
        m = JSON.parse(ev.data);
      } catch {
        return;
      }
      switch (m.type) {
        case 'hello':
          setDevices((m.devices as AudioDevice[]) || []);
          setDefaultDevice((m.default_device as string) ?? null);
          if (m.resumed) {
            // 断线重连，服务端那路会话还在录 → 恢复，**不清空已有字幕**
            setRunning(true);
            setStarting(false);
            if (m.sid) setLiveSid(m.sid as string);
            if (deviceRef.current === 'browser') {
              void startMic();   // 重新开麦推流
              setNotice('已恢复录制');
            } else if (deviceRef.current === 'browser-system') {
              // 系统声音要用户手势才能重开共享，没法自动恢复
              setNotice('网络已恢复。系统声音共享可能已中断,如没继续请重新点「开始录制」。');
            } else {
              setNotice('已恢复录制');
            }
          } else {
            setRunning(!!m.running);
          }
          break;
        case 'devices':
          setDevices((m.devices as AudioDevice[]) || []);
          break;
        case 'started':
          recordingRef.current = true;
          setRunning(true);
          setStarting(false);
          setPaused(false);
          setLines([]);
          setPartial('');
          setLastDir((m.dir as string) || '');
          setLiveSid((m.sid as string) || '');
          setNotice(`已开始录制：${m.name}`);
          break;
        case 'stopped':
          recordingRef.current = false;
          setRunning(false);
          setPaused(false);
          setPartial('');
          // 不清空 live 行:停止后先继续显示实时行,等存档全文(histLines)加载好再无缝替换,
          // 避免"内容先消失、过一会儿存档才出来"的空档延迟。viewLines 会在 histLines 到了自动切过去。
          stopMic();
          setLastDir((m.dir as string) || '');
          setLiveSid((m.sid as string) || '');
          setNotice(`已保存 ${(m.meta as { lines?: number })?.lines ?? 0} 句`);
          break;
        case 'line':
          setPartial('');
          setLines((prev) => [...prev, m as unknown as CaptionLine]);
          break;
        case 'line_update':
          // AI 纠错改好了某一句 → 替换文本;或手动标记 → 改 kind(重点/定义)
          setLines((prev) =>
            prev.map((l) =>
              l.id === m.id
                ? {
                    ...l,
                    ...(m.text != null ? { text: m.text as string, aiFixed: true } : {}),
                    ...(m.kind !== undefined ? { kind: m.kind as 'key' | 'define' | null } : {}),
                  }
                : l
            )
          );
          break;
        case 'line_translation':
          // 英文句翻好了 → 挂到那一句下面
          setLines((prev) =>
            prev.map((l) => (l.id === m.id ? { ...l, translation: m.text as string } : l))
          );
          break;
        case 'partial':
          setPartial((m.text as string) || '');
          break;
        case 'status':
          setRunning(!!m.running);
          setPaused(!!m.paused);
          if (m.running) {
            setStatus({
              elapsed: (m.elapsed as number) ?? 0,
              level: (m.level as number) ?? 0,
              backlog: (m.backlog as number) ?? 0,
              rtf: (m.rtf as number) ?? 0,
              lines: (m.lines as number) ?? 0,
              speakers: (m.speakers as SpeakerStat[]) ?? [],
              dir: m.dir as string,
            });
          }
          break;
        case 'renamed':
          setLines((prev) =>
            prev.map((l) => (l.speaker === m.old ? { ...l, speaker: m.name as string } : l))
          );
          setNotice(`「${m.old}」已改为「${m.name}」`);
          break;
        case 'notice':
          setNotice((m.msg as string) || '');
          break;
        case 'error':
          setError((m.msg as string) || '');
          setStarting(false);
          stopMic();
          break;
      }
    };
  }, [stopMic, startMic]);

  // connect 会随回调身份(startMic 等)变化;用 ref 存最新的,让下面的 WS effect 只建一次、不反复重连
  const connectRef = useRef(connect);
  useEffect(() => { connectRef.current = connect; }, [connect]);

  useEffect(() => {
    aliveRef.current = true;
    connectRef.current();
    return () => {
      aliveRef.current = false;
      if (retryRef.current) clearTimeout(retryRef.current);
      stopMic();
      wsRef.current?.close();
    };
    // 只在挂载/卸载建立/断开 WS —— 不因回调身份变化就反复关开;否则续录时正好赶上重连,
    // 会把刚点的 start 命令冲掉,导致要点两次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 录音时保持屏幕常亮（防锁屏中断）；停止即释放
  useEffect(() => {
    if (running) void requestWakeLock();
    else releaseWakeLock();
  }, [running, requestWakeLock, releaseWakeLock]);

  // 切后台系统会释放 wake lock，回前台且还在录时重新申请
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible' && recordingRef.current) void requestWakeLock();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [requestWakeLock]);

  const start = useCallback(
    async (opts: StartOptions = {}) => {
      setStarting(true);
      setError('');
      setLines([]);        // 立刻清空,别让"正在启动…"期间还显示上一节的字幕
      setPartial('');
      const useBrowserMic = opts.device === 'browser';
      const useBrowserSystem = opts.device === 'browser-system';
      try {
        if (useBrowserMic) await startMic();
        else if (useBrowserSystem) await startSystemAudio();
      } catch (e) {
        setStarting(false);
        setError(e instanceof Error ? e.message : String(e));
        return;
      }
      const dev = devices.find((d) => d.id === opts.device);
      deviceRef.current = opts.device ?? null;   // 记住音源，断线恢复时重新开麦要用
      // 模型选择:sensevoice/paraformer=整句;stream=流式 zipformer(边说边出字);
      // shanghainese=上海话(wenet_ctc,吴语识别,后端自动翻普通话字幕);
      // aliyun=阿里云普通话(aliyun_paraformer);aliyun_wu=阿里云上海话(aliyun_funasr,直接输出普通话)。默认 sensevoice。
      const model = opts.model ?? 'sensevoice';
      const streaming = model === 'stream';
      const backend =
        model === 'stream' ? 'zipformer'
        : model === 'shanghainese' ? 'wenet_ctc'
        : model === 'aliyun' ? 'aliyun_paraformer'
        : model === 'aliyun_wu' ? 'aliyun_funasr'
        : model;
      send({
        cmd: 'start',
        title: opts.title ?? null,
        device: opts.device ?? null,
        loopback: dev ? dev.kind === 'loopback' : false,
        to_word: !!opts.toWord,
        only_key: !!opts.onlyKey,
        course_id: opts.courseId ?? null,
        vad: SENS[opts.sensitivity ?? 'high'],
        backend,
        streaming,
        ai_correct: !!opts.aiCorrect,
        smart_seg: opts.smartSeg !== false,   // AI 智能分句(默认开)
        translate_en: opts.translateEn !== false,   // 英文自动翻译(默认开)
        subjects: opts.subjects ?? [],        // 勾选的学科标签
        append_sid: opts.appendSid ?? null,   // 续录:接着这节课往下录
      });
    },
    [devices, send, startMic, startSystemAudio]
  );

  const stop = useCallback(() => {
    recordingRef.current = false;   // 主动停止：别再触发断线恢复
    send({ cmd: 'stop' });
    stopMic();
  }, [send, stopMic]);

  const setPausedCmd = useCallback((v: boolean) => send({ cmd: 'pause', value: v }), [send]);
  const mark = useCallback(() => send({ cmd: 'mark' }), [send]);
  const rename = useCallback((id: number, name: string) => send({ cmd: 'rename', id, name }), [send]);

  /** 让 DeepSeek 整理这节课。key 在服务端，浏览器拿不到也不需要。
   *  不传 which 就用本次实时录到的内容；看历史课时把那节课的行传进来。 */
  const summarize = useCallback(
    async (title?: string, which?: { ts: string; speaker: string; text: string }[], sid?: string): Promise<AiSummary> => {
      const r = await fetch(SERVICE_ORIGIN + '/api/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Token': getToken() },
        // sid 让后端识别这节课的板书一并纳入总结
        body: JSON.stringify({ title, lines: which ?? lines, dir: lastDir || undefined, sid: sid || liveSid || undefined }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error((j as { error?: string }).error || `HTTP ${r.status}`);
      return j as AiSummary;
    },
    [lines, lastDir, liveSid]
  );

  return {
    connected, authFailed, running, paused, starting, micActive, deepseekReady,
    devices, defaultDevice, lines, partial, status, notice, error, lastDir, liveSid,
    start, stop, setPaused: setPausedCmd, mark, rename, summarize,
  };
}
