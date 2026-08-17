import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import BackButton from '@/components/feature/BackButton';
import Tabs from '@/components/base/Tabs';
import TranscriptionTab from '@/pages/home/components/TranscriptionTab';
import SummaryTab, { parseCorrection } from '@/pages/home/components/SummaryTab';
import HistoryTab from '@/pages/home/components/HistoryTab';
import ReviewTab from '@/pages/home/components/ReviewTab';
import SharePanel from '@/pages/home/components/SharePanel';
import EditHistoryPanel from '@/pages/home/components/EditHistoryPanel';
import { loadSettings } from '@/lib/settings';
import CoursePanel from '@/pages/home/components/CoursePanel';
import SearchBox from '@/components/feature/SearchBox';
import type { AudioPlayerHandle } from '@/components/feature/AudioPlayer';
import { useLiveCaption } from '@/hooks/useLiveCaption';
import { fmtDuration, sessionDate, sessionTitle, useRecords } from '@/hooks/useRecords';
import type { TranscriptLine } from '@/hooks/useRecords';
import { compressImage, useLibrary } from '@/hooks/useLibrary';
import type { Course, Shot } from '@/hooks/useLibrary';
import { exportWord } from '@/lib/exportWord';
import { exportPdf, exportPdfBatch, type PdfDoc } from '@/lib/exportPdf';
import { useT } from '@/lib/i18n';

const tabs = [
  { id: 'transcription', label: '实时转写', icon: 'ri-mic-line' },
  { id: 'summary', label: '摘要预览', icon: 'ri-magic-line' },
  { id: 'review', label: '复习', icon: 'ri-book-read-line' },
  { id: 'history', label: '历史课程', icon: 'ri-history-line' },
];

export default function HomePage() {
  const t = useT();
  const [activeTab, setActiveTab] = useState('transcription');
  const [activeSessionId, setActiveSessionId] = useState('');
  const [showSharePanel, setShowSharePanel] = useState(false);
  const [showEditHistory, setShowEditHistory] = useState(false);
  const [subjectTags, setSubjectTags] = useState<string[]>([]);   // Subject tags (syllabus names), checked to serve as correction context
  const [editingCourse, setEditingCourse] = useState<Course | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [summary, setSummary] = useState('');
  const [keyPoints, setKeyPoints] = useState<string[]>([]);
  const [corrections, setCorrections] = useState<string[]>([]);   // Transcription may mishear; kept as a separate block (original record, used on export, not deleted)
  const [appliedCorrections, setAppliedCorrections] = useState<string[]>([]);   // Already one-click-replaced; hidden from the list but the record is kept
  const [summaryError, setSummaryError] = useState('');
  const [histLines, setHistLines] = useState<TranscriptLine[]>([]);
  const [shots, setShots] = useState<Shot[]>([]);
  const [focusLineId, setFocusLineId] = useState<number | null>(null);
  const [toast, setToast] = useState('');
  const [justEnded, setJustEnded] = useState(false);   // Just finished recording; show the "saved · back to home" banner
  const [note, setNote] = useState('');
  const [noteStatus, setNoteStatus] = useState<'' | 'saving' | 'saved'>('');

  // The live-caption connection lives at the page layer: switching tabs unmounts the transcript component,
  // and if the connection dropped with it, the captions already shown would be lost (the server is in fact still recording).
  const live = useLiveCaption();
  const records = useRecords();
  const lib = useLibrary();
  const playerRef = useRef<AudioPlayerHandle | null>(null);
  const noteTimer = useRef<number | null>(null);
  const noteSid = live.liveSid || activeSessionId;   // Attach notes to the session being recorded / viewed

  // Arriving via the main 「快捷通道」 with params: open the matching tab/panel / start recording directly
  const [searchParams] = useSearchParams();
  const [autoNew] = useState(() => searchParams.get('new') === '1');
  const [initialTitle] = useState(() => searchParams.get('title') || '');   // Course name prefilled when arriving from the timetable
  // Arriving from the dashboard 「查看纪要」 (?tab=summary&sid=…): after landing on the summary page, auto-generate once if not generated before
  const wantAutoSummary = useRef(
    searchParams.get('tab') === 'summary' && !!searchParams.get('sid')
  );
  useEffect(() => {
    const tab = searchParams.get('tab');
    const sid = searchParams.get('sid');
    if (sid) {
      // Arriving from the dashboard 「最近课时」: select this session directly and view its transcript
      setActiveSessionId(sid);
      if (!tab) setActiveTab('transcription');
    }
    if (tab && tabs.some((t) => t.id === tab)) setActiveTab(tab);
    if (searchParams.get('share') === '1') setShowSharePanel(true);
    // Read only once on entry
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // activeSession exists only when a session is explicitly selected (no longer defaulting to the latest one) --
  // otherwise a new-recording page would inexplicably show the previous session's transcript
  const activeSession = useMemo(
    () => (activeSessionId ? records.sessions.find((s) => s.id === activeSessionId) : undefined),
    [records.sessions, activeSessionId]
  );
  // While live-recording, prefer showing the recording state rather than "not started" (new users have no saved sessions)
  const title = live.running
    ? t('正在录制…')
    : activeSession
      ? sessionTitle(activeSession)
      : t('未开始录制');


  // On switching sessions, load the transcript and board photos
  useEffect(() => {
    if (!activeSessionId) return;
    let cancelled = false;
    void records.loadTranscript(activeSessionId)
      .then((j) => !cancelled && setHistLines(j.lines))
      .catch(() => !cancelled && setHistLines([]));
    void lib.loadShots(activeSessionId)
      .then((j) => !cancelled && setShots(j.shots))
      .catch(() => !cancelled && setShots([]));
    // Read back this session's saved AI summary (show it directly if present, no need to regenerate)
    void records.loadSummary(activeSessionId)
      .then((s) => {
        if (cancelled || !s || !s.summary) return;
        setSummary(s.summary);
        setKeyPoints(s.key_points ?? []);
        setCorrections(s.corrections ?? []);
        setAppliedCorrections(s.applied ?? []);
      })
      .catch(() => { /* No saved summary, ignore */ });
    return () => { cancelled = true; };
    // records/lib are new objects on every render and can't go in the deps (or every render refetches -> request storm); run only on session switch
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionId]);

  // After finishing a session, refresh the list
  useEffect(() => {
    if (!live.lastDir || live.running) return;
    void records.reload();
    void lib.reloadCourses();
    // Likewise: the deps hold only the stable lastDir/running, not records/lib (or the list refreshes endlessly after stopping)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live.lastDir, live.running]);

  // On switching sessions / starting a recording, read back this session's notes (only when noteSid changes --
  // records is a new object every render and can't go in the deps, or every keystroke would refetch and overwrite what you typed)
  useEffect(() => {
    if (!noteSid) { setNote(''); setNoteStatus(''); return; }
    let cancelled = false;
    void records.loadNote(noteSid)
      .then((r) => { if (!cancelled) { setNote(r.note || ''); setNoteStatus(''); } })
      .catch(() => undefined);
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteSid]);

  // Note changes: debounced 0.8s auto-save
  const handleNoteChange = useCallback((text: string) => {
    setNote(text);
    if (!noteSid) return;
    setNoteStatus('saving');
    if (noteTimer.current) window.clearTimeout(noteTimer.current);
    noteTimer.current = window.setTimeout(() => {
      void records.saveNote(noteSid, text).then(() => setNoteStatus('saved')).catch(() => setNoteStatus(''));
    }, 800);
  }, [noteSid, records]);

  // Clear any pending debounced auto-save when leaving the page, so a timer scheduled inside the
  // 0.8s window doesn't fire post-unmount (stray saveNote + a misleading "已保存" flash).
  useEffect(() => () => { if (noteTimer.current) window.clearTimeout(noteTimer.current); }, []);

  // Subject tags: include courses from the 「全国版课程大纲(教育部·教指委 全国基本要求)」 by default, always checkable;
  // then merge in other syllabi downloaded on this device, deduped, for selection (as subject context for AI correction/translation).
  useEffect(() => {
    const NATIONAL_SYLLABUS_TAGS = [
      '大学物理', '大学物理实验', '大学计算机基础', '大学英语',
      '马克思主义基本原理', '毛泽东思想和中国特色社会主义理论体系概论',
      '习近平新时代中国特色社会主义思想概论', '思想道德与法治',
      '中国近现代史纲要', '军事理论', '大学生心理健康教育',
    ];
    void records.listSyllabus()
      .then((r) => setSubjectTags([...new Set([...NATIONAL_SYLLABUS_TAGS, ...(r.courses || []).map((c) => c.name)])]))
      .catch(() => setSubjectTags(NATIONAL_SYLLABUS_TAGS));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const say = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  }, []);

  // Batch export: combine the selected sessions into a single PDF (each with summary + highlights + possible mishearings + full transcript)
  const handleBatchExport = useCallback(async (ids: string[]) => {
    if (!ids.length) { say(t('先勾选要导出的课时')); return; }
    say(t('正在导出 {n} 节…', { n: ids.length }));
    try {
      const docs: PdfDoc[] = [];
      for (const id of ids) {
        const s = records.sessions.find((x) => x.id === id);
        const [j, sum] = await Promise.all([
          records.loadTranscript(id).catch(() => ({ lines: [] as TranscriptLine[] })),
          records.loadSummary(id).catch(() => null),
        ]);
        docs.push({
          title: s ? sessionTitle(s) : id,
          subtitle: s ? `${sessionDate(s)} · ${fmtDuration(s.duration_s)}` : '',
          summary: sum?.summary || '',
          keyPoints: sum?.key_points || [],
          corrections: sum?.corrections || [],
          lines: (j.lines || []).map((l) => ({ ts: l.ts, speaker: l.speaker, text: l.text, kind: l.kind })),
        });
      }
      await exportPdfBatch(docs, `批量导出 ${docs.length} 节`);
      say(t('已导出 {n} 节', { n: docs.length }));
    } catch (e) {
      say(t('导出失败:') + (e instanceof Error ? e.message : String(e)));
    }
  }, [records, say]);

  const handleSelectSession = useCallback((sessionId: string) => {
    setActiveSessionId(sessionId);
    setSummary('');
    setKeyPoints([]);
    setCorrections([]);
    setAppliedCorrections([]);
    setSummaryError('');
    setFocusLineId(null);
    setActiveTab('transcription');
  }, []);

  // Which transcript to show:
  // 1) An archived session was explicitly opened and it isn't the one being recorded -> show the archive (even if, after re-login, live
  //    auto-restores with running=true but live.lines is empty, an empty live must not cover the history).
  // 2) Recording / captions already produced this session -> show live (don't fall back to history while recording, or a new session would show the previous one).
  const viewLines: TranscriptLine[] = useMemo(() => {
    const liveView = live.lines.map((l) => ({
      id: l.id, ts: l.ts, speaker: l.speaker, speaker_id: l.speaker_id,
      text: l.text, kind: l.kind, new_para: l.new_para, start: l.start, end: l.end,
      translation: l.translation,
    }));
    if (live.running) {
      // Viewing another archived session (not the one being recorded) -> show the archive
      if (activeSessionId && activeSessionId !== live.liveSid) return histLines;
      // Continued recording: old transcript (histLines) first + this session's new speech (liveView) after, shown joined together;
      // new line ids continue after the old ones, deduped by id to prevent overlap. For a fresh session histLines is empty, so only liveView remains.
      if (activeSessionId && activeSessionId === live.liveSid && histLines.length) {
        const liveIds = new Set(liveView.map((l) => l.id));
        return [...histLines.filter((l) => !liveIds.has(l.id)), ...liveView];
      }
      return liveView;
    }
    // After stopping: prefer the selected session's full archive (old+new after a continued recording); fall back to live if there's no archive
    if (activeSessionId) return histLines.length ? histLines : liveView;
    if (live.lines.length > 0) return liveView;
    return histLines;
  }, [activeSessionId, live.liveSid, live.running, live.lines, histLines]);

  // Let callbacks like replace always access "the lines currently on screen" (including old lines when continuing), without stuffing viewLines into the deps
  const viewLinesRef = useRef<TranscriptLine[]>([]);
  viewLinesRef.current = viewLines;

  // Generate the summary from the given transcript lines + session sid (decoupled from "which session is being viewed", to avoid the summary landing on the wrong session)
  const generateSummaryFor = useCallback(async (lines: TranscriptLine[], sid: string | null) => {
    if (lines.length === 0) {
      setSummaryError(t('这节课还没有转写内容'));
      setActiveTab('summary');
      return;
    }
    setIsGenerating(true);
    setSummaryError('');
    try {
      // Let the server call DeepSeek -- the API key lives only on the server; the browser can't get it and doesn't need it
      const ai = await live.summarize(title, lines, sid || live.liveSid);
      setSummary(ai.summary);
      setKeyPoints([
        ...(ai.key_points ?? []),
        ...(ai.exam_hints ?? []).map((x) => `【老师说要考】${x}`),
        ...(ai.formulas ?? []).map((x) => `【公式/定理】${x}`),
        ...(ai.questions ?? []).map((x) => `【课堂问答】${x}`),
      ]);
      setCorrections(ai.corrections ?? []);   // Keep mishearing hints separate, not mixed into the highlights
      setAppliedCorrections([]);              // Freshly generated summary; clear the replacement record
      setActiveTab('summary');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setSummaryError(msg);
      // Even if the AI fails, don't leave the user empty-handed: fall back to rule-based highlights and make clear these aren't AI-generated
      const marked = lines.filter((l) => l.kind);
      setKeyPoints(marked.map((l) => l.text));
      setCorrections([]);
      setSummary(`AI 摘要没能生成。下面是本机规则标出的 ${marked.length} 处重点/定义，不是 AI 整理的结果。`);
      setActiveTab('summary');
    } finally {
      setIsGenerating(false);
    }
  }, [live, title]);

  const handleGenerateSummary = useCallback(
    () => generateSummaryFor(viewLines, activeSessionId || live.liveSid),
    [generateSummaryFor, viewLines, activeSessionId, live.liveSid]
  );

  // Arriving from the dashboard 「查看纪要」: wait for this session's transcript to load, then auto-generate the summary once (only once)
  useEffect(() => {
    if (
      wantAutoSummary.current &&
      activeSessionId &&
      histLines.length > 0 &&
      !summary &&
      !isGenerating
    ) {
      wantAutoSummary.current = false;
      void handleGenerateSummary();
    }
  }, [activeSessionId, histLines, summary, isGenerating, handleGenerateSummary]);

  // If the summary has content and a session is selected -> auto-persist it (carried after generation/correction, visible on refresh and in the list)
  useEffect(() => {
    if (!activeSessionId || !summary || isGenerating) return;
    void records.saveSummary(activeSessionId, { summary, key_points: keyPoints, corrections, applied: appliedCorrections });
    // records is a new object every render, kept out of the deps (or every render would re-POST to save)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionId, summary, keyPoints, corrections, appliedCorrections, isGenerating]);

  // The 「保存摘要」 button: save once manually and show a notice
  const handleSaveSummary = useCallback(async () => {
    if (!activeSessionId) { say(t('这节课还没保存,先停止录音')); return; }
    if (!summary) { say(t('还没有摘要可保存')); return; }
    try {
      await records.saveSummary(activeSessionId, { summary, key_points: keyPoints, corrections, applied: appliedCorrections });
      await records.reload();
      say(t('摘要已保存'));
    } catch (e) {
      say(t('保存失败:') + (e instanceof Error ? e.message : String(e)));
    }
  }, [activeSessionId, summary, keyPoints, corrections, appliedCorrections, records, say]);

  // End recording: stop -> auto-generate the AI summary -> select the just-ended session (it's persisted into history; don't let it vanish from view)
  const pendingSummaryRef = useRef<string | null>(null);

  const handleEndRecording = useCallback(() => {
    const endedSid = live.liveSid;
    live.stop();
    if (endedSid) {
      setActiveSessionId(endedSid);
      pendingSummaryRef.current = endedSid;   // Wait until the backend finishes persisting (stopped received), then generate the summary from the full transcript
    }
    void records.reload();             // Ensure the just-ended session appears in the history
    setJustEnded(true);                // Show the "saved · back to home" banner
  }, [live, records]);

  // Backend confirms the stop (running becomes false) -> generate the summary from the server's full transcript (old+new after a continued recording)
  useEffect(() => {
    if (live.running) return;
    const sid = pendingSummaryRef.current;
    if (!sid) return;
    pendingSummaryRef.current = null;
    const auto = loadSettings().autoSummary;
    void records.loadTranscript(sid)
      .then((j) => { setHistLines(j.lines); if (auto) void generateSummaryFor(j.lines, sid); })  // After a continued recording, refresh to the full transcript
      .catch(() => { /* Give up if the transcript can't be read */ });
  }, [live.running, records, generateSummaryFor]);

  // Start recording: if the selected session was already recorded -> continue it (keep recording on, don't create a new one or clear its transcript/summary);
  // otherwise record a new session and clear the previous one's leftovers to avoid mixing sessions.
  const handleStartRecording = useCallback((o: Parameters<typeof live.start>[0]) => {
    if (activeSessionId && activeSession) {
      say(t('接着这节课继续录音'));
      void live.start({ ...o, appendSid: activeSessionId });
      return;
    }
    setActiveSessionId(null);
    setHistLines([]);
    setSummary(''); setKeyPoints([]); setCorrections([]); setAppliedCorrections([]); setSummaryError('');
    setFocusLineId(null);
    void live.start({ ...o });
  }, [live, activeSessionId, activeSession, say]);

  // Hide the "saved" banner when starting a new recording
  useEffect(() => {
    if (live.running) setJustEnded(false);
  }, [live.running]);

  // Starting a new recording (liveSid changed) -> clear the previous session's leftover board photos; but on a continued recording (liveSid == currently selected session) keep this session's board photos
  useEffect(() => {
    if (live.running && live.liveSid && live.liveSid !== activeSessionId) setShots([]);
  }, [live.liveSid]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleExport = useCallback(
    (format: 'word' | 'pdf', opts?: { summary?: boolean; corrections?: boolean; transcript?: boolean }) => {
      // Export only the summary by default; include 「可能错误」 and 「原文」 only when checked
      const o = opts ?? { summary: true, corrections: false, transcript: false };
      if (!o.summary && !o.corrections && !o.transcript) { say(t('请至少勾选一项导出内容')); return; }
      const doc = {
        title,
        subtitle: activeSession
          ? `${sessionDate(activeSession)} · ${fmtDuration(activeSession.duration_s)} · ${viewLines.length} 句`
          : `${viewLines.length} 句`,
        // Summary = summary body + key knowledge points
        summary: o.summary ? (summary || undefined) : undefined,
        keyPoints: o.summary ? keyPoints : [],
        // Possible errors: export the 「原始」 error list (listed even if the text was already replaced), to satisfy "point out the original errors"
        corrections: o.corrections ? corrections : undefined,
        // Original text: use the current transcript (with replacements already applied)
        lines: o.transcript
          ? viewLines.map((l) => ({ ts: l.ts, speaker: l.speaker, text: l.text, kind: l.kind }))
          : undefined,
      };
      const label = format === 'pdf' ? 'PDF' : 'Word';
      say(t('正在生成 {label}…', { label }));
      const run = format === 'pdf' ? exportPdf(doc) : exportWord(doc);
      void run.catch((e) => say(t('导出 {label} 失败:', { label }) + (e instanceof Error ? e.message : String(e))));
    },
    [title, activeSession, viewLines, summary, keyPoints, corrections, say]
  );

  const handleEditLine = useCallback(
    async (lineId: number, text: string) => {
      if (!activeSessionId) throw new Error(t('这节课还没保存，先停止录音'));
      await records.editLine(activeSessionId, lineId, text);
      const j = await records.loadTranscript(activeSessionId);
      setHistLines(j.lines);
    },
    [activeSessionId, records]
  );

  /** Manually mark/unmark a line as a highlight (in history), persisted and recolored immediately */
  const handleMarkLine = useCallback(
    async (lineId: number, kind: 'key' | 'define' | null) => {
      if (!activeSessionId) return;
      await records.markLine(activeSessionId, lineId, kind);
      setHistLines((prev) => prev.map((l) => (l.id === lineId ? { ...l, kind } : l)));
    },
    [activeSessionId, records]
  );

  /** Rename a speaker after recording: changes every line from that person, takes effect immediately, and is learned into the voiceprint library */
  const handleRenameSpeaker = useCallback(
    async (speakerId: number, name: string) => {
      if (!activeSessionId) return;
      const r = await records.renameSpeaker(activeSessionId, speakerId, name);
      setHistLines((prev) => prev.map((l) => (l.speaker_id === speakerId ? { ...l, speaker: name } : l)));
      const n = (r as { propagated_sessions?: number }).propagated_sessions ?? 0;
      if (name && n >= 1) say(t('已将「{name}」同步至此前 {n} 节课中的同一说话人', { name, n }));
    },
    [activeSessionId, records, say]
  );

  /** If editing a line changed just one word -> suggest adding it to this course's correction table, to auto-correct later */
  const proposeCorrection = useCallback(
    async (from: string, to: string) => {
      const cid = lib.assign[activeSessionId];
      const course = lib.courses.find((c) => c.id === cid);
      if (!course) {
        say(t('以后想自动把「{from}」改成「{to}」，先把这节课归到某门课程下', { from, to }));
        return;
      }
      if ((course.corrections ?? []).some((r) => r.from === from)) return;
      if (!window.confirm(t('以后自动把「{from}」改成「{to}」？（加进「{name}」的纠错表）', { from, to, name: course.name }))) return;
      await lib.updateCourse(course.id, {
        corrections: [...(course.corrections ?? []), { from, to, enabled: true }],
      });
      say(t('已加入「{name}」的纠错表', { name: course.name }));
    },
    [lib, activeSessionId, say]
  );

  /** Apply a correction: replace every 「from」 in the current transcript with 「to」 and persist */
  const handleApplyCorrection = useCallback(
    async (from: string, to: string, raw?: string) => {
      if (!activeSessionId) { say(t('这节课还没保存,先停止录音再纠错')); return; }
      if (!from || !to) return;
      try {
        // Match against the server's latest transcript (authoritative, unaffected by whether live or history is currently shown)
        // Server's latest transcript + what's on screen (viewLines includes old lines when continuing); match against their union,
        // to avoid misses when the server's copy lacks old lines due to sink/no-reload. Deduped by id.
        const j0 = await records.loadTranscript(activeSessionId);
        const byId = new Map<number, TranscriptLine>();
        for (const l of j0.lines) byId.set(l.id, l);
        for (const l of viewLinesRef.current) if (!byId.has(l.id)) byId.set(l.id, l);
        const affected = [...byId.values()].filter((l) => l.text.includes(from));
        if (affected.length === 0) {
          if (raw) setAppliedCorrections((prev) => (prev.includes(raw) ? prev : [...prev, raw]));
          say(t('转写里没找到「{from}」(可能已自动纠正)', { from }));
          return;
        }
        for (const l of affected) {
          await records.editLine(activeSessionId, l.id, l.text.split(from).join(to));
        }
        const j = await records.loadTranscript(activeSessionId);
        setHistLines(j.lines);
        if (raw) setAppliedCorrections((prev) => (prev.includes(raw) ? prev : [...prev, raw]));
        void records.learnTerm(to, from, activeSessionId ?? undefined);   // Personalized feedback: learn the correct term so future sessions are corrected automatically
        say(t('已把 {n} 处「{from}」改为「{to}」', { n: affected.length, from, to }));
      } catch (e) {
        say(t('替换失败:') + (e instanceof Error ? e.message : String(e)));
      }
    },
    [activeSessionId, records, say]
  );

  /** Replace all at once: apply every pending replacement to each line of the latest transcript (writing each line only once, to avoid overwriting), marking them all as replaced */
  const handleApplyAllCorrections = useCallback(async () => {
    if (!activeSessionId) { say(t('这节课还没保存,先停止录音再纠错')); return; }
    const pending = corrections.filter((c) => !appliedCorrections.includes(c));
    const pairs = pending
      .map((raw) => ({ raw, p: parseCorrection(raw) }))
      .filter((x): x is { raw: string; p: { from: string; to: string } } => !!x.p);
    if (pairs.length === 0) { say(t('没有可替换的项')); return; }
    try {
      const j0 = await records.loadTranscript(activeSessionId);
      const byId = new Map<number, TranscriptLine>();
      for (const l of j0.lines) byId.set(l.id, l);
      for (const l of viewLinesRef.current) if (!byId.has(l.id)) byId.set(l.id, l);
      let changed = 0;
      for (const line of byId.values()) {
        let t = line.text;
        for (const { p } of pairs) if (t.includes(p.from)) t = t.split(p.from).join(p.to);
        if (t !== line.text) { await records.editLine(activeSessionId, line.id, t); changed++; }
      }
      const j = await records.loadTranscript(activeSessionId);
      setHistLines(j.lines);
      setAppliedCorrections((prev) => Array.from(new Set([...prev, ...pending])));
      pairs.forEach(({ p }) => void records.learnTerm(p.to, p.from, activeSessionId ?? undefined));   // Personalized feedback: learn all the corrected terms
      say(changed > 0 ? t('已一键替换 {n} 行', { n: changed }) : t('转写里没找到这些词(可能已替换)'));
    } catch (e) {
      say(t('替换失败:') + (e instanceof Error ? e.message : String(e)));
    }
  }, [activeSessionId, corrections, appliedCorrections, records, say]);

  /** Photograph board notes while recording: aligned to the current recording second */
  const handleShoot = useCallback(
    async (file: File) => {
      const sid = live.liveSid || activeSessionId;
      if (!sid) throw new Error(t('还没开始录音'));
      const dataUrl = await compressImage(file);
      const shot = await lib.addShot(sid, live.status.elapsed || 0, dataUrl);
      // The session currently being viewed is the one just photographed (live: sid=liveSid; history: sid=activeSessionId) -> put it on screen immediately
      if (sid === activeSessionId || sid === live.liveSid) {
        setShots((s) => [...s, shot].sort((a, b) => a.at - b.at));
      }
    },
    [live.liveSid, live.status.elapsed, activeSessionId, lib]
  );

  const seek = useCallback((seconds: number) => {
    setActiveTab('transcription');
    setTimeout(() => playerRef.current?.seek(seconds), 60);
  }, []);

  return (
    <div className="min-h-screen bg-background-100">
      <nav className="sticky top-0 z-30 bg-background-50/95 backdrop-blur-sm border-b border-background-200">
        <div className="flex items-center justify-between h-14 px-3 sm:px-6 gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <BackButton className="flex items-center gap-1 h-8 px-3 rounded-lg bg-background-100 hover:bg-background-200 text-foreground-600 hover:text-foreground-800 transition-colors cursor-pointer whitespace-nowrap">
              <i className="ri-arrow-left-line"></i>
              <span className="hidden sm:inline text-xs font-medium">{t('返回')}</span>
            </BackButton>
            <div className="w-8 h-8 flex items-center justify-center bg-accent-100 rounded-lg flex-shrink-0">
              <i className="ri-book-open-line text-accent-600"></i>
            </div>
            <h1 className="text-sm font-semibold text-foreground-900 truncate">{title}</h1>
            {activeSession && (
              <span className="hidden sm:inline text-xs text-foreground-400 flex-shrink-0">
                {sessionDate(activeSession)} · {fmtDuration(activeSession.duration_s)}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5 sm:gap-3 flex-shrink-0">
            <SearchBox
              onSearch={lib.search}
              onJump={(hit) => {
                if (hit.sid !== activeSessionId) handleSelectSession(hit.sid);
                setActiveTab('transcription');
                setFocusLineId(hit.line_id);
                setTimeout(() => playerRef.current?.seek(hit.start), 400);
              }}
            />
            <button
              onClick={() => handleExport('word')}
              disabled={viewLines.length === 0}
              className="w-9 h-9 flex items-center justify-center rounded-lg bg-background-100 text-foreground-500 hover:text-foreground-700 hover:bg-background-200 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              title={t('导出 Word(摘要)')}
            >
              <i className="ri-file-word-2-line"></i>
            </button>
            <button
              onClick={() => setShowEditHistory(true)}
              className="w-9 h-9 flex items-center justify-center rounded-lg bg-background-100 text-foreground-500 hover:text-foreground-700 hover:bg-background-200 transition-colors cursor-pointer"
              title={t('编辑历史')}
            >
              <i className="ri-history-line"></i>
            </button>
            <button
              onClick={() => setShowSharePanel(true)}
              className="w-9 h-9 flex items-center justify-center rounded-lg bg-background-100 text-foreground-500 hover:text-foreground-700 hover:bg-background-200 transition-colors cursor-pointer"
              title={t('共享设置')}
            >
              <i className="ri-share-line"></i>
            </button>
          </div>
        </div>
      </nav>

      <div className="max-w-5xl mx-auto px-3 sm:px-6 py-4 sm:py-6">
        {justEnded && !live.running && (
          <div className="mb-5 flex items-center justify-between gap-3 flex-wrap bg-green-50 border border-green-200 rounded-xl px-4 py-3">
            <div className="flex items-center gap-2 text-sm text-green-800">
              <i className="ri-checkbox-circle-fill text-green-500 text-lg"></i>
              <span>{t('这节课已保存,并生成了 AI 概要。在主界面「最近课时」能找到它。')}</span>
            </div>
            <div className="flex items-center gap-2">
              <BackButton className="flex items-center gap-1.5 px-4 py-2 bg-primary-500 text-background-50 rounded-full text-sm font-semibold hover:bg-primary-600 transition-colors cursor-pointer whitespace-nowrap">
                <i className="ri-home-4-line"></i>{t('返回')}
              </BackButton>
              <button
                onClick={() => setJustEnded(false)}
                className="px-3 py-2 text-sm text-foreground-500 hover:text-foreground-700 cursor-pointer whitespace-nowrap"
              >
                {t('留在此页')}
              </button>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
          <div>
            <h2 className="text-base font-semibold text-foreground-900">{title}</h2>
            <p className="text-xs text-foreground-400 mt-0.5">
              {live.running
                ? t('正在录制…')
                : activeSession
                  ? `${sessionDate(activeSession)} · ${t('{n} 句', { n: viewLines.length })}`
                  : t('还没有录制记录')}
            </p>
          </div>
          <Tabs tabs={tabs.map((tb) => ({ ...tb, label: t(tb.label) }))} activeTab={activeTab} onTabChange={setActiveTab} />
        </div>

        {activeTab === 'transcription' && (
          <TranscriptionTab
            sid={activeSessionId}
            sessionTitle={title}
            onGenerateSummary={handleGenerateSummary}
            onStartRecording={handleStartRecording}
            onEndRecording={handleEndRecording}
            autoStartNaming={autoNew}
            initialCourseName={initialTitle}
            note={note}
            noteStatus={noteStatus}
            canNote={!!noteSid}
            onNoteChange={handleNoteChange}
            isGenerating={isGenerating}
            live={live}
            historyLines={histLines}
            shots={shots}
            courses={lib.courses}
            subjectTags={subjectTags}
            onEditLine={handleEditLine}
            onMarkLine={handleMarkLine}
            onRenameSpeaker={handleRenameSpeaker}
            onProposeCorrection={proposeCorrection}
            onShoot={handleShoot}
            onDeleteShot={async (id) => {
              await lib.deleteShot(activeSessionId, id);
              setShots((s) => s.filter((x) => x.id !== id));
            }}
            onNoteShot={async (id, note) => {
              await lib.noteShot(activeSessionId, id, note);
              setShots((s) => s.map((x) => (x.id === id ? { ...x, note } : x)));
            }}
            canEdit={!live.running && !!activeSessionId}
            playerRef={playerRef}
            focusLineId={focusLineId}
          />
        )}

        {activeTab === 'summary' && (
          <SummaryTab
            summary={summary}
            keyPoints={keyPoints}
            corrections={corrections}
            appliedCorrections={appliedCorrections}
            transcriptText={viewLines.map((l) => l.text).join('')}
            onApplyCorrection={handleApplyCorrection}
            onApplyAll={handleApplyAllCorrections}
            sessionTitle={title}
            onExport={handleExport}
            onSaveSummary={handleSaveSummary}
            canSave={!!activeSessionId}
            error={summaryError}
            deepseekReady={live.deepseekReady}
          />
        )}

        {activeTab === 'review' && (
          <ReviewTab
            sid={activeSessionId}
            title={title}
            hasLines={viewLines.length > 0}
            onStudy={lib.study}
            onAsk={lib.ask}
            onSeek={seek}
          />
        )}

        {activeTab === 'history' && (
          <HistoryTab
            sessions={records.sessions}
            loading={records.loading}
            error={records.error || lib.error}
            activeSessionId={activeSessionId}
            courses={lib.courses}
            assign={lib.assign}
            onSelectSession={handleSelectSession}
            onReload={() => { void records.reload(); void lib.reloadCourses(); }}
            onCreateCourse={lib.createCourse}
            onDeleteCourse={lib.deleteCourse}
            onAssign={lib.assignSession}
            onEditCourse={setEditingCourse}
            onBatchExport={handleBatchExport}
          />
        )}
      </div>

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 bg-foreground-900 text-background-50 rounded-full text-xs shadow-lg">
          {toast}
        </div>
      )}

      <SharePanel
        isOpen={showSharePanel}
        onClose={() => setShowSharePanel(false)}
        sessionId={activeSessionId}
        sessionTitle={title}
        sessions={records.sessions.map((s) => ({ id: s.id, title: sessionTitle(s) }))}
        onCreate={records.createShare}
        onRevoke={records.revokeShare}
      />

      <EditHistoryPanel
        sessionId={activeSessionId}
        isOpen={showEditHistory}
        onClose={() => setShowEditHistory(false)}
        onLoad={records.loadEdits}
        onRevert={handleEditLine}
      />

      <CoursePanel
        course={editingCourse}
        isOpen={!!editingCourse}
        onClose={() => setEditingCourse(null)}
        onSave={lib.updateCourse}
      />
    </div>
  );
}
