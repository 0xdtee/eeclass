/**
 * Standalone meeting translator (English <-> Chinese), built for projecting onto a big screen.
 *
 * Speak English -> shows Chinese; speak Chinese -> shows English. Text streams in real time (the
 * cloud Gummy model emits incremental translation as you talk), original and translation are the
 * same large size, and the layout runs full-width with a fullscreen toggle for screencasting.
 *
 * Tuned for in-person meetings (far-field room pickup): browser audio processing is OFF (noise
 * suppression / echo cancellation would eat distant, quiet speech), an adjustable gain boosts the
 * quiet room audio before it's sent, a live level meter shows whether sound is getting through, and
 * you can pick which microphone to use (e.g. an external conference mic).
 * Talks to the isolated /ws_meeting endpoint; shares nothing with the recording/session machinery.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useT, getLang } from '@/lib/i18n';
import { useAuth } from '@/hooks/useAuth';
import { SERVICE_ORIGIN, getToken } from '@/hooks/useLiveCaption';
import { exportPdf, exportPdfBatch, type PdfDoc } from '@/lib/exportPdf';
import FileLibrary from './FileLibrary';
import FileViewer, { type LibFile } from './FileViewer';
import {
  type MeetingSession, loadLocal, upsertLocal, removeLocal, syncOnLoad, saveServer, deleteServer,
} from './history';

interface Turn {
  id: number;
  original: string;
  src: string;                          // detected source language code
  translations: Record<string, string>; // lang code -> translated text (filled in as they arrive)
}

// The languages Gummy recognizes (matches the backend's SUPPORTED_LANGS). label = Chinese UI, en = English UI.
const LANGS: { code: string; label: string; en: string }[] = [
  { code: 'zh', label: '中文', en: 'Chinese' },
  { code: 'en', label: '英语', en: 'English' },
  { code: 'ja', label: '日语', en: 'Japanese' },
  { code: 'ko', label: '韩语', en: 'Korean' },
  { code: 'fr', label: '法语', en: 'French' },
  { code: 'de', label: '德语', en: 'German' },
  { code: 'es', label: '西班牙语', en: 'Spanish' },
  { code: 'it', label: '意大利语', en: 'Italian' },
  { code: 'ru', label: '俄语', en: 'Russian' },
];
const SHORT_ZH: Record<string, string> = { zh: '中', en: '英', ja: '日', ko: '韩', fr: '法', de: '德', es: '西', it: '意', ru: '俄', xx: '外' };
const SHORT_EN: Record<string, string> = { zh: 'ZH', en: 'EN', ja: 'JA', ko: 'KO', fr: 'FR', de: 'DE', es: 'ES', it: 'IT', ru: 'RU', xx: '?' };
const LANGS_KEY = 'meeting_langs';
const LAYOUT_KEY = 'meeting_layout';   // 'stack' (each sentence's languages stacked) | 'columns' (one column per language)
const MAX_LANGS = 3;   // each selected language runs its own Gummy realtime stream
const FONT_KEY = 'meeting_fontscale';
const FONT_MIN = 50;
const FONT_MAX = 300;
const clampFont = (n: number) => Math.max(FONT_MIN, Math.min(FONT_MAX, Math.round(n)));

interface Minutes {
  title: string;
  summary: string;
  points: string[];
  decisions: string[];
  todos: { task: string; owner?: string }[];
}

const TARGET_SR = 16000;
const GAIN_KEY = 'meeting_gain';
const DEV_KEY = 'meeting_mic';

export default function MeetingPage() {
  const t = useT();
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const { isAuthenticated, loading: authLoading } = useAuth();
  const [connected, setConnected] = useState(false);
  const [running, setRunning] = useState(false);
  const [starting, setStarting] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [partial, setPartial] = useState<Turn | null>(null);
  const [error, setError] = useState('');
  const [isFull, setIsFull] = useState(false);
  const [minutes, setMinutes] = useState<Minutes | null>(null);
  const [minutesLoading, setMinutesLoading] = useState(false);
  const [showMinutes, setShowMinutes] = useState(false);
  const [minutesLang, setMinutesLang] = useState('');   // language code the minutes are shown in
  const [exporting, setExporting] = useState(false);     // exporting minutes PDF(s)
  const [showExport, setShowExport] = useState(false);   // PDF export language picker
  const [exportLangs, setExportLangs] = useState<string[]>([]);   // languages chosen for PDF export
  const [showLibrary, setShowLibrary] = useState(false);   // file-library panel
  const [boxFile, setBoxFile] = useState<LibFile | null>(null);   // file currently shown in the display box
  const [stripPx, setStripPx] = useState<number>(() => {   // subtitle-strip height (px) above the file box; 0 = default
    try { return Number(localStorage.getItem('meeting_strip')) || 0; } catch { return 0; }
  });
  const boxWrapRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);
  const [barCollapsed, setBarCollapsed] = useState<boolean>(() => {   // collapse the settings row to enlarge the caption area
    try { return localStorage.getItem('meeting_barcollapsed') === '1'; } catch { return false; }
  });
  const toggleBar = () => setBarCollapsed((v) => {
    const n = !v;
    try { localStorage.setItem('meeting_barcollapsed', n ? '1' : '0'); } catch { /* ignore */ }
    return n;
  });
  const [copied, setCopied] = useState(false);
  const [history, setHistory] = useState<MeetingSession[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [micId, setMicId] = useState<string>(() => {
    try { return localStorage.getItem(DEV_KEY) || ''; } catch { return ''; }
  });
  const [gain, setGain] = useState<number>(() => {
    try { return Number(localStorage.getItem(GAIN_KEY)) || 2.5; } catch { return 2.5; }
  });
  const [selectedLangs, setSelectedLangs] = useState<string[]>(() => {
    try {
      const a = JSON.parse(localStorage.getItem(LANGS_KEY) || 'null');
      if (Array.isArray(a) && a.length) return a;
    } catch { /* ignore */ }
    return ['zh', 'en'];
  });
  const [showLangs, setShowLangs] = useState(false);
  const [fontScale, setFontScale] = useState<number>(() => {
    try { return clampFont(Number(localStorage.getItem(FONT_KEY)) || 100); } catch { return 100; }
  });
  const [fontInput, setFontInput] = useState(() => String(fontScale));   // raw text in the size box
  const [layout, setLayout] = useState<'stack' | 'columns'>(() => {
    try { return localStorage.getItem(LAYOUT_KEY) === 'columns' ? 'columns' : 'stack'; } catch { return 'stack'; }
  });
  const toggleLayout = useCallback(() => {
    setLayout((prev) => {
      const next = prev === 'stack' ? 'columns' : 'stack';
      try { localStorage.setItem(LAYOUT_KEY, next); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const wsRef = useRef<WebSocket | null>(null);
  const micRef = useRef<{ ctx: AudioContext; stream: MediaStream; node: ScriptProcessorNode } | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const levelBarRef = useRef<HTMLDivElement | null>(null);
  const aliveRef = useRef(true);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const colRefs = useRef<Record<string, HTMLDivElement | null>>({});   // per-language column scrollers (columns view)
  const rootRef = useRef<HTMLDivElement | null>(null);
  const turnsRef = useRef<Turn[]>([]);   // latest turns, for generating minutes from stop()
  const sessionIdRef = useRef<string | null>(null);   // id of the meeting currently being recorded/viewed
  const createdRef = useRef<number>(0);               // its creation time (stable across minutes regen)
  const openedRef = useRef(false);                    // guard: auto-open a ?open= session only once
  const startingRef = useRef(false);                  // guard against double-start before state updates

  /* ---------- WebSocket ---------- */
  const connect = useCallback(() => {
    if (!aliveRef.current) return;
    const params = new URLSearchParams();
    const token = getToken();
    if (token) params.set('token', token);
    const url = SERVICE_ORIGIN.replace(/^http/, 'ws') + '/ws_meeting?' + params.toString();
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      setTimeout(connect, 3000);
      return;
    }
    wsRef.current = ws;
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => { setConnected(true); setError(''); };
    ws.onclose = () => {
      setConnected(false);
      setRunning(false);
      setStarting(false);
      startingRef.current = false;
      if (aliveRef.current) setTimeout(connect, 3000);
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return;
      let m: Record<string, unknown> & { type?: string };
      try { m = JSON.parse(ev.data); } catch { return; }
      switch (m.type) {
        case 'started': startingRef.current = false; setRunning(true); setStarting(false); break;
        case 'stopped': startingRef.current = false; setRunning(false); setPartial(null); break;
        case 'partial':
          setPartial({
            id: -1,
            original: (m.original as string) || '',
            src: (m.src as string) || '',
            translations: (m.translations as Record<string, string>) || {},
          });
          break;
        case 'line':
          setPartial(null);
          setTurns((prev) => [...prev, {
            id: (m.id as number) ?? Date.now(),
            original: (m.original as string) || '',
            src: (m.src as string) || '',
            translations: (m.translations as Record<string, string>) || {},
          }]);
          break;
        case 'line_update': {
          // A translation into one language arrived for an already-shown line -> fill it in.
          const uid = m.id as number;
          const lang = (m.lang as string) || '';
          const text = (m.translation as string) || '';
          setTurns((prev) => prev.map((l) =>
            l.id === uid ? { ...l, translations: { ...l.translations, [lang]: text } } : l));
          break;
        }
        case 'line_correct': {
          // DeepSeek re-translated the finalized line: swap in the aligned, cleaned translations across all
          // selected languages (and the corrected source), replacing the rough real-time Gummy output.
          const cid = m.id as number;
          const ctr = (m.translations as Record<string, string>) || {};
          const csrc = (m.src as string) || '';
          setTurns((prev) => prev.map((l) =>
            l.id === cid ? {
              ...l,
              src: csrc || l.src,
              original: csrc && ctr[csrc] ? ctr[csrc] : l.original,
              translations: { ...l.translations, ...ctr },
            } : l));
          break;
        }
        case 'error': setError((m.msg as string) || ''); setStarting(false); startingRef.current = false; break;
      }
    };
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    connect();
    // Enumerate mics (labels fill in once permission is granted, e.g. after the first Start)
    navigator.mediaDevices?.enumerateDevices?.()
      .then((ds) => setMics(ds.filter((d) => d.kind === 'audioinput')))
      .catch(() => undefined);
    return () => {
      aliveRef.current = false;
      try { wsRef.current?.close(); } catch { /* ignore */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { turnsRef.current = turns; }, [turns]);

  // Pin the caption view to its newest line (bottom-aligned). Runs as a layout effect so it measures the
  // final scrollHeight, re-pins on the next frame (after fonts/wrapping settle), and also re-runs when the
  // file box opens/resizes (boxFile/stripPx) — otherwise the strip shrinks and the newest line gets clipped.
  useLayoutEffect(() => {
    const pin = () => {
      if (layout === 'columns') {
        for (const el of Object.values(colRefs.current)) {
          if (el) el.scrollTop = el.scrollHeight;
        }
      } else {
        const el = scrollRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      }
    };
    pin();
    const r = requestAnimationFrame(pin);
    return () => cancelAnimationFrame(r);
  }, [turns, partial, layout, boxFile, stripPx, fontScale, barCollapsed]);

  // Track fullscreen state (Esc etc. can exit it outside our button)
  useEffect(() => {
    const onFs = () => setIsFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  // Load history; once auth is resolved, logged-in users pull the account's history and inherit any
  // local-only meetings into it. Not-logged-in users just see this browser's local history.
  useEffect(() => {
    if (authLoading) { setHistory(loadLocal()); return; }
    let cancelled = false;
    syncOnLoad(isAuthenticated)
      .then((list) => { if (!cancelled) setHistory(list); })
      .catch(() => { if (!cancelled) setHistory(loadLocal()); });
    return () => { cancelled = true; };
  }, [isAuthenticated, authLoading]);

  // Live gain: update the running graph immediately when the slider moves
  useEffect(() => {
    if (gainNodeRef.current) gainNodeRef.current.gain.value = gain;
    try { localStorage.setItem(GAIN_KEY, String(gain)); } catch { /* ignore */ }
  }, [gain]);

  useEffect(() => {
    try { localStorage.setItem(LANGS_KEY, JSON.stringify(selectedLangs)); } catch { /* ignore */ }
  }, [selectedLangs]);

  // Caption font size (Word-style zoom). Buttons step by 10%; the box commits on Enter/blur.
  const applyFont = useCallback((n: number) => {
    const v = clampFont(n);
    setFontScale(v);
    setFontInput(String(v));
    try { localStorage.setItem(FONT_KEY, String(v)); } catch { /* ignore */ }
  }, []);
  const commitFont = useCallback(() => {
    const n = parseInt(fontInput, 10);
    if (Number.isFinite(n)) applyFont(n);
    else setFontInput(String(fontScale));
  }, [fontInput, fontScale, applyFont]);

  const toggleLang = useCallback((code: string) => {
    setSelectedLangs((prev) => {
      if (prev.includes(code)) return prev.length > 1 ? prev.filter((c) => c !== code) : prev;  // keep ≥1
      return prev.length >= MAX_LANGS ? prev : [...prev, code];                                 // cap at MAX_LANGS
    });
  }, []);

  const langChip = (code: string) => (getLang() === 'en' ? SHORT_EN : SHORT_ZH)[code] || code.toUpperCase();

  // Draggable divider between the subtitle strip and the file box (columns view / stack view alike).
  const onDividerDown = useCallback((e: React.PointerEvent) => { e.preventDefault(); draggingRef.current = true; }, []);
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!draggingRef.current) return;
      const wrap = boxWrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      setStripPx(Math.max(80, Math.min(rect.height - 140, e.clientY - rect.top)));
    };
    const onUp = () => { draggingRef.current = false; };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
  }, []);
  useEffect(() => {
    if (stripPx > 0) { try { localStorage.setItem('meeting_strip', String(stripPx)); } catch { /* ignore */ } }
  }, [stripPx]);

  const toggleFull = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void rootRef.current?.requestFullscreen?.();
  }, []);

  /* ---------- Microphone -> gain -> 16k Int16 -> WS ---------- */
  const stopMeter = useCallback(() => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (levelBarRef.current) levelBarRef.current.style.width = '0%';
  }, []);

  const stopMic = useCallback(() => {
    stopMeter();
    const m = micRef.current;
    if (!m) return;
    try { m.node.disconnect(); } catch { /* ignore */ }
    try { m.stream.getTracks().forEach((tk) => tk.stop()); } catch { /* ignore */ }
    try { void m.ctx.close(); } catch { /* ignore */ }
    micRef.current = null;
    gainNodeRef.current = null;
    analyserRef.current = null;
  }, [stopMeter]);

  const runMeter = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) return;
    const buf = new Uint8Array(analyser.fftSize);
    const tick = () => {
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = (buf[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / buf.length);
      // map RMS (post-gain) to a 0-100% bar; ~0.3 RMS already reads as "loud"
      const pct = Math.min(100, Math.round((rms / 0.3) * 100));
      if (levelBarRef.current) levelBarRef.current.style.width = pct + '%';
      rafRef.current = requestAnimationFrame(tick);
    };
    tick();
  }, []);

  const startMic = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error(t('这个浏览器不给用麦克风。请用 https 地址打开本页面。'));
    }
    stopMic();   // tear down any leftover pipeline first -- two live pipelines would double the audio
                 // sent to the server, which the recognizer hears as doubled/repeated words.
    // Far-field pickup: keep the browser's own DSP OFF (noise suppression / echo cancellation /
    // auto gain would swallow distant, quiet speech); we do our own boost with a GainNode below.
    const audio: MediaTrackConstraints = {
      channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false,
    };
    if (micId) audio.deviceId = { exact: micId };
    const stream = await navigator.mediaDevices.getUserMedia({ audio });
    const Ctx: typeof AudioContext =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx({ sampleRate: TARGET_SR });
    // The context is created after `await getUserMedia`, i.e. outside the click gesture, so browsers may
    // start it suspended -> onaudioprocess never fires and no audio is sent (looked like "started but not
    // recording, needs a second try"). Resume it so audio flows on the first click.
    if (ctx.state === 'suspended') { try { await ctx.resume(); } catch { /* ignore */ } }
    const src = ctx.createMediaStreamSource(stream);
    const gainNode = ctx.createGain();
    gainNode.gain.value = gain;
    gainNodeRef.current = gainNode;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyserRef.current = analyser;
    const node = ctx.createScriptProcessor(2048, 1, 1);
    const ratio = ctx.sampleRate / TARGET_SR;
    node.onaudioprocess = (e) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      const input = e.inputBuffer.getChannelData(0);   // already gain-boosted
      const outLen = Math.floor(input.length / ratio);
      const pcm = new Int16Array(outLen);
      for (let i = 0; i < outLen; i++) {
        const pos = i * ratio;
        const i0 = Math.floor(pos);
        const frac = pos - i0;
        const s = input[i0] * (1 - frac) + (input[i0 + 1] ?? input[i0]) * frac;
        pcm[i] = Math.max(-1, Math.min(1, s)) * 32767;
      }
      ws.send(pcm.buffer);
    };
    // source -> gain -> (analyser tap) + (processor -> muted destination)
    src.connect(gainNode);
    gainNode.connect(analyser);
    gainNode.connect(node);
    const mute = ctx.createGain();
    mute.gain.value = 0;
    node.connect(mute);
    mute.connect(ctx.destination);
    micRef.current = { ctx, stream, node };
    runMeter();
    // Now that permission is granted, refresh the device labels
    navigator.mediaDevices.enumerateDevices()
      .then((ds) => setMics(ds.filter((d) => d.kind === 'audioinput')))
      .catch(() => undefined);
  }, [t, micId, gain, runMeter, stopMic]);

  // continueSession=true: keep the loaded meeting on screen and append to it (same history entry).
  // Otherwise start a fresh meeting: clear the view and open a new history entry.
  const start = useCallback(async (continueSession = false) => {
    if (startingRef.current || running) return;   // ignore rapid double-clicks
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setError(t('连接尚未就绪,请稍候重试'));
      return;
    }
    startingRef.current = true;
    setError('');
    setStarting(true);
    setPartial(null);
    if (continueSession && sessionIdRef.current) {
      // keep turns, keep sessionIdRef/createdRef -> new lines append to this same meeting
    } else {
      setTurns([]);
      setMinutes(null);
      sessionIdRef.current = 'm' + Date.now();
      createdRef.current = Date.now();
    }
    try {
      await startMic();
    } catch (e) {
      startingRef.current = false;
      setStarting(false);
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    try {
      wsRef.current?.send(JSON.stringify({ cmd: 'start', langs: selectedLangs }));
    } catch {
      startingRef.current = false;
      setStarting(false);
      stopMic();
      setError(t('连接已断开,请重试'));
    }
  }, [startMic, stopMic, selectedLangs, running, t]);

  /* ---------- History persistence ---------- */
  // Save (or update) the current meeting into history: always local; also to the server when logged in.
  const persistSession = useCallback((data: Turn[], mins: Minutes | null) => {
    if (!data.length || !sessionIdRef.current) return;
    const firstText = data.find((d) => d.original)?.original || '';
    const created = createdRef.current || Date.now();
    const title = (mins?.title) || firstText.slice(0, 30) ||
      t('会议 {d}', { d: new Date(created).toLocaleString() });
    const session: MeetingSession = { id: sessionIdRef.current, created, title, turns: data, minutes: mins };
    const localMerged = upsertLocal(session);
    if (isAuthenticated) {
      saveServer([session]).then(setHistory).catch(() => setHistory(localMerged));
    } else {
      setHistory(localMerged);
    }
  }, [isAuthenticated, t]);

  /* ---------- Meeting minutes (DeepSeek) ---------- */
  // Fetch minutes for a specific language code (zh/en/ja/ko/...) without touching UI state.
  const fetchMinutes = useCallback(async (data: Turn[], lang: string): Promise<Minutes> => {
    const res = await fetch(SERVICE_ORIGIN + '/api/meeting/minutes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Token': getToken() },
      body: JSON.stringify({ turns: data, lang }),
    });
    const j = await res.json();
    if (!res.ok) throw new Error((j as { error?: string }).error || `HTTP ${res.status}`);
    return j as Minutes;
  }, []);

  const generateMinutes = useCallback(async (langArg?: string) => {
    const data = turnsRef.current;
    if (!data.length) return;
    // Default the minutes language to the first recorded language (or the UI language).
    const uiCode = getLang() === 'en' ? 'en' : 'zh';
    const lang = langArg || minutesLang || (selectedLangs.includes(uiCode) ? uiCode : selectedLangs[0]) || 'zh';
    setMinutesLang(lang);
    setShowMinutes(true);
    setMinutesLoading(true);
    setMinutes(null);
    setError('');
    let result: Minutes | null = null;
    try {
      result = await fetchMinutes(data, lang);
      setMinutes(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setShowMinutes(false);
    } finally {
      setMinutesLoading(false);
      persistSession(turnsRef.current.length ? turnsRef.current : data, result);
    }
  }, [minutesLang, selectedLangs, fetchMinutes, persistSession]);

  // Export the minutes as PDF(s) -- one per chosen language, same PDF renderer as the class exports.
  const exportMinutesPdf = useCallback(async (langs: string[]) => {
    const data = turnsRef.current;
    if (!data.length || !langs.length) return;
    setExporting(true);
    setError('');
    try {
      const docs: PdfDoc[] = [];
      for (const lang of langs) {
        const m = await fetchMinutes(data, lang);
        const label = langChip(lang);
        const points = [
          ...(m.points || []),
          ...(m.decisions || []).map((d) => `【${t('决定事项')}】${d}`),
          ...(m.todos || []).map((td) => `【${t('待办事项')}】${td.task}${td.owner ? `（${td.owner}）` : ''}`),
        ];
        docs.push({
          title: `${m.title || t('会议纪要')}（${label}）`,
          subtitle: new Date(createdRef.current || Date.now()).toLocaleString(),
          summary: m.summary || undefined,
          keyPoints: points,
        });
      }
      await exportPdfBatch(docs, t('会议纪要'));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  }, [fetchMinutes, t]);

  const stop = useCallback(() => {
    wsRef.current?.send(JSON.stringify({ cmd: 'stop' }));
    stopMic();
    setRunning(false);
    // Fix this meeting's identity now, so minutes (and any regenerate) attach to the same history entry.
    if (!sessionIdRef.current) { sessionIdRef.current = 'm' + Date.now(); createdRef.current = Date.now(); }
    // Give the last finalized sentence a moment to arrive, then auto-generate the minutes + save.
    window.setTimeout(() => { void generateMinutes(); }, 900);
  }, [stopMic, generateMinutes]);

  const openSession = useCallback((s: MeetingSession) => {
    // Normalize: old saved turns carry {translation, tgt}; new ones carry a translations map.
    const norm: Turn[] = (s.turns || []).map((tn) => ({
      id: tn.id,
      original: tn.original,
      src: tn.src || '',
      translations: tn.translations || (tn.tgt && tn.translation ? { [tn.tgt]: tn.translation } : {}),
    }));
    setTurns(norm);
    setPartial(null);
    setMinutes(s.minutes || null);
    sessionIdRef.current = s.id;
    createdRef.current = s.created;
    setShowHistory(false);
  }, []);

  const deleteSession = useCallback((id: string) => {
    removeLocal(id);
    if (isAuthenticated) deleteServer(id).catch(() => undefined);
    setHistory((prev) => prev.filter((s) => s.id !== id));
    if (sessionIdRef.current === id) sessionIdRef.current = null;
  }, [isAuthenticated]);

  // Opened from the calendar (?open=<id>): once history is loaded, show that meeting.
  useEffect(() => {
    const openId = sp.get('open');
    if (!openId || openedRef.current) return;
    const s = history.find((h) => h.id === openId);
    if (s) { openedRef.current = true; openSession(s); }
  }, [sp, history, openSession]);

  const copyMinutes = useCallback(() => {
    if (!minutes) return;
    const L: string[] = [];
    if (minutes.title) L.push(minutes.title, '');
    if (minutes.summary) L.push(minutes.summary, '');
    if (minutes.points?.length) { L.push(t('讨论要点')); minutes.points.forEach((p) => L.push('· ' + p)); L.push(''); }
    if (minutes.decisions?.length) { L.push(t('决定事项')); minutes.decisions.forEach((d) => L.push('· ' + d)); L.push(''); }
    if (minutes.todos?.length) {
      L.push(t('待办事项'));
      minutes.todos.forEach((td) => L.push('· ' + td.task + (td.owner ? `（${td.owner}）` : '')));
    }
    void navigator.clipboard?.writeText(L.join('\n').trim());
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }, [minutes, t]);

  const clear = useCallback(() => {
    setTurns([]); setPartial(null); setMinutes(null); sessionIdRef.current = null;
  }, []);

  // Short language labels for the direction badge. Mapped explicitly per UI language (not via t(),
  // since single chars like 「日」 collide with unrelated keys e.g. the calendar's Sunday).
  // One caption block: the spoken original, then one line per selected target language (all the SAME
  // large size). Skip a language only when it's the detected source and has no translation of its own.
  const Caption = ({ turn, live }: { turn: Turn; live?: boolean }) => {
    const tr = turn.translations || {};
    // Only show a subtitle row for languages that actually have a translation. The spoken (source)
    // language is suppressed server-side, so it has none -- and thus never gets its own row here.
    const rows = selectedLangs.filter((code) => tr[code]);
    return (
      <div className={`py-3 border-b border-background-200/60 ${live ? 'opacity-95' : ''}`}>
        <div className="flex items-center gap-2 mb-1.5">
          {turn.src && (
            <span className="text-xs lg:text-sm font-bold px-2 py-0.5 rounded bg-background-200 text-foreground-500">
              {langChip(turn.src)}
            </span>
          )}
          {live && (
            <span className="flex items-center gap-1 text-xs lg:text-sm text-accent-500">
              <i className="ri-loader-4-line animate-spin"></i>{t('实时')}
            </span>
          )}
        </div>
        <p className="leading-snug text-foreground-500" style={{ fontSize: '1em' }}>{turn.original}</p>
        {rows.map((code) => (
          <p key={code} className="leading-snug font-semibold text-foreground-900 mt-1 flex items-baseline gap-2" style={{ fontSize: '1em' }}>
            <span className="text-xs lg:text-sm font-bold px-1.5 py-0.5 rounded bg-accent-100 text-accent-600 self-center flex-shrink-0">
              {langChip(code)}
            </span>
            <span>{tr[code]}</span>
          </p>
        ))}
      </div>
    );
  };

  // The subtitle body (empty-state / stacked / columns). Reused full-size, or compressed into a strip
  // above the slide viewer when a deck is imported.
  const captionsInner = turns.length === 0 && !partial ? (
    <div className="h-full flex flex-col items-center justify-center text-center text-foreground-300">
      <i className="ri-mic-line text-6xl mb-3"></i>
      <p className="text-xl lg:text-2xl">{t('点右上角「开始」,然后开始说话')}</p>
      <p className="text-sm lg:text-base mt-2 text-foreground-300">
        {t('先在「字幕语言」里勾选参会语言:说其中一种,其余语言会作为字幕出现')}
      </p>
    </div>
  ) : layout === 'stack' ? (
    <div className="mx-auto max-w-7xl" style={{ fontSize: `calc(clamp(1.5rem, 2.4vw, 2.25rem) * ${fontScale / 100})` }}>
      {turns.map((turn) => <Caption key={turn.id} turn={turn} />)}
      {partial && <Caption turn={partial} live />}
    </div>
  ) : (
    (() => {
      const cell = (turn: Turn, code: string) =>
        code === turn.src ? turn.original : (turn.translations?.[code] || '');
      const rows = partial ? [...turns, partial] : turns;
      return (
        <div className="w-full h-full flex gap-4 lg:gap-8" style={{ fontSize: `calc(clamp(1.25rem, 1.9vw, 2rem) * ${fontScale / 100})` }}>
          {selectedLangs.map((code) => (
            <div key={code} className="flex-1 min-w-0 flex flex-col h-full">
              <div className="flex-shrink-0 mb-0.5 border-b border-background-200 leading-none">
                <span className="text-[10px] lg:text-xs font-bold px-1 py-px rounded bg-accent-100 text-accent-600">{langChip(code)}</span>
              </div>
              <div ref={(el) => { colRefs.current[code] = el; }} className="flex-1 min-h-0 overflow-y-auto">
                <div className="min-h-full flex flex-col justify-end">
                  {rows.filter((turn) => cell(turn, code)).map((turn, ri) => (
                    <p
                      key={`${turn.id}-${ri}`}
                      className={`flex-shrink-0 py-2 leading-snug break-words border-b border-background-200/50 font-medium text-foreground-900 ${partial && turn === partial ? 'opacity-90' : ''}`}
                      style={{ fontSize: '1em' }}
                    >
                      {cell(turn, code)}
                    </p>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      );
    })()
  );

  return (
    <div ref={rootRef} className="h-screen bg-background-100 flex flex-col overflow-hidden">
      {/* Slim top bar */}
      <nav className="flex-shrink-0 bg-background-50/95 backdrop-blur-sm border-b border-background-200">
        <div className={`flex items-center gap-3 h-12 px-4 lg:px-6 ${barCollapsed ? 'hidden' : ''}`}>
          <button
            onClick={() => navigate('/')}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-background-100 text-foreground-500 cursor-pointer"
            title={t('回到控制台')}
          >
            <i className="ri-arrow-left-line"></i>
          </button>
          <h1 className="text-sm font-semibold text-foreground-900 flex items-center gap-2">
            <i className="ri-translate-2"></i>{t('会议翻译')}
          </h1>
          <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-foreground-300'}`}
                title={connected ? t('已连接') : t('未连接')}></span>

          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => setShowHistory(true)}
              className="h-9 px-3 rounded-lg bg-background-100 text-foreground-500 text-sm flex items-center gap-1.5 cursor-pointer hover:bg-background-200 transition-colors"
              title={t('历史记录')}
            >
              <i className="ri-history-line"></i>
              {history.length > 0 && <span className="text-xs tabular-nums">{history.length}</span>}
            </button>
            {(minutes || minutesLoading) && !running && (
              <button
                onClick={() => setShowMinutes(true)}
                className="h-9 px-3 rounded-lg bg-accent-100 text-accent-600 text-sm font-medium flex items-center gap-1.5 cursor-pointer hover:bg-accent-200 transition-colors"
                title={t('会议纪要')}
              >
                <i className={minutesLoading ? 'ri-loader-4-line animate-spin' : 'ri-file-list-3-line'}></i>
                <span className="hidden sm:inline">{t('会议纪要')}</span>
              </button>
            )}
            <button
              onClick={clear}
              disabled={turns.length === 0}
              className="h-9 px-3 rounded-lg bg-background-100 text-foreground-500 text-sm flex items-center gap-1.5 disabled:opacity-40 cursor-pointer hover:bg-background-200 transition-colors"
              title={t('清空')}
            >
              <i className="ri-delete-bin-line"></i>
            </button>
            <button
              onClick={() => setShowLibrary(true)}
              className="h-9 px-3 rounded-lg bg-background-100 text-foreground-500 text-sm flex items-center gap-1.5 cursor-pointer hover:bg-background-200 transition-colors"
              title={t('管理文件(上传/打开 PPT、视频等)')}
            >
              <i className="ri-folder-3-line"></i>
              <span className="hidden lg:inline">{t('管理文件')}</span>
            </button>
            <button
              onClick={toggleLayout}
              className="h-9 px-3 rounded-lg bg-background-100 text-foreground-500 text-sm flex items-center gap-1.5 cursor-pointer hover:bg-background-200 transition-colors"
              title={layout === 'stack' ? t('切换到分栏(竖版)') : t('切换到堆叠(横版)')}
            >
              <i className={layout === 'stack' ? 'ri-layout-column-line' : 'ri-layout-row-line'}></i>
            </button>
            <button
              onClick={toggleFull}
              className="h-9 px-3 rounded-lg bg-background-100 text-foreground-500 text-sm flex items-center gap-1.5 cursor-pointer hover:bg-background-200 transition-colors"
              title={t('全屏投影')}
            >
              <i className={isFull ? 'ri-fullscreen-exit-line' : 'ri-fullscreen-line'}></i>
            </button>
            {running ? (
              <button
                onClick={stop}
                className="h-9 px-5 rounded-lg bg-red-500 text-white font-semibold text-sm flex items-center gap-2 cursor-pointer hover:bg-red-600 transition-colors"
              >
                <span className="w-2.5 h-2.5 rounded-sm bg-white"></span>{t('结束')}
              </button>
            ) : starting ? (
              <button
                disabled
                className="h-9 px-5 rounded-lg bg-accent-500 text-background-50 font-semibold text-sm flex items-center gap-2 opacity-50"
              >
                <i className="ri-loader-4-line animate-spin"></i>{t('正在启动…')}
              </button>
            ) : turns.length > 0 ? (
              // A meeting is on screen (just finished or loaded from history): continue it, or start fresh.
              <>
                <button
                  onClick={() => start(true)}
                  disabled={!connected}
                  className="h-9 px-4 rounded-lg bg-accent-500 text-background-50 font-semibold text-sm flex items-center gap-2 disabled:opacity-50 cursor-pointer hover:bg-accent-600 transition-colors"
                >
                  <i className="ri-mic-line"></i>{t('继续录音')}
                </button>
                <button
                  onClick={clear}
                  className="h-9 px-4 rounded-lg bg-background-100 text-foreground-700 font-medium text-sm flex items-center gap-2 cursor-pointer hover:bg-background-200 transition-colors"
                  title={t('清屏,准备开新的一场(再点开始才录音)')}
                >
                  <i className="ri-add-line"></i>{t('新建录音')}
                </button>
              </>
            ) : (
              <button
                onClick={() => start(false)}
                disabled={!connected}
                className="h-9 px-5 rounded-lg bg-accent-500 text-background-50 font-semibold text-sm flex items-center gap-2 disabled:opacity-50 cursor-pointer hover:bg-accent-600 transition-colors"
              >
                <i className="ri-mic-line"></i>{t('开始')}
              </button>
            )}
          </div>
        </div>

        {/* Pickup controls: subtitle languages, mic device, gain, live level meter — collapsible */}
        <div className={`flex flex-wrap items-center gap-x-5 gap-y-2 px-4 lg:px-6 pb-2 text-xs text-foreground-500 ${barCollapsed ? 'hidden' : ''}`}>
          {/* Subtitle language multi-select */}
          <div className="relative">
            <button
              onClick={() => { if (!running) setShowLangs((v) => !v); }}
              disabled={running}
              className={`flex items-center gap-1.5 bg-background-100 border border-background-200 rounded-md px-2 py-1 ${running ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-background-200'}`}
              title={t('选择字幕语言')}
            >
              <i className="ri-translate-2"></i>
              <span className="font-medium text-foreground-700">{t('字幕语言')}</span>
              <span className="text-foreground-400">
                {selectedLangs.length === 0 ? '—' : selectedLangs.map((c) => langChip(c)).join(' / ')}
              </span>
              <i className={`ri-arrow-down-s-line transition-transform ${showLangs ? 'rotate-180' : ''}`}></i>
            </button>
            {showLangs && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setShowLangs(false)}></div>
                <div className="absolute z-40 mt-1 left-0 w-56 bg-background-50 border border-background-200 rounded-xl shadow-lg p-1.5 max-h-80 overflow-y-auto">
                  <p className="px-2 py-1 text-[11px] text-foreground-400 leading-snug">
                    {t('勾选参会语言(最多 3 种):说其中一种,其余语言实时作为字幕出现')}
                  </p>
                  {LANGS.map((l) => {
                    const on = selectedLangs.includes(l.code);
                    const full = selectedLangs.length >= MAX_LANGS;
                    return (
                      <button
                        key={l.code}
                        onClick={() => toggleLang(l.code)}
                        disabled={!on && full}
                        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left ${!on && full ? 'opacity-40 cursor-not-allowed' : 'hover:bg-background-100 cursor-pointer'}`}
                      >
                        <span className={`w-4 h-4 flex-shrink-0 rounded flex items-center justify-center border ${on ? 'bg-accent-500 border-accent-500 text-background-50' : 'border-background-300'}`}>
                          {on && <i className="ri-check-line text-[11px]"></i>}
                        </span>
                        <span className="text-foreground-800 truncate">{getLang() === 'en' ? l.en : l.label}</span>
                        <span className="ml-auto text-foreground-300">{langChip(l.code)}</span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          <label className="flex items-center gap-1.5">
            <i className="ri-mic-line"></i>
            <select
              value={micId}
              onChange={(e) => { setMicId(e.target.value); try { localStorage.setItem(DEV_KEY, e.target.value); } catch { /* ignore */ } }}
              className="max-w-[46vw] sm:max-w-56 bg-background-100 border border-background-200 rounded-md px-2 py-1 cursor-pointer"
              title={t('选择麦克风')}
            >
              <option value="">{t('默认麦克风')}</option>
              {mics.map((d, i) => (
                <option key={d.deviceId || i} value={d.deviceId}>
                  {d.label || `${t('麦克风')} ${i + 1}`}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-2">
            <span className="whitespace-nowrap">{t('收音增益')}</span>
            <input
              type="range" min={1} max={6} step={0.5} value={gain}
              onChange={(e) => setGain(Number(e.target.value))}
              className="w-28 sm:w-40 cursor-pointer accent-accent-500"
            />
            <span className="tabular-nums w-8">{gain.toFixed(1)}×</span>
          </label>

          <div className="flex items-center gap-2 min-w-[120px] flex-1">
            <span className="whitespace-nowrap">{t('音量')}</span>
            <div className="flex-1 max-w-48 h-2 rounded-full bg-background-200 overflow-hidden">
              <div ref={levelBarRef} className="h-full bg-green-500 transition-[width] duration-75" style={{ width: '0%' }}></div>
            </div>
          </div>

          {/* Font size (Word-style zoom): − / input% / + */}
          <div className="flex items-center gap-1.5">
            <span className="whitespace-nowrap">{t('字号')}</span>
            <div className="flex items-center gap-0.5">
              <button
                onClick={() => applyFont(fontScale - 10)}
                disabled={fontScale <= FONT_MIN}
                className="w-6 h-6 flex items-center justify-center rounded bg-background-100 text-foreground-600 hover:bg-background-200 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                title={t('减小字号')}
              >
                <i className="ri-subtract-line"></i>
              </button>
              <div className="flex items-center bg-background-100 border border-background-200 rounded px-1">
                <input
                  type="text"
                  inputMode="numeric"
                  value={fontInput}
                  onChange={(e) => setFontInput(e.target.value.replace(/[^\d]/g, ''))}
                  onBlur={commitFont}
                  onKeyDown={(e) => { if (e.key === 'Enter') { commitFont(); (e.target as HTMLInputElement).blur(); } }}
                  className="w-8 text-center bg-transparent tabular-nums outline-none text-foreground-700"
                />
                <span className="text-foreground-400">%</span>
              </div>
              <button
                onClick={() => applyFont(fontScale + 10)}
                disabled={fontScale >= FONT_MAX}
                className="w-6 h-6 flex items-center justify-center rounded bg-background-100 text-foreground-600 hover:bg-background-200 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                title={t('放大字号')}
              >
                <i className="ri-add-line"></i>
              </button>
            </div>
          </div>
        </div>

        {/* Pull-tab: collapse the settings row to give the caption area more room */}
        <div className="w-full flex justify-center">
          <button
            onClick={toggleBar}
            className="flex items-center justify-center gap-1 h-4 px-3 rounded-t-md bg-background-100 hover:bg-accent-100 text-foreground-400 hover:text-accent-500 cursor-pointer transition-colors"
            title={barCollapsed ? t('展开顶栏') : t('收起顶栏(让字幕更大)')}
          >
            <i className={`ri-arrow-up-s-line text-sm leading-none transition-transform ${barCollapsed ? 'rotate-180' : ''}`}></i>
          </button>
        </div>
      </nav>

      {error && (
        <div className="flex-shrink-0 text-sm text-red-600 bg-red-50 border-b border-red-200 px-6 py-2">
          {error}
        </div>
      )}

      {/* Caption area. When a file is open in the box, subtitles compress into a strip above the viewer;
          otherwise they fill the area (stack scrolls & centered; columns fill width, bottom-aligned). */}
      {boxFile ? (
        <div ref={boxWrapRef} className="flex-1 flex flex-col min-h-0">
          <div
            ref={scrollRef}
            style={{ height: stripPx > 0 ? `${stripPx}px` : '30vh' }}
            className={`flex-shrink-0 w-full pt-1 pb-0.5 ${layout === 'columns' ? 'overflow-hidden px-3 lg:px-5' : 'overflow-y-auto px-6 lg:px-12'}`}
          >
            {captionsInner}
          </div>
          {/* draggable divider: resize the subtitle strip vs. the file box */}
          <div
            onPointerDown={onDividerDown}
            className="flex-shrink-0 h-2.5 bg-background-200 hover:bg-accent-200 cursor-row-resize flex items-center justify-center group touch-none"
            title={t('拖动调整大小')}
          >
            <div className="w-12 h-1 rounded-full bg-foreground-300 group-hover:bg-accent-500"></div>
          </div>
          <div className="flex-1 min-h-0">
            <FileViewer file={boxFile} onClose={() => setBoxFile(null)} />
          </div>
        </div>
      ) : (
        <div ref={scrollRef} className={`flex-1 min-h-0 w-full pb-4 ${barCollapsed ? 'pt-0' : 'pt-4'} ${layout === 'columns' ? 'overflow-hidden px-3 lg:px-5' : 'overflow-y-auto px-6 lg:px-12'}`}>
          {captionsInner}
        </div>
      )}

      {showLibrary && (
        <FileLibrary onOpen={(f) => { setBoxFile(f); setShowLibrary(false); }} onClose={() => setShowLibrary(false)} />
      )}

      {/* Meeting minutes (auto-generated on stop) */}
      {showMinutes && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={() => setShowMinutes(false)}
        >
          <div
            className="bg-background-50 rounded-2xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 px-5 py-3.5 border-b border-background-200">
              <i className="ri-file-list-3-line text-accent-500"></i>
              <h3 className="text-sm font-semibold text-foreground-900">{t('会议纪要')}</h3>
              <div className="ml-auto flex items-center gap-2">
                {minutes && (
                  <>
                    <button
                      onClick={copyMinutes}
                      className="h-8 px-3 rounded-lg bg-background-100 text-foreground-600 text-xs flex items-center gap-1.5 cursor-pointer hover:bg-background-200 transition-colors"
                    >
                      <i className={copied ? 'ri-check-line text-green-600' : 'ri-file-copy-line'}></i>
                      {copied ? t('已复制') : t('复制')}
                    </button>
                    <div className="relative">
                      <button
                        onClick={() => { setExportLangs(minutesLang ? [minutesLang] : selectedLangs.slice()); setShowExport((v) => !v); }}
                        disabled={exporting}
                        className="h-8 px-3 rounded-lg bg-background-100 text-foreground-600 text-xs flex items-center gap-1.5 disabled:opacity-50 cursor-pointer hover:bg-background-200 transition-colors"
                      >
                        <i className={exporting ? 'ri-loader-4-line animate-spin' : 'ri-file-pdf-2-line'}></i>{t('导出 PDF')}
                      </button>
                      {showExport && (
                        <>
                          <div className="fixed inset-0 z-40" onClick={() => setShowExport(false)}></div>
                          <div className="absolute right-0 z-50 mt-1 w-48 bg-background-50 border border-background-200 rounded-xl shadow-lg p-2">
                            <p className="px-1 pb-1 text-[11px] text-foreground-400">{t('选择导出语言(可多选)')}</p>
                            {selectedLangs.map((code) => {
                              const on = exportLangs.includes(code);
                              return (
                                <button
                                  key={code}
                                  onClick={() => setExportLangs((prev) => prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code])}
                                  className="w-full flex items-center gap-2 px-1.5 py-1.5 rounded-lg hover:bg-background-100 cursor-pointer text-left text-sm"
                                >
                                  <span className={`w-4 h-4 flex-shrink-0 rounded flex items-center justify-center border ${on ? 'bg-accent-500 border-accent-500 text-background-50' : 'border-background-300'}`}>
                                    {on && <i className="ri-check-line text-[11px]"></i>}
                                  </span>
                                  <span className="text-foreground-800">{LANGS.find((l) => l.code === code)?.[getLang() === 'en' ? 'en' : 'label'] || code}</span>
                                </button>
                              );
                            })}
                            <button
                              onClick={() => { setShowExport(false); void exportMinutesPdf(exportLangs); }}
                              disabled={exportLangs.length === 0}
                              className="mt-1 w-full h-8 rounded-lg bg-accent-500 text-background-50 text-xs font-semibold disabled:opacity-50 cursor-pointer hover:bg-accent-600"
                            >
                              {t('导出')}
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                    <button
                      onClick={() => generateMinutes()}
                      disabled={minutesLoading}
                      className="h-8 px-3 rounded-lg bg-background-100 text-foreground-600 text-xs flex items-center gap-1.5 disabled:opacity-50 cursor-pointer hover:bg-background-200 transition-colors"
                      title={t('重新生成')}
                    >
                      <i className={minutesLoading ? 'ri-loader-4-line animate-spin' : 'ri-refresh-line'}></i>
                    </button>
                  </>
                )}
                <button
                  onClick={() => setShowMinutes(false)}
                  className="w-8 h-8 flex items-center justify-center rounded-lg text-foreground-400 hover:bg-background-100 cursor-pointer"
                >
                  <i className="ri-close-line"></i>
                </button>
              </div>
            </div>

            {/* Minutes language selector: view the minutes in any recorded language */}
            {selectedLangs.length > 0 && (
              <div className="flex items-center gap-1.5 px-5 py-2 border-b border-background-100 flex-wrap">
                <span className="text-xs text-foreground-400 mr-1">{t('语言')}</span>
                {selectedLangs.map((code) => (
                  <button
                    key={code}
                    onClick={() => generateMinutes(code)}
                    disabled={minutesLoading}
                    className={`h-7 px-2.5 rounded-lg text-xs font-medium cursor-pointer disabled:opacity-50 transition-colors ${minutesLang === code ? 'bg-accent-500 text-background-50' : 'bg-background-100 text-foreground-600 hover:bg-background-200'}`}
                  >
                    {LANGS.find((l) => l.code === code)?.[getLang() === 'en' ? 'en' : 'label'] || code}
                  </button>
                ))}
              </div>
            )}

            <div className="flex-1 overflow-y-auto px-5 py-4">
              {minutesLoading && (
                <div className="py-10 flex flex-col items-center justify-center text-foreground-400">
                  <i className="ri-loader-4-line animate-spin text-3xl mb-3 text-accent-500"></i>
                  <p className="text-sm">{t('正在生成会议纪要…')}</p>
                </div>
              )}
              {!minutesLoading && minutes && (
                <div className="space-y-5">
                  {minutes.title && <h4 className="text-lg font-bold text-foreground-900">{minutes.title}</h4>}
                  {minutes.summary && (
                    <p className="text-sm text-foreground-600 leading-relaxed">{minutes.summary}</p>
                  )}
                  {minutes.points?.length > 0 && (
                    <section>
                      <div className="text-xs font-bold text-foreground-500 mb-2 flex items-center gap-1.5">
                        <i className="ri-discuss-line text-accent-500"></i>{t('讨论要点')}
                      </div>
                      <ul className="space-y-1.5">
                        {minutes.points.map((p, i) => (
                          <li key={i} className="text-sm text-foreground-700 leading-relaxed flex gap-2">
                            <span className="text-accent-400 mt-0.5">·</span><span>{p}</span>
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}
                  {minutes.decisions?.length > 0 && (
                    <section>
                      <div className="text-xs font-bold text-foreground-500 mb-2 flex items-center gap-1.5">
                        <i className="ri-check-double-line text-green-500"></i>{t('决定事项')}
                      </div>
                      <ul className="space-y-1.5">
                        {minutes.decisions.map((d, i) => (
                          <li key={i} className="text-sm text-foreground-700 leading-relaxed flex gap-2">
                            <span className="text-green-500 mt-0.5">·</span><span>{d}</span>
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}
                  {minutes.todos?.length > 0 && (
                    <section>
                      <div className="text-xs font-bold text-foreground-500 mb-2 flex items-center gap-1.5">
                        <i className="ri-task-line text-accent-500"></i>{t('待办事项')}
                      </div>
                      <ul className="space-y-1.5">
                        {minutes.todos.map((td, i) => (
                          <li key={i} className="text-sm text-foreground-700 leading-relaxed flex gap-2 items-start">
                            <span className="text-accent-400 mt-0.5">☐</span>
                            <span>{td.task}
                              {td.owner && <span className="ml-2 text-xs text-accent-600 bg-accent-100 rounded px-1.5 py-0.5">{td.owner}</span>}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}
                  {!minutes.summary && !minutes.points?.length && !minutes.decisions?.length && !minutes.todos?.length && (
                    <p className="text-sm text-foreground-400">{t('这段会议内容较少,未能整理出要点。')}</p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* History */}
      {showHistory && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={() => setShowHistory(false)}
        >
          <div
            className="bg-background-50 rounded-2xl shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 px-5 py-3.5 border-b border-background-200">
              <i className="ri-history-line text-accent-500"></i>
              <h3 className="text-sm font-semibold text-foreground-900">{t('历史记录')}</h3>
              <span className="text-xs text-foreground-400">{t('跨设备同步')}</span>
              <button
                onClick={() => setShowHistory(false)}
                className="ml-auto w-8 h-8 flex items-center justify-center rounded-lg text-foreground-400 hover:bg-background-100 cursor-pointer"
              >
                <i className="ri-close-line"></i>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-3 py-2">
              {history.length === 0 ? (
                <div className="py-12 text-center text-foreground-300 text-sm">
                  <i className="ri-inbox-line text-3xl block mb-2"></i>
                  {t('还没有会议记录')}
                </div>
              ) : (
                <ul className="divide-y divide-background-100">
                  {history.map((s) => (
                    <li key={s.id} className="flex items-center gap-2 py-2.5 px-2 rounded-lg hover:bg-background-100 group">
                      <button onClick={() => openSession(s)} className="flex-1 min-w-0 text-left cursor-pointer">
                        <p className="text-sm font-medium text-foreground-900 truncate">{s.title || t('未命名会议')}</p>
                        <p className="text-xs text-foreground-400 mt-0.5">
                          {new Date(s.created).toLocaleString()} · {(s.turns?.length || 0)} {t('句')}
                          {s.minutes ? ' · ' + t('含纪要') : ''}
                        </p>
                      </button>
                      <button
                        onClick={() => deleteSession(s.id)}
                        className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-lg text-foreground-300 hover:text-red-500 hover:bg-background-200 cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
                        title={t('删除')}
                      >
                        <i className="ri-delete-bin-line"></i>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
