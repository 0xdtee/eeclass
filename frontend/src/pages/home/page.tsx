import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
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

const tabs = [
  { id: 'transcription', label: '实时转写', icon: 'ri-mic-line' },
  { id: 'summary', label: '摘要预览', icon: 'ri-magic-line' },
  { id: 'review', label: '复习', icon: 'ri-book-read-line' },
  { id: 'history', label: '历史课程', icon: 'ri-history-line' },
];

export default function HomePage() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('transcription');
  const [activeSessionId, setActiveSessionId] = useState('');
  const [showSharePanel, setShowSharePanel] = useState(false);
  const [showEditHistory, setShowEditHistory] = useState(false);
  const [subjectTags, setSubjectTags] = useState<string[]>([]);   // 学科标签(课程大纲名),勾选给纠错当上下文
  const [editingCourse, setEditingCourse] = useState<Course | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [summary, setSummary] = useState('');
  const [keyPoints, setKeyPoints] = useState<string[]>([]);
  const [corrections, setCorrections] = useState<string[]>([]);   // 转写可能听错,单独一块(原始记录,导出时用,不删)
  const [appliedCorrections, setAppliedCorrections] = useState<string[]>([]);   // 已一键替换掉的,列表里隐藏但记录保留
  const [summaryError, setSummaryError] = useState('');
  const [histLines, setHistLines] = useState<TranscriptLine[]>([]);
  const [shots, setShots] = useState<Shot[]>([]);
  const [focusLineId, setFocusLineId] = useState<number | null>(null);
  const [toast, setToast] = useState('');
  const [justEnded, setJustEnded] = useState(false);   // 刚结束录制,显示"已保存·返回主界面"提示条
  const [note, setNote] = useState('');
  const [noteStatus, setNoteStatus] = useState<'' | 'saving' | 'saved'>('');

  // 实时字幕的连接放在页面层：切换标签页会卸载转写组件，
  // 连接跟着断的话，已经出来的字幕就没了（服务端其实还在录）。
  const live = useLiveCaption();
  const records = useRecords();
  const lib = useLibrary();
  const playerRef = useRef<AudioPlayerHandle | null>(null);
  const noteTimer = useRef<number | null>(null);
  const noteSid = live.liveSid || activeSessionId;   // 笔记挂到正在录/正在看的这节课

  // 主界面「快捷通道」带参数进来:打开对应标签/面板/直接开录
  const [searchParams] = useSearchParams();
  const [autoNew] = useState(() => searchParams.get('new') === '1');
  const [initialTitle] = useState(() => searchParams.get('title') || '');   // 从课表点进来时预填的课名
  // 从仪表盘「查看纪要」进来(?tab=summary&sid=…):落到摘要页后,若还没生成过就自动生成一次
  const wantAutoSummary = useRef(
    searchParams.get('tab') === 'summary' && !!searchParams.get('sid')
  );
  useEffect(() => {
    const tab = searchParams.get('tab');
    const sid = searchParams.get('sid');
    if (sid) {
      // 从仪表盘「最近课时」点进来:直接选中这节课并看它的转写
      setActiveSessionId(sid);
      if (!tab) setActiveTab('transcription');
    }
    if (tab && tabs.some((t) => t.id === tab)) setActiveTab(tab);
    if (searchParams.get('share') === '1') setShowSharePanel(true);
    // 只在进入时读一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 只在明确选中某节课时才有 activeSession(不再默认兜底到最新一节)——
  // 否则新录音页会莫名显示上一节的转写
  const activeSession = useMemo(
    () => (activeSessionId ? records.sessions.find((s) => s.id === activeSessionId) : undefined),
    [records.sessions, activeSessionId]
  );
  // 正在 live 录音时优先显示录制态，别再显示"未开始录制"(新用户没有已存会话)
  const title = live.running
    ? '正在录制…'
    : activeSession
      ? sessionTitle(activeSession)
      : '未开始录制';


  // 切课时读转写和板书
  useEffect(() => {
    if (!activeSessionId) return;
    let cancelled = false;
    void records.loadTranscript(activeSessionId)
      .then((j) => !cancelled && setHistLines(j.lines))
      .catch(() => !cancelled && setHistLines([]));
    void lib.loadShots(activeSessionId)
      .then((j) => !cancelled && setShots(j.shots))
      .catch(() => !cancelled && setShots([]));
    // 读回这节课已保存的 AI 摘要(有就直接显示,不用重新生成)
    void records.loadSummary(activeSessionId)
      .then((s) => {
        if (cancelled || !s || !s.summary) return;
        setSummary(s.summary);
        setKeyPoints(s.key_points ?? []);
        setCorrections(s.corrections ?? []);
        setAppliedCorrections(s.applied ?? []);
      })
      .catch(() => { /* 没存过摘要,忽略 */ });
    return () => { cancelled = true; };
    // records/lib 每次渲染是新对象,不能进依赖(否则每渲染都重拉→请求风暴);只在切课时跑
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionId]);

  // 录完一节课，刷新列表
  useEffect(() => {
    if (!live.lastDir || live.running) return;
    void records.reload();
    void lib.reloadCourses();
    // 同理:依赖只放稳定的 lastDir/running,别放 records/lib(否则停止后无限刷列表)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live.lastDir, live.running]);

  // 切课 / 开录时读回这节课的笔记(只在 noteSid 变化时读——
  // records 每次渲染是新对象,不能放进依赖,否则每次打字都会把内容重新拉回覆盖掉)
  useEffect(() => {
    if (!noteSid) { setNote(''); setNoteStatus(''); return; }
    let cancelled = false;
    void records.loadNote(noteSid)
      .then((r) => { if (!cancelled) { setNote(r.note || ''); setNoteStatus(''); } })
      .catch(() => undefined);
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteSid]);

  // 笔记改动:防抖 0.8s 自动存
  const handleNoteChange = useCallback((text: string) => {
    setNote(text);
    if (!noteSid) return;
    setNoteStatus('saving');
    if (noteTimer.current) window.clearTimeout(noteTimer.current);
    noteTimer.current = window.setTimeout(() => {
      void records.saveNote(noteSid, text).then(() => setNoteStatus('saved')).catch(() => setNoteStatus(''));
    }, 800);
  }, [noteSid, records]);

  // 学科标签:默认带上「全国版课程大纲(教育部·教指委 全国基本要求)」里的课程,始终可勾选;
  // 再并上本机已下载的其它大纲,去重后供选择(给 AI 纠错/翻译当学科上下文)。
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

  // 批量导出:把选中的多节课拼成一个 PDF(每节含摘要+重点+可能听错+转写全文)
  const handleBatchExport = useCallback(async (ids: string[]) => {
    if (!ids.length) { say('先勾选要导出的课时'); return; }
    say(`正在导出 ${ids.length} 节…`);
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
      say(`已导出 ${docs.length} 节`);
    } catch (e) {
      say('导出失败:' + (e instanceof Error ? e.message : String(e)));
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

  // 显示哪份转写:
  // 1) 明确点开了某节存档课,且它不是当前正在录的这节 -> 显示存档(哪怕重登后 live 因
  //    自动恢复而 running=true、live.lines 却是空的,也不能让空 live 盖住历史)。
  // 2) 正在录音 / 本次已出字 -> 显示 live(录制中不回退到历史,否则开新课会看到上一节)。
  const viewLines: TranscriptLine[] = useMemo(() => {
    const liveView = live.lines.map((l) => ({
      id: l.id, ts: l.ts, speaker: l.speaker, speaker_id: l.speaker_id,
      text: l.text, kind: l.kind, new_para: l.new_para, start: l.start, end: l.end,
      translation: l.translation,
    }));
    if (live.running) {
      // 在看别的存档课(不是正在录的这节)→ 看存档
      if (activeSessionId && activeSessionId !== live.liveSid) return histLines;
      // 续录:老转写(histLines)在前 + 本次新说的(liveView)在后,接起来一起显示;
      // 新句 id 接着老的往后排,按 id 去重防重叠。新录一节时 histLines 为空,自然只剩 liveView。
      if (activeSessionId && activeSessionId === live.liveSid && histLines.length) {
        const liveIds = new Set(liveView.map((l) => l.id));
        return [...histLines.filter((l) => !liveIds.has(l.id)), ...liveView];
      }
      return liveView;
    }
    // 停止后:优先看选中这节课的存档全文(续录后含旧+新);没有存档再退回 live
    if (activeSessionId) return histLines.length ? histLines : liveView;
    if (live.lines.length > 0) return liveView;
    return histLines;
  }, [activeSessionId, live.liveSid, live.running, live.lines, histLines]);

  // 让替换等回调随时拿到"当前屏上这些行"(续录时含老句),不用把 viewLines 塞进依赖
  const viewLinesRef = useRef<TranscriptLine[]>([]);
  viewLinesRef.current = viewLines;

  // 用指定的转写行+会话 sid 生成概要(和"当前看的是哪节"解耦,避免概要跑到错的课上)
  const generateSummaryFor = useCallback(async (lines: TranscriptLine[], sid: string | null) => {
    if (lines.length === 0) {
      setSummaryError('这节课还没有转写内容');
      setActiveTab('summary');
      return;
    }
    setIsGenerating(true);
    setSummaryError('');
    try {
      // 交给服务端调 DeepSeek —— API key 只在服务端，浏览器拿不到也不需要
      const ai = await live.summarize(title, lines, sid || live.liveSid);
      setSummary(ai.summary);
      setKeyPoints([
        ...(ai.key_points ?? []),
        ...(ai.exam_hints ?? []).map((x) => `【老师说要考】${x}`),
        ...(ai.formulas ?? []).map((x) => `【公式/定理】${x}`),
        ...(ai.questions ?? []).map((x) => `【课堂问答】${x}`),
      ]);
      setCorrections(ai.corrections ?? []);   // 听错提示单独放,不混进重点
      setAppliedCorrections([]);              // 新生成的摘要,替换记录清零
      setActiveTab('summary');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setSummaryError(msg);
      // AI 挂了也别让人一无所获：退回规则标出的重点，并说清这不是 AI 生成的
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

  // 从仪表盘「查看纪要」进来:等这节课的转写加载好了,自动生成一次摘要(只做一次)
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

  // 摘要有内容且选中了课 → 自动落盘保存(生成完/纠错后都会带上,刷新和列表都能看到)
  useEffect(() => {
    if (!activeSessionId || !summary || isGenerating) return;
    void records.saveSummary(activeSessionId, { summary, key_points: keyPoints, corrections, applied: appliedCorrections });
    // records 每渲染新对象,不放依赖(否则每渲染都重复 POST 保存)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionId, summary, keyPoints, corrections, appliedCorrections, isGenerating]);

  // 「保存摘要」按钮:手动存一次并提示
  const handleSaveSummary = useCallback(async () => {
    if (!activeSessionId) { say('这节课还没保存,先停止录音'); return; }
    if (!summary) { say('还没有摘要可保存'); return; }
    try {
      await records.saveSummary(activeSessionId, { summary, key_points: keyPoints, corrections, applied: appliedCorrections });
      await records.reload();
      say('摘要已保存');
    } catch (e) {
      say('保存失败:' + (e instanceof Error ? e.message : String(e)));
    }
  }, [activeSessionId, summary, keyPoints, corrections, appliedCorrections, records, say]);

  // 结束录制:停止 → 自动生成 AI 概要 → 选中刚结束的这节课(它已落盘进历史,别让它从视图消失)
  const pendingSummaryRef = useRef<string | null>(null);

  const handleEndRecording = useCallback(() => {
    const endedSid = live.liveSid;
    live.stop();
    if (endedSid) {
      setActiveSessionId(endedSid);
      pendingSummaryRef.current = endedSid;   // 等后端落盘完(收到 stopped)再用完整转写生成概要
    }
    void records.reload();             // 确保刚结束的这节课出现在历史里
    setJustEnded(true);                // 显示"已保存·返回主界面"提示条
  }, [live, records]);

  // 后端确认停止(running 变 false)→ 用服务端完整转写(续录后含旧+新)生成概要
  useEffect(() => {
    if (live.running) return;
    const sid = pendingSummaryRef.current;
    if (!sid) return;
    pendingSummaryRef.current = null;
    const auto = loadSettings().autoSummary;
    void records.loadTranscript(sid)
      .then((j) => { setHistLines(j.lines); if (auto) void generateSummaryFor(j.lines, sid); })  // 续录后刷新成完整转写
      .catch(() => { /* 转写读不到就算了 */ });
  }, [live.running, records, generateSummaryFor]);

  // 开始录制:选中的是一节已录过的课 → 续录(接着往下录,别新建、别清它的转写/摘要);
  // 否则新录一节,清掉上一节残留别串课。
  const handleStartRecording = useCallback((o: Parameters<typeof live.start>[0]) => {
    if (activeSessionId && activeSession) {
      say('接着这节课继续录音');
      void live.start({ ...o, appendSid: activeSessionId });
      return;
    }
    setActiveSessionId(null);
    setHistLines([]);
    setSummary(''); setKeyPoints([]); setCorrections([]); setAppliedCorrections([]); setSummaryError('');
    setFocusLineId(null);
    void live.start({ ...o });
  }, [live, activeSessionId, activeSession, say]);

  // 开新录音时收起"已保存"提示条
  useEffect(() => {
    if (live.running) setJustEnded(false);
  }, [live.running]);

  // 新开一段录音(liveSid 变了)→ 清掉上一节残留的板书;但续录(liveSid==当前选中课)要保留本节板书
  useEffect(() => {
    if (live.running && live.liveSid && live.liveSid !== activeSessionId) setShots([]);
  }, [live.liveSid]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleExport = useCallback(
    (format: 'word' | 'pdf', opts?: { summary?: boolean; corrections?: boolean; transcript?: boolean }) => {
      // 默认只导摘要;勾选后才带上「可能错误」和「原文」
      const o = opts ?? { summary: true, corrections: false, transcript: false };
      if (!o.summary && !o.corrections && !o.transcript) { say('请至少勾选一项导出内容'); return; }
      const doc = {
        title,
        subtitle: activeSession
          ? `${sessionDate(activeSession)} · ${fmtDuration(activeSession.duration_s)} · ${viewLines.length} 句`
          : `${viewLines.length} 句`,
        // 摘要 = 概要正文 + 重点知识点
        summary: o.summary ? (summary || undefined) : undefined,
        keyPoints: o.summary ? keyPoints : [],
        // 可能错误:导出「原始」错误清单(即使原文已替换也照列),满足"指出原来的错误"
        corrections: o.corrections ? corrections : undefined,
        // 原文:用当前转写(已含替换)
        lines: o.transcript
          ? viewLines.map((l) => ({ ts: l.ts, speaker: l.speaker, text: l.text, kind: l.kind }))
          : undefined,
      };
      const label = format === 'pdf' ? 'PDF' : 'Word';
      say(`正在生成 ${label}…`);
      const run = format === 'pdf' ? exportPdf(doc) : exportWord(doc);
      void run.catch((e) => say(`导出 ${label} 失败:` + (e instanceof Error ? e.message : String(e))));
    },
    [title, activeSession, viewLines, summary, keyPoints, corrections, say]
  );

  const handleEditLine = useCallback(
    async (lineId: number, text: string) => {
      if (!activeSessionId) throw new Error('这节课还没保存，先停止录音');
      await records.editLine(activeSessionId, lineId, text);
      const j = await records.loadTranscript(activeSessionId);
      setHistLines(j.lines);
    },
    [activeSessionId, records]
  );

  /** 逐句手动标记 重点/取消(历史记录里),持久保存并立即变色 */
  const handleMarkLine = useCallback(
    async (lineId: number, kind: 'key' | 'define' | null) => {
      if (!activeSessionId) return;
      await records.markLine(activeSessionId, lineId, kind);
      setHistLines((prev) => prev.map((l) => (l.id === lineId ? { ...l, kind } : l)));
    },
    [activeSessionId, records]
  );

  /** 录制后改说话人名字:这个人的每一句都改,立即生效,并学进声纹库 */
  const handleRenameSpeaker = useCallback(
    async (speakerId: number, name: string) => {
      if (!activeSessionId) return;
      const r = await records.renameSpeaker(activeSessionId, speakerId, name);
      setHistLines((prev) => prev.map((l) => (l.speaker_id === speakerId ? { ...l, speaker: name } : l)));
      const n = (r as { propagated_sessions?: number }).propagated_sessions ?? 0;
      if (name && n >= 1) say(`已把「${name}」同步到过去 ${n} 节课里的同一个人`);
    },
    [activeSessionId, records, say]
  );

  /** 改完一句只换了一个词 → 提议加进这门课的纠错表，以后自动纠 */
  const proposeCorrection = useCallback(
    async (from: string, to: string) => {
      const cid = lib.assign[activeSessionId];
      const course = lib.courses.find((c) => c.id === cid);
      if (!course) {
        say(`以后想自动把「${from}」改成「${to}」，先把这节课归到某门课程下`);
        return;
      }
      if ((course.corrections ?? []).some((r) => r.from === from)) return;
      if (!window.confirm(`以后自动把「${from}」改成「${to}」？（加进「${course.name}」的纠错表）`)) return;
      await lib.updateCourse(course.id, {
        corrections: [...(course.corrections ?? []), { from, to, enabled: true }],
      });
      say(`已加入「${course.name}」的纠错表`);
    },
    [lib, activeSessionId, say]
  );

  /** 应用一条纠错:把当前转写里所有「from」替换成「to」并落盘 */
  const handleApplyCorrection = useCallback(
    async (from: string, to: string, raw?: string) => {
      if (!activeSessionId) { say('这节课还没保存,先停止录音再纠错'); return; }
      if (!from || !to) return;
      try {
        // 用服务端最新转写来匹配(权威、不受当前显示的是 live 还是历史影响)
        // 服务端最新转写 + 当前屏上看到的(续录时 viewLines 含老句),取并集来匹配,
        // 避免服务端那份因下沉/未回灌缺了老句导致找不到。按 id 去重。
        const j0 = await records.loadTranscript(activeSessionId);
        const byId = new Map<number, TranscriptLine>();
        for (const l of j0.lines) byId.set(l.id, l);
        for (const l of viewLinesRef.current) if (!byId.has(l.id)) byId.set(l.id, l);
        const affected = [...byId.values()].filter((l) => l.text.includes(from));
        if (affected.length === 0) {
          if (raw) setAppliedCorrections((prev) => (prev.includes(raw) ? prev : [...prev, raw]));
          say(`转写里没找到「${from}」(可能已自动纠正)`);
          return;
        }
        for (const l of affected) {
          await records.editLine(activeSessionId, l.id, l.text.split(from).join(to));
        }
        const j = await records.loadTranscript(activeSessionId);
        setHistLines(j.lines);
        if (raw) setAppliedCorrections((prev) => (prev.includes(raw) ? prev : [...prev, raw]));
        void records.learnTerm(to);   // 个性化反哺:学下正确术语,以后开的课自动纠
        say(`已把 ${affected.length} 处「${from}」改为「${to}」`);
      } catch (e) {
        say('替换失败:' + (e instanceof Error ? e.message : String(e)));
      }
    },
    [activeSessionId, records, say]
  );

  /** 一键全部替换:对最新转写的每一行套用所有待替换项(每行只写一次,避免互相覆盖),全部标记已替换 */
  const handleApplyAllCorrections = useCallback(async () => {
    if (!activeSessionId) { say('这节课还没保存,先停止录音再纠错'); return; }
    const pending = corrections.filter((c) => !appliedCorrections.includes(c));
    const pairs = pending
      .map((raw) => ({ raw, p: parseCorrection(raw) }))
      .filter((x): x is { raw: string; p: { from: string; to: string } } => !!x.p);
    if (pairs.length === 0) { say('没有可替换的项'); return; }
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
      pairs.forEach(({ p }) => void records.learnTerm(p.to));   // 个性化反哺:学下所有纠对的术语
      say(changed > 0 ? `已一键替换 ${changed} 行` : '转写里没找到这些词(可能已替换)');
    } catch (e) {
      say('替换失败:' + (e instanceof Error ? e.message : String(e)));
    }
  }, [activeSessionId, corrections, appliedCorrections, records, say]);

  /** 录制中拍板书：按当前录音秒数对齐 */
  const handleShoot = useCallback(
    async (file: File) => {
      const sid = live.liveSid || activeSessionId;
      if (!sid) throw new Error('还没开始录音');
      const dataUrl = await compressImage(file);
      const shot = await lib.addShot(sid, live.status.elapsed || 0, dataUrl);
      // 当前正在看的这节课就是刚拍的这节(直播:sid=liveSid;历史:sid=activeSessionId)→ 立即上屏
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
        <div className="flex items-center justify-between h-14 px-6">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => navigate('/')}
              className="flex items-center gap-1 h-8 px-3 rounded-lg bg-background-100 hover:bg-background-200 text-foreground-600 hover:text-foreground-800 transition-colors cursor-pointer whitespace-nowrap"
              title="返回主界面"
            >
              <i className="ri-arrow-left-line"></i>
              <span className="text-xs font-medium">返回主界面</span>
            </button>
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

          <div className="flex items-center gap-3">
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
              title="导出 Word(摘要)"
            >
              <i className="ri-file-word-2-line"></i>
            </button>
            <button
              onClick={() => setShowEditHistory(true)}
              className="w-9 h-9 flex items-center justify-center rounded-lg bg-background-100 text-foreground-500 hover:text-foreground-700 hover:bg-background-200 transition-colors cursor-pointer"
              title="编辑历史"
            >
              <i className="ri-history-line"></i>
            </button>
            <button
              onClick={() => setShowSharePanel(true)}
              className="w-9 h-9 flex items-center justify-center rounded-lg bg-background-100 text-foreground-500 hover:text-foreground-700 hover:bg-background-200 transition-colors cursor-pointer"
              title="共享设置"
            >
              <i className="ri-share-line"></i>
            </button>
          </div>
        </div>
      </nav>

      <div className="max-w-5xl mx-auto px-6 py-6">
        {justEnded && !live.running && (
          <div className="mb-5 flex items-center justify-between gap-3 flex-wrap bg-green-50 border border-green-200 rounded-xl px-4 py-3">
            <div className="flex items-center gap-2 text-sm text-green-800">
              <i className="ri-checkbox-circle-fill text-green-500 text-lg"></i>
              <span>这节课已保存,并生成了 AI 概要。在主界面「最近课时」能找到它。</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => navigate('/')}
                className="flex items-center gap-1.5 px-4 py-2 bg-primary-500 text-background-50 rounded-full text-sm font-semibold hover:bg-primary-600 transition-colors cursor-pointer whitespace-nowrap"
              >
                <i className="ri-home-4-line"></i>返回主界面
              </button>
              <button
                onClick={() => setJustEnded(false)}
                className="px-3 py-2 text-sm text-foreground-500 hover:text-foreground-700 cursor-pointer whitespace-nowrap"
              >
                留在这
              </button>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
          <div>
            <h2 className="text-base font-semibold text-foreground-900">{title}</h2>
            <p className="text-xs text-foreground-400 mt-0.5">
              {live.running
                ? '正在录制…'
                : activeSession
                  ? `${sessionDate(activeSession)} · ${viewLines.length} 句`
                  : '还没有录制记录'}
            </p>
          </div>
          <Tabs tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />
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
