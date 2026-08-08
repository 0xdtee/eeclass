import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useRecords, sessionTitle, sessionDate, fmtDuration } from '@/hooks/useRecords';
import type { CourseSummary, CourseExam, CourseMock, SessionMeta } from '@/hooks/useRecords';
import { useTagsStore } from '@/hooks/useTagsStore';
import { audioUrl, audioDownloadUrl } from '@/hooks/useLibrary';
import BackButton from '@/components/feature/BackButton';
import MathText from '@/components/base/MathText';
import AudioPlayer from '@/components/feature/AudioPlayer';

// 选择题选项 A./B./C./D. 常糊在一行,显示时在每个选项前插换行(要求后面带空格,避免误伤「A、B、ω为常量」这种)
function splitChoices(s: string): string {
  return (s || '').replace(/\s+(?=[A-H][.．)]\s)/g, '\n');
}

type TabId = 'summary' | 'audio' | 'exam' | 'mock';
const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: 'summary', label: '课程总结', icon: 'ri-magic-line' },
  { id: 'audio', label: '录音集合', icon: 'ri-mic-line' },
  { id: 'exam', label: '考点推测', icon: 'ri-pie-chart-2-line' },
  { id: 'mock', label: '模拟试卷', icon: 'ri-file-list-3-line' },
];
const PIE = ['#f87171', '#60a5fa', '#a78bfa', '#34d399', '#fbbf24', '#fb7185', '#22d3ee', '#a3e635'];
const baseName = (t: string) =>
  (t || '').replace(/\s*第\s*\d+\s*[课讲节]\s*$/, '').replace(/\s*[（(]\s*\d+\s*[）)]\s*$/, '').trim();

// 考点名和总结模块的相关度:共有的汉字个数(简单但对中文有效)
function overlapScore(a: string, b: string): number {
  const isCJK = (c: string) => /[一-鿿]/.test(c);
  const sa = new Set(Array.from(a || '').filter(isCJK));
  let n = 0;
  for (const c of new Set(Array.from(b || '').filter(isCJK))) if (sa.has(c)) n++;
  return n;
}

/* ---- SVG 饼图(切片上带考点名 + 百分比)---- */
function Pie({ values, labels, selected, onSelect }: { values: number[]; labels: string[]; selected: number; onSelect: (i: number) => void }) {
  const total = values.reduce((s, v) => s + Math.max(0, v), 0) || 1;
  const cx = 100, cy = 100, r = 92;
  let acc = 0;
  const arcs = values.map((v, i) => {
    const frac = Math.max(0, v) / total;
    const start = (acc / total) * 2 * Math.PI;
    const mid = ((acc + Math.max(0, v) / 2) / total) * 2 * Math.PI;
    acc += Math.max(0, v);
    const end = (acc / total) * 2 * Math.PI;
    const large = end - start > Math.PI ? 1 : 0;
    const x1 = cx + r * Math.sin(start), y1 = cy - r * Math.cos(start);
    const x2 = cx + r * Math.sin(end), y2 = cy - r * Math.cos(end);
    const d = values.length === 1
      ? `M${cx - r},${cy} a${r},${r} 0 1,0 ${2 * r},0 a${r},${r} 0 1,0 ${-2 * r},0`
      : `M${cx},${cy} L${x1.toFixed(2)},${y1.toFixed(2)} A${r},${r} 0 ${large} 1 ${x2.toFixed(2)},${y2.toFixed(2)} Z`;
    const lr = values.length === 1 ? 0 : r * 0.62;
    const lx = cx + lr * Math.sin(mid), ly = cy - lr * Math.cos(mid);
    const name = labels[i] || '';
    const short = name.length > 5 ? name.slice(0, 5) + '…' : name;
    return { d, i, frac, lx, ly, short, pct: Math.round(frac * 100) };
  });
  return (
    <svg viewBox="0 0 200 200" className="w-60 h-60">
      {arcs.map((a) => (
        <path
          key={a.i}
          d={a.d}
          fill={PIE[a.i % PIE.length]}
          stroke="#fff"
          strokeWidth={selected === a.i ? 3 : 1}
          className={`cursor-pointer transition-opacity ${selected === a.i ? 'opacity-100' : 'opacity-80 hover:opacity-100'}`}
          onClick={() => onSelect(a.i)}
        />
      ))}
      {/* 切片够大才标名字,太小的靠下面图例 */}
      {arcs.filter((a) => a.frac >= 0.07).map((a) => (
        <text key={'t' + a.i} textAnchor="middle" fill="#fff" className="pointer-events-none select-none" style={{ fontWeight: 600 }}>
          <tspan x={a.lx} y={a.ly} fontSize="7.5">{a.short}</tspan>
          <tspan x={a.lx} y={a.ly + 9} fontSize="9">{a.pct}%</tspan>
        </text>
      ))}
    </svg>
  );
}

export default function CourseDetailPage() {
  const [sp] = useSearchParams();
  const name = sp.get('name') || '';
  const tag = sp.get('tag') || '';       // 有 tag 时优先按标签聚合(否则按课程名)
  const byTag = !!tag;
  const displayName = tag || name;       // 页面各处展示用的名字
  const navigate = useNavigate();
  const records = useRecords();
  const { tags: allTags } = useTagsStore();
  // 本地标签覆盖:给录音打完标签立即生效,不必等重新拉取
  const [localTags, setLocalTags] = useState<Record<string, string[]>>({});
  const effTags = useCallback(
    (s: SessionMeta) => localTags[s.id] ?? s.tags ?? [],
    [localTags]
  );
  const toggleTag = useCallback(
    async (s: SessionMeta, label: string) => {
      const cur = localTags[s.id] ?? s.tags ?? [];
      const next = cur.includes(label) ? cur.filter((t) => t !== label) : [...cur, label];
      setLocalTags((prev) => ({ ...prev, [s.id]: next }));
      try {
        await records.setSessionTags(s.id, next);
      } catch {
        setLocalTags((prev) => ({ ...prev, [s.id]: cur }));   // 失败回滚
      }
    },
    [localTags, records]
  );
  const [tab, setTab] = useState<TabId>('summary');
  const [summary, setSummary] = useState<CourseSummary | null>(null);
  const [exam, setExam] = useState<CourseExam | null>(null);
  const [mock, setMock] = useState<CourseMock | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [sel, setSel] = useState(0);
  const [jumpTarget, setJumpTarget] = useState('');   // 从考点跳到总结时,要定位的考点名
  const [highlightCh, setHighlightCh] = useState<number | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const handledJumpRef = useRef('');   // 已处理过的跳转目标,避免重复处理/误清高亮定时器
  const [playingKey, setPlayingKey] = useState('');
  const [tagPickerFor, setTagPickerFor] = useState('');   // 哪段录音正在展开标签选择器

  const playRef = useCallback((sid: string, start: number, key: string) => {
    const a = audioRef.current;
    if (!a) return;
    if (a.getAttribute('data-sid') !== sid) {
      a.setAttribute('data-sid', sid);
      a.src = audioUrl(sid);
      a.load();
    }
    const go = () => { try { a.currentTime = start; } catch { /* ignore */ } void a.play().catch(() => undefined); };
    if (a.readyState >= 1) go();
    else a.addEventListener('loadedmetadata', go, { once: true });
    setPlayingKey(key);
  }, []);

  const courseSessions = useMemo(
    () =>
      byTag
        ? records.sessions.filter((s) => effTags(s).includes(tag))
        : records.sessions.filter((s) => baseName(sessionTitle(s)) === name),
    [records.sessions, name, byTag, tag, effTags]
  );

  const loadTab = useCallback(
    async (t: TabId, opts: { refresh?: boolean; aiOnly?: boolean } = {}) => {
      const { refresh = false, aiOnly = false } = opts;
      setErr('');
      try {
        if (t === 'summary' && (summary === null || refresh || aiOnly)) {
          setLoading(true);
          const r = await records.courseSummary(name, refresh, aiOnly, tag || undefined);
          if (r.error) setErr(r.error); else setSummary(r);
        } else if (t === 'exam' && (exam === null || refresh || aiOnly)) {
          setLoading(true);
          const r = await records.courseExam(name, refresh, aiOnly, tag || undefined);
          if (r.error) setErr(r.error); else { setExam(r); setSel(0); }
        } else if (t === 'mock' && (mock === null || refresh || aiOnly)) {
          setLoading(true);
          const r = await records.courseMock(name, refresh, aiOnly, tag || undefined);
          if (r.error) setErr(r.error); else setMock(r);
        }
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [name, tag, summary, exam, mock, records]
  );

  useEffect(() => { void loadTab(tab); /* eslint-disable-next-line */ }, [tab, name, tag]);

  // 从考点详情点"查看总结相关模块":切到总结页 → 加载好 → 定位并高亮最相关的章节
  useEffect(() => {
    if (tab !== 'summary' || !jumpTarget) return;
    if (jumpTarget === handledJumpRef.current) return;   // 这个跳转已处理过,别再跑(否则清 jumpTarget 会误杀高亮定时器)
    if (!summary || summary.no_transcript) { void loadTab('summary'); return; }
    handledJumpRef.current = jumpTarget;
    const chs = summary.chapters || [];
    let best = -1, bestScore = 1;   // 至少 2 个共有汉字才算匹配
    chs.forEach((ch, i) => {
      const s = overlapScore(jumpTarget, ch.title) * 2 + overlapScore(jumpTarget, (ch.points || []).join(''));
      if (s > bestScore) { bestScore = s; best = i; }
    });
    setHighlightCh(best);   // >=0 章节;-1 表示定位到"核心知识点"
    const id = best >= 0 ? `sum-ch-${best}` : 'sum-keypoints';
    setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 120);
    const clr = setTimeout(() => setHighlightCh(null), 3500);
    return () => clearTimeout(clr);
  }, [tab, jumpTarget, summary, loadTab]);

  // 没录音时的"纯AI一键生成"占位
  const NoTranscriptAI = ({ kind, onGen }: { kind: string; onGen: () => void }) => (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-16 h-16 flex items-center justify-center bg-accent-100 rounded-2xl mb-4">
        <i className="ri-magic-line text-accent-600 text-2xl"></i>
      </div>
      <p className="text-sm text-foreground-600 mb-1">这门课还没有课堂录音</p>
      <p className="text-xs text-foreground-400 mb-5 max-w-xs">可以让 AI 仅凭《{displayName}》{byTag ? '这个标签下' : '这门课'}的通用大纲和常见{kind}先生成一份参考;之后录了课再"重新生成"会更贴合你老师讲的内容。</p>
      <button onClick={onGen} className="flex items-center gap-1.5 px-5 py-2.5 bg-accent-500 text-background-50 rounded-full text-sm font-semibold hover:bg-accent-600 cursor-pointer">
        <i className="ri-sparkling-line"></i>AI 一键生成{kind}
      </button>
    </div>
  );

  const Spinner = (
    <div className="flex flex-col items-center justify-center py-20 gap-3">
      <div className="w-8 h-8 border-2 border-accent-500 border-t-transparent rounded-full animate-spin"></div>
      <p className="text-sm text-foreground-400">AI 正在分析这门课的所有录音…(首次会慢一点)</p>
    </div>
  );

  return (
    <div className="min-h-screen bg-background-100">
      {/* 顶栏 */}
      <nav className="sticky top-0 z-30 bg-background-50/95 backdrop-blur-sm border-b border-background-200">
        <div className="flex items-center justify-between h-14 px-6 max-w-5xl mx-auto">
          <div className="flex items-center gap-3 min-w-0">
            <BackButton className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-background-100 text-foreground-500 cursor-pointer">
              <i className="ri-arrow-left-line"></i>
            </BackButton>
            <div className="min-w-0">
              <h1 className="text-sm font-semibold text-foreground-900 truncate">
                {byTag ? `标签:${tag}` : (name || '课程')}
              </h1>
              <p className="text-xs text-foreground-400">
                {byTag
                  ? `汇总所有打了「${tag}」标签的录音 · 共 ${courseSessions.length} 段 · AI 聚合分析`
                  : `共 ${courseSessions.length} 节录音 · AI 课程分析`}
              </p>
            </div>
          </div>
          {(tab === 'summary' || tab === 'exam' || tab === 'mock') && (
            <button
              data-guide="cd-regen"
              onClick={() => void loadTab(tab, { refresh: true })}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-background-100 text-foreground-600 rounded-full text-xs font-medium hover:bg-background-200 cursor-pointer disabled:opacity-50"
            >
              <i className="ri-refresh-line"></i>重新生成
            </button>
          )}
        </div>
      </nav>

      {/* Tabs */}
      <div className="max-w-5xl mx-auto px-6 pt-4">
        <div className="flex items-center gap-1 bg-background-50 border border-background-200 rounded-full p-1 w-fit">
          {TABS.map((t) => (
            <button
              key={t.id}
              data-guide={`cd-tab-${t.id}`}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${
                tab === t.id ? 'bg-accent-500 text-background-50' : 'text-foreground-500 hover:text-foreground-700'
              }`}
            >
              <i className={t.icon}></i>{t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-5">
        {err && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4">
            <p className="text-sm text-red-700"><i className="ri-error-warning-line mr-1"></i>{err}</p>
          </div>
        )}

        {/* ===== 课程总结 ===== */}
        {tab === 'summary' && summary?.no_transcript && !loading && (
          <NoTranscriptAI kind="课程总结" onGen={() => void loadTab('summary', { aiOnly: true })} />
        )}
        {tab === 'summary' && (loading && (!summary || summary.no_transcript) ? Spinner : summary && !summary.no_transcript && (
          <div className="space-y-4">
            <div className="bg-background-50 border border-background-200 rounded-xl p-6">
              <p className="text-sm leading-relaxed text-foreground-700">{summary.summary}</p>
            </div>
            {summary.key_points?.length > 0 && (
              <div id="sum-keypoints" className={`bg-background-50 border rounded-xl p-6 transition-all ${highlightCh === -1 ? 'border-accent-400 ring-2 ring-accent-200' : 'border-background-200'}`}>
                <h3 className="text-sm font-semibold text-foreground-800 mb-3">核心知识点</h3>
                <div className="space-y-2">
                  {summary.key_points.map((p, i) => (
                    <div key={i} className="flex items-start gap-3 p-3 bg-background-100 rounded-lg">
                      <span className="w-6 h-6 flex items-center justify-center flex-shrink-0 bg-accent-500 text-background-50 rounded-full text-xs font-bold">{i + 1}</span>
                      <p className="text-sm text-foreground-700 pt-0.5">{p}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {summary.chapters?.map((ch, i) => (
              <div key={i} id={`sum-ch-${i}`} className={`bg-background-50 border rounded-xl p-6 transition-all ${highlightCh === i ? 'border-accent-400 ring-2 ring-accent-200' : 'border-background-200'}`}>
                <h3 className="text-sm font-semibold text-accent-700 mb-2">{ch.title}</h3>
                <ul className="space-y-1.5">
                  {ch.points?.map((pt, j) => (
                    <li key={j} className="flex items-start gap-2 text-sm text-foreground-600">
                      <span className="w-1.5 h-1.5 rounded-full bg-accent-400 mt-2 flex-shrink-0"></span><MathText text={pt} />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ))}

        {/* ===== 录音集合 ===== */}
        {tab === 'audio' && (
          courseSessions.length === 0 ? (
            <p className="text-sm text-foreground-400 py-16 text-center">{byTag ? `还没有录音打了「${tag}」标签。可到某门课的「录音集合」里给录音打上这个标签。` : '这门课还没有录音。'}</p>
          ) : (
            <div className="space-y-3">
              {courseSessions.map((s) => (
                <div key={s.id} className="p-4 bg-background-50 border border-background-100 rounded-xl">
                  <div className="flex items-center gap-3 mb-2.5">
                    <div className="w-8 h-8 flex items-center justify-center bg-primary-100 rounded-lg flex-shrink-0">
                      <i className="ri-file-music-line text-primary-600 text-sm"></i>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-foreground-800 truncate">{sessionTitle(s)}</p>
                      <p className="text-xs text-foreground-400 mt-0.5">{sessionDate(s)} · {fmtDuration(s.duration_s)} · {s.lines ?? 0} 句</p>
                    </div>
                    <button onClick={() => navigate(`/course?sid=${encodeURIComponent(s.id)}`)} className="px-3 py-1.5 bg-background-100 text-foreground-600 rounded-full text-xs font-medium hover:bg-background-200 cursor-pointer whitespace-nowrap flex-shrink-0">
                      <i className="ri-file-text-line mr-1"></i>看转写
                    </button>
                    <a href={audioDownloadUrl(s.id, `${sessionTitle(s).replace(/[\\/:*?"<>|]/g, '_')}.wav`)} className="px-3 py-1.5 bg-primary-100 text-primary-700 rounded-full text-xs font-medium hover:bg-primary-200 cursor-pointer whitespace-nowrap flex-shrink-0">
                      <i className="ri-download-2-line mr-1"></i>导出
                    </a>
                  </div>
                  <AudioPlayer src={audioUrl(s.id)} durationHint={s.duration_s} className="w-full" />

                  {/* 标签编辑:当前标签用胶囊显示,＋标签 展开可选标签列表,点选切换并即时保存 */}
                  <div className="flex flex-wrap items-center gap-1.5 mt-2.5 pt-2.5 border-t border-background-100">
                    <span className="text-xs text-foreground-400 mr-0.5"><i className="ri-price-tag-3-line mr-0.5"></i>标签</span>
                    {effTags(s).length === 0 && (
                      <span className="text-xs text-foreground-300">暂无</span>
                    )}
                    {effTags(s).map((t) => (
                      <button
                        key={t}
                        onClick={() => void toggleTag(s, t)}
                        className="px-2 py-0.5 bg-secondary-100 text-secondary-700 rounded-full text-[11px] font-medium hover:bg-secondary-200 cursor-pointer whitespace-nowrap"
                        title="点击移除该标签"
                      >
                        {t}<i className="ri-close-line ml-0.5"></i>
                      </button>
                    ))}
                    <button
                      onClick={() => setTagPickerFor((p) => (p === s.id ? '' : s.id))}
                      className="px-2 py-0.5 bg-background-100 text-foreground-500 rounded-full text-[11px] font-medium hover:bg-background-200 cursor-pointer whitespace-nowrap"
                    >
                      <i className="ri-add-line mr-0.5"></i>标签
                    </button>
                  </div>
                  {tagPickerFor === s.id && (
                    <div className="mt-2 flex flex-wrap gap-1.5 p-2.5 bg-background-100 rounded-lg">
                      {allTags.length === 0 ? (
                        <button
                          onClick={() => navigate('/tags')}
                          className="text-xs text-accent-600 hover:text-accent-700 cursor-pointer"
                        >
                          还没有标签,去创建 →
                        </button>
                      ) : (
                        allTags.map((tg) => {
                          const active = effTags(s).includes(tg.label);
                          return (
                            <button
                              key={tg.id}
                              onClick={() => void toggleTag(s, tg.label)}
                              className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors cursor-pointer whitespace-nowrap ${
                                active
                                  ? 'bg-accent-500 text-background-50 border-accent-500'
                                  : 'bg-background-50 text-foreground-600 border-background-200 hover:border-accent-300'
                              }`}
                            >
                              {active && <i className="ri-check-line mr-0.5"></i>}{tg.label}
                            </button>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )
        )}

        {/* ===== 考点推测(饼图)===== */}
        {tab === 'exam' && exam?.no_transcript && !loading && (
          <NoTranscriptAI kind="考点" onGen={() => void loadTab('exam', { aiOnly: true })} />
        )}
        {tab === 'exam' && (loading && (!exam || exam.no_transcript) ? Spinner : exam && !exam.no_transcript && exam.points?.length > 0 && (
          <div className="grid md:grid-cols-2 gap-5">
            <div className="bg-background-50 border border-background-200 rounded-xl p-6 flex flex-col items-center">
              <Pie values={exam.points.map((p) => p.probability)} labels={exam.points.map((p) => p.name)} selected={sel} onSelect={setSel} />
              <div className="mt-4 w-full space-y-1.5">
                {exam.points.map((p, i) => (
                  <button key={i} onClick={() => setSel(i)} className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left cursor-pointer ${sel === i ? 'bg-background-100' : 'hover:bg-background-100/60'}`}>
                    <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ background: PIE[i % PIE.length] }}></span>
                    <span className="text-xs text-foreground-700 flex-1 truncate">{p.name}</span>
                    <span className="text-xs font-bold text-foreground-800">{p.probability}%</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="bg-background-50 border border-background-200 rounded-xl p-6">
              {exam.points[sel] && (
                <>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="w-3.5 h-3.5 rounded-sm flex-shrink-0" style={{ background: PIE[sel % PIE.length] }}></span>
                    <h3 className="text-base font-bold text-foreground-900">{exam.points[sel].name}</h3>
                    <span className="ml-auto px-2 py-0.5 bg-accent-100 text-accent-700 rounded-full text-xs font-bold">{exam.points[sel].probability}% 可能考</span>
                  </div>
                  <div className="text-xs text-foreground-500 mb-3 leading-relaxed"><i className="ri-lightbulb-line mr-1 text-amber-500"></i><MathText text={exam.points[sel].reason} /></div>
                  <div className="border-t border-background-100 pt-3">
                    <div className="text-sm text-foreground-700 leading-relaxed"><MathText text={exam.points[sel].detail} /></div>
                  </div>
                  <button
                    onClick={() => { setJumpTarget(exam.points[sel].name); setTab('summary'); }}
                    className="mt-4 flex items-center gap-1.5 px-3 py-1.5 bg-accent-100 text-accent-700 rounded-full text-xs font-medium hover:bg-accent-200 cursor-pointer"
                  >
                    <i className="ri-links-line"></i>在课程总结里查看相关模块
                  </button>

                  {exam.points[sel].refs && exam.points[sel].refs!.length > 0 && (
                    <div className="mt-4 border-t border-background-100 pt-3">
                      <p className="text-xs font-semibold text-foreground-500 mb-2"><i className="ri-mic-line mr-1"></i>老师讲到这个考点的录音片段(点击听)</p>
                      <div className="space-y-1.5">
                        {exam.points[sel].refs!.map((r, i) => {
                          const key = `${sel}-${i}`;
                          return (
                            <button
                              key={i}
                              onClick={() => playRef(r.sid, r.start, key)}
                              className={`w-full flex items-start gap-2 text-left px-2.5 py-2 rounded-lg cursor-pointer transition-colors ${playingKey === key ? 'bg-primary-50 border border-primary-200' : 'bg-background-100 hover:bg-background-200 border border-transparent'}`}
                            >
                              <i className="ri-play-circle-line text-primary-500 mt-0.5 flex-shrink-0"></i>
                              <span className="text-xs font-mono text-foreground-400 flex-shrink-0">{r.ts}</span>
                              <span className="text-xs text-foreground-700 flex-1 leading-relaxed">{r.text}</span>
                            </button>
                          );
                        })}
                      </div>
                      <audio ref={audioRef} controls className="w-full h-9 mt-2" />
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        ))}

        {/* ===== 模拟试卷 ===== */}
        {tab === 'mock' && mock?.no_transcript && !loading && (
          <NoTranscriptAI kind="模拟试卷" onGen={() => void loadTab('mock', { aiOnly: true })} />
        )}
        {tab === 'mock' && (loading && (!mock || mock.no_transcript) ? Spinner : mock && !mock.no_transcript && mock.questions?.length > 0 && (
          <div className="bg-background-50 border border-background-200 rounded-xl p-6 space-y-5">
            <div className="flex items-center gap-2 pb-3 border-b border-background-100">
              <i className="ri-file-list-3-line text-accent-600"></i>
              <h3 className="text-sm font-semibold text-foreground-800">《{displayName}》模拟试卷</h3>
              <span className="text-xs text-foreground-400">共 {mock.questions.length} 题</span>
            </div>
            {mock.questions.map((q, i) => (
              <div key={i} className="space-y-1.5">
                <div className="flex items-start gap-2">
                  <span className="text-xs font-bold text-accent-600 mt-0.5 flex-shrink-0">{i + 1}.</span>
                  <div className="flex-1">
                    <div className="text-sm text-foreground-800 leading-relaxed">
                      <span className="text-[11px] text-foreground-400 mr-1.5">[{q.type}]</span>
                      <MathText text={splitChoices(q.question)} />
                    </div>
                    <details className="mt-1.5">
                      <summary className="text-xs text-accent-600 cursor-pointer hover:text-accent-700 select-none">查看答案</summary>
                      <div className="text-xs text-foreground-600 mt-1 p-2.5 bg-background-100 rounded-lg leading-relaxed"><MathText text={q.answer} /></div>
                    </details>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
