/**
 * Talks to the live-caption backend service (backend/).
 *
 * Two audio sources:
 *   · Local sound card —— the service opens the mic itself (can also capture system audio, for online classes). Only meaningful when sitting at this computer.
 *   · Browser microphone —— used when logging in from a phone/tablet/another computer. The page grabs getUserMedia,
 *     downsamples to 16k mono Int16, and pushes it to the service as WebSocket binary frames.
 *
 * Note: **browsers only grant mic permission over HTTPS**, so the page must be served same-origin by the service
 * (https://<intranet IP>:5901/app/...), not opened over http.
 *
 * The service address isn't hardcoded: when served by the service it uses location.origin,
 * during development (Vite on port 3000) it falls back to https://localhost:5901.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { t, getLang } from '@/lib/i18n';

/** Whether the page is served by the caption service itself (this is the case for phone access) */
const servedByService =
  typeof window !== 'undefined' && window.location.pathname.startsWith('/app');

export const SERVICE_ORIGIN =
  typeof window === 'undefined'
    ? 'https://localhost:5901'
    : servedByService
      ? window.location.origin
      : 'https://localhost:5901';

const TOKEN_KEY = 'live_caption_token';

/** Token: prefer the ?token= in the URL, otherwise use the one stored last time */
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
/** Token invalid (API returns 401/403): clear the token and go back to the login page (redirect once, to prevent loops). */
export function authFailed() {
  try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
  if (_redirecting || typeof window === 'undefined') return;
  if (window.location.pathname.endsWith('/login')) return;
  _redirecting = true;
  window.location.href = SERVICE_ORIGIN + '/app/login';
}

const CID_KEY = 'live_caption_cid';
const DEVICE_KEY = 'live_caption_device';   // remember the audio source so a full page reload can resume browser-mic streaming

function savedDevice(): string | null {
  try { return localStorage.getItem(DEVICE_KEY); } catch { return null; }
}

/** Client ID: on reconnect the server uses it to recover the same session (no lost transcription). Stored locally, fixed long-term. */
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
  aiFixed?: boolean;   // Modified by AI real-time correction
  translation?: string;   // Chinese subtitle for an English sentence (shown below it)
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
  /** Recognition model: 'sensevoice'/'paraformer'=full-sentence; 'stream'=streaming (zipformer, words appear as you speak); 'shanghainese'=Shanghainese (wenet_ctc); 'aliyun'=Aliyun Mandarin; 'aliyun_wu'=Aliyun Shanghainese */
  model?: 'sensevoice' | 'paraformer' | 'stream' | 'shanghainese' | 'aliyun' | 'aliyun_wu';
  /** AI real-time correction: after text appears, let DeepSeek asynchronously fix homophone typos */
  aiCorrect?: boolean;
  /** AI smart sentence segmentation: let DeepSeek merge VAD fragments into complete sentences by meaning (full-sentence mode only) */
  smartSeg?: boolean;
  /** Live translation subtitles: 'off' | 'en2zh' (English→Chinese) | 'zh2en' (Chinese→English) */
  translateMode?: 'off' | 'en2zh' | 'zh2en';
  /** Selected subject tags (Advanced Math/College Physics…), giving the AI correction/translation subject context */
  subjects?: string[];
  /** Continue recording: keep recording onto an already-recorded class (audio/transcript continue), pass its sid */
  appendSid?: string | null;
}

/** Pickup sensitivity. The numbers were swept locally using real classroom recordings, don't casually change them. */
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
  const [liveSid, setLiveSid] = useState('');   // Directory name of the class being recorded, needed for blackboard shots
  const [micActive, setMicActive] = useState(false);
  const [deepseekReady, setDeepseekReady] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aliveRef = useRef(true);
  const micRef = useRef<{ ctx: AudioContext; stream: MediaStream; node: ScriptProcessorNode } | null>(null);
  // For reconnect recovery: whether recording, and which device (browser mic must reopen and re-stream on recovery)
  const recordingRef = useRef(false);
  const deviceRef = useRef<string | null>(null);
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null);

  const send = useCallback((msg: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }, []);

  /* ---------- Browser microphone ---------- */
  const stopMic = useCallback(() => {
    const m = micRef.current;
    if (!m) return;
    try { m.node.disconnect(); } catch { /* already disconnected */ }
    try { m.stream.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
    try { void m.ctx.close(); } catch { /* ignore */ }
    micRef.current = null;
    setMicActive(false);
  }, []);

  // Wire a MediaStream (mic or system audio) into the downsample → WS streaming pipeline.
  const pipeStream = useCallback((stream: MediaStream) => {
    const Ctx: typeof AudioContext =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx({ sampleRate: TARGET_SR });
    const src = ctx.createMediaStreamSource(stream);
    // Use ScriptProcessor instead of AudioWorklet: the work is light (downsample + convert to Int16),
    // but compatibility is far better, no fuss on iOS Safari.
    const node = ctx.createScriptProcessor(4096, 1, 1);
    const ratio = ctx.sampleRate / TARGET_SR;

    node.onaudioprocess = (e) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      const input = e.inputBuffer.getChannelData(0);
      const outLen = Math.floor(input.length / ratio);
      const pcm = new Int16Array(outLen);
      for (let i = 0; i < outLen; i++) {
        // Linear-interpolation downsampling, good enough; the audio-quality bottleneck is the phone mic, not this
        const pos = i * ratio;
        const i0 = Math.floor(pos);
        const frac = pos - i0;
        const s = input[i0] * (1 - frac) + (input[i0 + 1] ?? input[i0]) * frac;
        pcm[i] = Math.max(-1, Math.min(1, s)) * 32767;
      }
      ws.send(pcm.buffer);
    };
    src.connect(node);
    // Don't connect to the speakers (would cause feedback), but some browsers won't run without a destination, so connect a muted gain
    const mute = ctx.createGain();
    mute.gain.value = 0;
    node.connect(mute);
    mute.connect(ctx.destination);

    micRef.current = { ctx, stream, node };
    setMicActive(true);
  }, []);

  const startMic = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error(t(
        '这个浏览器不给用麦克风。多半是页面不是用 https 打开的——' +
        '手机上必须用 https://<内网IP>:5901/app/course 这个地址。'
      ));
    }
    // Ask for 16k directly, and downsample ourselves if we can't get it (Safari ignores this parameter)
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    pipeStream(stream);
  }, [pipeStream]);

  /* ---------- This device's "system audio" (online classes/playing audio): capture audio via screen sharing ---------- */
  const startSystemAudio = useCallback(async () => {
    // Safari / iOS (both WebKit underneath): getDisplayMedia only gives video, never an audio track,
    // so system audio can't be captured. Intercept first and give a clear message, don't let the user click in vain.
    const ua = navigator.userAgent;
    const isIOS = /iPad|iPhone|iPod/.test(ua) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isChromium = /Chrome|CriOS|Edg|EdgiOS|OPR/.test(ua);
    const isSafariLike = isIOS || (/Apple/.test(navigator.vendor || '') && !isChromium);
    if (isSafariLike) {
      throw new Error(t(
        'Safari 不支持采集系统声音（这是 Safari 本身的限制,采不到)。请在电脑上改用 Chrome 或 Edge;' +
        '或改选「本设备的麦克风」,让电脑外放声音被麦克风采到。'
      ));
    }
    const md = navigator.mediaDevices as (MediaDevices & {
      getDisplayMedia?: (c: MediaStreamConstraints) => Promise<MediaStream>;
    }) | undefined;
    if (!md?.getDisplayMedia) {
      throw new Error(t('这个浏览器不支持采集系统声音。请在电脑上用 Chrome 或 Edge（手机浏览器不行）。'));
    }
    // Must pass video:true for the browser to offer the "share audio" option; the audio track is what we actually want.
    const stream = await md.getDisplayMedia({ video: true, audio: true });
    const audioTracks = stream.getAudioTracks();
    if (!audioTracks.length) {
      stream.getTracks().forEach((t) => t.stop());
      throw new Error(t(
        '没采到系统声音。共享时请勾选左下角的「分享系统音频 / 分享标签页音频」，' +
        '并选择「整个屏幕」或正在播放声音的那个标签页。'
      ));
    }
    // The video track is unused, stop it to save resources (audio track continues); recording auto-stops when the user clicks "stop sharing".
    stream.getVideoTracks().forEach((t) => t.stop());
    audioTracks[0].addEventListener('ended', () => {
      setNotice(t('系统声音共享已停止'));
      stopMic();
    });
    pipeStream(stream);
  }, [pipeStream, stopMic]);

  /* ---------- Keep screen awake (prevent lock-screen from interrupting recording) ---------- */
  const requestWakeLock = useCallback(async () => {
    try {
      const nav = navigator as unknown as {
        wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> };
      };
      if (nav.wakeLock && document.visibilityState === 'visible' && !wakeLockRef.current) {
        wakeLockRef.current = await nav.wakeLock.request('screen');
      }
    } catch {
      /* Unsupported or denied (e.g. iOS low-power mode), ignore */
    }
  }, []);

  const releaseWakeLock = useCallback(() => {
    try { void wakeLockRef.current?.release(); } catch { /* ignore */ }
    wakeLockRef.current = null;
  }, []);

  /* ---------- Communication with the service ---------- */
  const connect = useCallback(() => {
    if (!aliveRef.current) return;
    const token = getToken();
    const params = new URLSearchParams();
    if (token) params.set('token', token);
    params.set('cid', getCid());       // Include the client ID so reconnects can recover the session
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
      // When the token is wrong the service returns 401 outright, so the handshake never succeeded
      if (!ev.wasClean && ev.code === 1006 && getToken() === '') setAuthFailed(true);
      if (aliveRef.current) retryRef.current = setTimeout(connect, 3000);
    };

    ws.onerror = () => {
      setError(t(
        '连不上字幕服务。确认：① 电脑上的「课堂字幕」已启动；' +
        '② 手机和电脑在同一个 WiFi；③ 用的是 https 地址并已在浏览器里选「继续访问」信任证书。'
      ));
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
            // Reconnected, the server's session is still recording → resume, **don't clear existing captions**
            setRunning(true);
            setStarting(false);
            if (m.sid) setLiveSid(m.sid as string);
            // After a FULL page reload the in-memory deviceRef is null, so fall back to the persisted
            // choice -- otherwise a browser-mic recording silently stops streaming while the UI still
            // says "已恢复录制" and the rest of the class is lost.
            const dev = deviceRef.current ?? savedDevice();
            deviceRef.current = dev;
            if (dev === 'browser') {
              // reopen the mic and re-stream; if the browser blocks getUserMedia without a fresh gesture
              // (common on iOS after a reload), tell the user honestly instead of pretending it resumed.
              startMic()
                .then(() => setNotice(t('已恢复录制')))
                .catch(() => setNotice(t('麦克风未能自动恢复,请重新点「开始录制」继续录音。')));
            } else if (dev === 'browser-system') {
              // System audio needs a user gesture to reopen sharing, can't auto-resume
              setNotice(t('网络已恢复,但系统声音共享已中断,请重新点「开始录制」继续。'));
            } else {
              // server sound-card capture: the server records on its own, nothing to reopen in the browser
              setNotice(t('已恢复录制'));
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
          setNotice(t('已开始录制：{name}', { name: String(m.name) }));
          break;
        case 'stopped':
          recordingRef.current = false;
          setRunning(false);
          setPaused(false);
          setPartial('');
          // Don't clear the live lines: after stopping, keep showing the live lines, then seamlessly replace them once the archived full text (histLines) loads,
          // avoiding the gap delay of "content disappears first, archive shows up a moment later". viewLines auto-switches over once histLines arrives.
          stopMic();
          setLastDir((m.dir as string) || '');
          setLiveSid((m.sid as string) || '');
          setNotice(t('已保存 {n} 句', { n: (m.meta as { lines?: number })?.lines ?? 0 }));
          break;
        case 'line':
          setPartial('');
          setLines((prev) => [...prev, m as unknown as CaptionLine]);
          break;
        case 'line_update':
          // AI correction fixed a sentence → replace the text; or manual marking → change kind (key/definition)
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
          // An English sentence got translated → attach it below that sentence
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
          setNotice(t('「{old}」已改为「{name}」', { old: String(m.old), name: String(m.name) }));
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

  // connect changes with callback identity (startMic etc.); store the latest in a ref so the WS effect below builds only once, not reconnecting repeatedly
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
    // Only open/close the WS on mount/unmount —— don't repeatedly close and reopen on callback identity changes; otherwise a reconnect during continue-recording
    // would blow away the start command just clicked, forcing a second click.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the screen awake while recording (prevent lock-screen interruption); release on stop
  useEffect(() => {
    if (running) void requestWakeLock();
    else releaseWakeLock();
  }, [running, requestWakeLock, releaseWakeLock]);

  // Going to the background releases the wake lock; re-request it when returning to the foreground while still recording
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
      setLines([]);        // Clear immediately, don't keep showing the previous class's captions during "starting…"
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
      deviceRef.current = opts.device ?? null;   // Remember the audio source, needed to reopen the mic on reconnect recovery
      try { if (opts.device) localStorage.setItem(DEVICE_KEY, opts.device); } catch { /* ignore */ }   // survive a full page reload
      // Model selection: sensevoice/paraformer=full-sentence; stream=streaming zipformer (words appear as you speak);
      // shanghainese=Shanghainese (wenet_ctc, Wu recognition, backend auto-translates to Mandarin captions);
      // aliyun=Aliyun Mandarin (aliyun_paraformer); aliyun_wu=Aliyun Shanghainese (aliyun_funasr, outputs Mandarin directly). Defaults to sensevoice.
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
        smart_seg: opts.smartSeg !== false,   // AI smart sentence segmentation (on by default)
        translate_mode: opts.translateMode ?? 'en2zh',   // live translation direction (off / en2zh / zh2en)
        subjects: opts.subjects ?? [],        // Selected subject tags
        append_sid: opts.appendSid ?? null,   // Continue recording: keep recording onto this class
      });
    },
    [devices, send, startMic, startSystemAudio]
  );

  const stop = useCallback(() => {
    recordingRef.current = false;   // Deliberate stop: don't trigger reconnect recovery anymore
    send({ cmd: 'stop' });
    stopMic();
  }, [send, stopMic]);

  const setPausedCmd = useCallback((v: boolean) => send({ cmd: 'pause', value: v }), [send]);
  const mark = useCallback(() => send({ cmd: 'mark' }), [send]);
  const rename = useCallback((id: number, name: string) => send({ cmd: 'rename', id, name }), [send]);

  /** Let DeepSeek summarize this class. The key lives on the server; the browser can't get it and doesn't need to.
   *  Omit `which` to use the content recorded live this time; when viewing a past class, pass in that class's lines. */
  const summarize = useCallback(
    async (title?: string, which?: { ts: string; speaker: string; text: string }[], sid?: string): Promise<AiSummary> => {
      const r = await fetch(SERVICE_ORIGIN + '/api/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Token': getToken() },
        // sid lets the backend identify this class's blackboard shots and fold them into the summary
        body: JSON.stringify({ title, lines: which ?? lines, dir: lastDir || undefined, sid: sid || liveSid || undefined, lang: getLang() }),
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
