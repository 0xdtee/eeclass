/**
 * Real-time classroom caption hook — phone/tablet (ported from the working desktop implementation).
 * Browser mic → downsample to 16k mono Int16 → push to backend as binary WebSocket frames;
 * the backend pushes each transcribed sentence back via WebSocket text messages.
 * Server URL/token come from @/lib/api (same-origin deployments automatically use the current origin).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { getServerUrl, getToken, clearToken } from '@/lib/api';
import { getMicGain } from '@/lib/settings';

export { getServerUrl, getToken };

const CID_KEY = 'eeclass_cid';
/** Client identifier: on reconnect the backend uses it to recover the same session (no lost transcription). Stored locally and kept permanently. */
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
  new_para: boolean;
  aiFixed?: boolean;
  translation?: string;
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
  sensitivity?: 'std' | 'high' | 'max';
  model?: 'sensevoice' | 'paraformer' | 'stream' | 'aliyun' | 'aliyun_wu' | 'aliyun_multi';
  aiCorrect?: boolean;
  smartSeg?: boolean;
  /** Live translation: source (原文) and target (译文) language codes; off when equal */
  translateFrom?: string;
  translateTo?: string;
  subjects?: string[];
  appendSid?: string | null;
}

const SENS: Record<string, { threshold: number; exit_threshold: number; min_speech_ms: number }> = {
  std: { threshold: 0.5, exit_threshold: 0.35, min_speech_ms: 250 },
  high: { threshold: 0.35, exit_threshold: 0.22, min_speech_ms: 180 },
  max: { threshold: 0.3, exit_threshold: 0.2, min_speech_ms: 150 },
};

const EMPTY_STATUS: LiveStatus = { elapsed: 0, level: 0, backlog: 0, rtf: 0, lines: 0, speakers: [] };
const TARGET_SR = 16000;

function wsOrigin(): string {
  return getServerUrl().replace(/^http/, 'ws');
}

export function useLiveCaption() {
  const [connected, setConnected] = useState(false);
  const [authFailed, setAuthFailed] = useState(false);
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [starting, setStarting] = useState(false);
  const [lines, setLines] = useState<CaptionLine[]>([]);
  const [partial, setPartial] = useState('');
  const [status, setStatus] = useState<LiveStatus>(EMPTY_STATUS);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [lastDir, setLastDir] = useState('');
  const [liveSid, setLiveSid] = useState('');
  const [micActive, setMicActive] = useState(false);
  const [deepseekReady, setDeepseekReady] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aliveRef = useRef(true);
  const micRef = useRef<{ ctx: AudioContext; stream: MediaStream; node: ScriptProcessorNode } | null>(null);
  const recordingRef = useRef(false);
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null);

  const send = useCallback((msg: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }, []);

  /* ---------- Microphone capture ---------- */
  const stopMic = useCallback(() => {
    const m = micRef.current;
    if (!m) return;
    try { m.node.disconnect(); } catch { /* ignore */ }
    try { m.stream.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
    try { void m.ctx.close(); } catch { /* ignore */ }
    micRef.current = null;
    setMicActive(false);
  }, []);

  const startMic = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('当前浏览器无法使用麦克风。请通过 https 打开页面以获取麦克风权限。');
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    const Ctx: typeof AudioContext =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx({ sampleRate: TARGET_SR });
    const src = ctx.createMediaStreamSource(stream);
    const node = ctx.createScriptProcessor(4096, 1, 1);
    const ratio = ctx.sampleRate / TARGET_SR;
    // Mic sensitivity: read once when capture starts, multiply each sample by the gain (clamp to avoid clipping)
    const gain = getMicGain();
    node.onaudioprocess = (e) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      const input = e.inputBuffer.getChannelData(0);
      const outLen = Math.floor(input.length / ratio);
      const pcm = new Int16Array(outLen);
      for (let i = 0; i < outLen; i++) {
        const pos = i * ratio;
        const i0 = Math.floor(pos);
        const frac = pos - i0;
        const s = (input[i0] * (1 - frac) + (input[i0 + 1] ?? input[i0]) * frac) * gain;
        pcm[i] = Math.max(-1, Math.min(1, s)) * 32767;
      }
      ws.send(pcm.buffer);
    };
    src.connect(node);
    const mute = ctx.createGain();
    mute.gain.value = 0;
    node.connect(mute);
    mute.connect(ctx.destination);
    micRef.current = { ctx, stream, node };
    setMicActive(true);
  }, []);

  /* ---------- Keep screen awake (prevent lock-screen interruption) ---------- */
  const requestWakeLock = useCallback(async () => {
    try {
      const nav = navigator as unknown as {
        wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> };
      };
      if (nav.wakeLock && document.visibilityState === 'visible' && !wakeLockRef.current) {
        wakeLockRef.current = await nav.wakeLock.request('screen');
      }
    } catch { /* ignore */ }
  }, []);
  const releaseWakeLock = useCallback(() => {
    try { void wakeLockRef.current?.release(); } catch { /* ignore */ }
    wakeLockRef.current = null;
  }, []);

  /* ---------- WebSocket ---------- */
  const connect = useCallback(() => {
    if (!aliveRef.current) return;
    const token = getToken();
    const params = new URLSearchParams();
    if (token) params.set('token', token);
    params.set('cid', getCid());
    let ws: WebSocket;
    try {
      ws = new WebSocket(wsOrigin() + '/ws?' + params.toString());
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
      fetch(getServerUrl() + '/health').then((r) => r.json())
        .then((j) => setDeepseekReady(!!j.deepseek)).catch(() => undefined);
    };
    ws.onclose = (ev) => {
      setConnected(false); setRunning(false); setStarting(false);
      stopMic();
      if (!ev.wasClean && ev.code === 1006 && getToken() === '') { setAuthFailed(true); clearToken(); }
      if (aliveRef.current) retryRef.current = setTimeout(connect, 3000);
    };
    ws.onerror = () => setError('无法连接字幕服务。请确认后端已启动、使用 https 访问且证书已受信任。');

    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return;
      let m: Record<string, unknown> & { type?: string };
      try { m = JSON.parse(ev.data); } catch { return; }
      switch (m.type) {
        case 'hello':
          if (m.resumed) {
            setRunning(true); setStarting(false);
            if (m.sid) setLiveSid(m.sid as string);
            recordingRef.current = true;
            void startMic();
            setNotice('已恢复录制');
          } else {
            setRunning(!!m.running);
          }
          break;
        case 'started':
          recordingRef.current = true;
          setRunning(true); setStarting(false); setPaused(false);
          setLines([]); setPartial('');
          setLastDir((m.dir as string) || '');
          setLiveSid((m.sid as string) || '');
          setNotice('已开始录制');
          break;
        case 'stopped':
          recordingRef.current = false;
          setRunning(false); setPaused(false); setPartial(''); setLines([]);
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
          setLines((prev) => prev.map((l) => l.id === m.id ? {
            ...l,
            ...(m.text != null ? { text: m.text as string, aiFixed: true } : {}),
            ...(m.kind !== undefined ? { kind: m.kind as 'key' | 'define' | null } : {}),
          } : l));
          break;
        case 'line_translation':
          setLines((prev) => prev.map((l) => l.id === m.id ? { ...l, translation: m.text as string } : l));
          break;
        case 'partial':
          setPartial((m.text as string) || '');
          break;
        case 'status':
          setRunning(!!m.running); setPaused(!!m.paused);
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
          setLines((prev) => prev.map((l) => l.speaker === m.old ? { ...l, speaker: m.name as string } : l));
          setNotice(`「${m.old}」已改为「${m.name}」`);
          break;
        case 'notice': setNotice((m.msg as string) || ''); break;
        case 'error': setError((m.msg as string) || ''); setStarting(false); stopMic(); break;
      }
    };
  }, [stopMic, startMic]);

  useEffect(() => {
    aliveRef.current = true;
    connect();
    return () => {
      aliveRef.current = false;
      if (retryRef.current) clearTimeout(retryRef.current);
      stopMic();
      wsRef.current?.close();
    };
  }, [connect, stopMic]);

  useEffect(() => {
    if (running) void requestWakeLock(); else releaseWakeLock();
  }, [running, requestWakeLock, releaseWakeLock]);
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible' && recordingRef.current) void requestWakeLock(); };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [requestWakeLock]);

  const start = useCallback(async (opts: StartOptions = {}) => {
    setStarting(true); setError(''); setLines([]); setPartial('');
    try {
      await startMic();
    } catch (e) {
      setStarting(false); setError(e instanceof Error ? e.message : String(e)); return;
    }
    const model = opts.model ?? 'aliyun';
    // Map the picked model to a backend: cloud Mandarin/English, cloud dialects, cloud multilingual (Gummy), or a local model.
    const backend =
      model === 'stream' ? 'zipformer'
      : model === 'aliyun' ? 'aliyun_paraformer'
      : model === 'aliyun_wu' ? 'aliyun_funasr'
      : model === 'aliyun_multi' ? 'aliyun_gummy'
      : model;
    send({
      cmd: 'start',
      title: opts.title ?? null,
      device: 'browser',
      loopback: false,
      to_word: false,
      vad: SENS[opts.sensitivity ?? 'high'],
      backend,
      streaming: model === 'stream',
      ai_correct: !!opts.aiCorrect,
      smart_seg: opts.smartSeg !== false,
      translate_from: opts.translateFrom ?? 'en',   // live translation source (原文)
      translate_to: opts.translateTo ?? 'zh',       // live translation target (译文); off when equal
      subjects: opts.subjects ?? [],
      append_sid: opts.appendSid ?? null,
    });
  }, [send, startMic]);

  const stop = useCallback(() => {
    recordingRef.current = false;
    send({ cmd: 'stop' });
    stopMic();
  }, [send, stopMic]);

  const setPausedCmd = useCallback((v: boolean) => send({ cmd: 'pause', value: v }), [send]);
  const mark = useCallback(() => send({ cmd: 'mark' }), [send]);
  const rename = useCallback((id: number, name: string) => send({ cmd: 'rename', id, name }), [send]);

  const summarize = useCallback(
    async (title?: string, which?: { ts: string; speaker: string; text: string }[], sid?: string): Promise<AiSummary> => {
      const r = await fetch(getServerUrl() + '/api/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Token': getToken() },
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
    lines, partial, status, notice, error, lastDir, liveSid,
    start, stop, setPaused: setPausedCmd, mark, rename, summarize,
  };
}
