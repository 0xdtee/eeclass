import { useMemo, useState } from 'react';
import { fmtDuration, sessionDate, sessionTitle } from '@/hooks/useRecords';
import type { SessionMeta } from '@/hooks/useRecords';
import type { Course } from '@/hooks/useLibrary';

interface HistoryTabProps {
  sessions: SessionMeta[];
  loading: boolean;
  error: string;
  activeSessionId: string;
  courses: Course[];
  assign: Record<string, string>;
  onSelectSession: (sessionId: string) => void;
  onReload: () => void;
  onCreateCourse: (name: string) => Promise<Course>;
  onDeleteCourse: (id: string) => Promise<void>;
  onAssign: (sid: string, courseId: string | null) => Promise<void>;
  onEditCourse: (c: Course) => void;
  /** 批量导出选中的课时为一个 PDF */
  onBatchExport?: (sessionIds: string[]) => Promise<void>;
}

const UNSORTED = '__unsorted__';

export default function HistoryTab({
  sessions, loading, error, activeSessionId, courses, assign,
  onSelectSession, onReload, onCreateCourse, onDeleteCourse, onAssign, onEditCourse, onBatchExport,
}: HistoryTabProps) {
  const [selected, setSelected] = useState<string>('');  // '' = 全部
  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);
  const [dragSid, setDragSid] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  const [selectMode, setSelectMode] = useState(false);          // 批量导出:多选模式
  const [picked, setPicked] = useState<Set<string>>(new Set()); // 选中的课时
  const [exporting, setExporting] = useState(false);
  const togglePick = (id: string) =>
    setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const stats = useMemo(() => {
    const m: Record<string, { n: number; sec: number }> = {};
    for (const s of sessions) {
      const cid = assign[s.id] || UNSORTED;
      m[cid] = m[cid] || { n: 0, sec: 0 };
      m[cid].n += 1;
      m[cid].sec += s.duration_s ?? 0;
    }
    return m;
  }, [sessions, assign]);

  const shown = useMemo(() => {
    if (!selected) return sessions;
    if (selected === UNSORTED) return sessions.filter((s) => !assign[s.id]);
    return sessions.filter((s) => assign[s.id] === selected);
  }, [sessions, assign, selected]);

  const total = useMemo(
    () => ({
      n: sessions.length,
      sec: sessions.reduce((a, s) => a + (s.duration_s ?? 0), 0),
    }),
    [sessions]
  );

  const drop = async (courseId: string | null) => {
    if (!dragSid) return;
    setBusy(dragSid);
    try {
      await onAssign(dragSid, courseId);
    } finally {
      setBusy('');
      setDragSid(null);
    }
  };

  const rowCls = (active: boolean) =>
    `w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors cursor-pointer ${
      active ? 'bg-accent-100 text-accent-800' : 'text-foreground-700 hover:bg-background-100'
    }`;

  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <p className="text-xs text-red-700">读不到本机记录：{error}</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-4">
        {/* 左：课程 */}
        <div className="bg-background-50 border border-background-200 rounded-xl p-3 space-y-1 h-fit">
          <button onClick={() => setSelected('')} className={rowCls(selected === '')}>
            全部课程
            <span className="float-right text-xs text-foreground-400">{total.n}</span>
          </button>

          {courses.map((c) => (
            <div
              key={c.id}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => void drop(c.id)}
              className="group relative"
            >
              <button onClick={() => setSelected(c.id)} className={rowCls(selected === c.id)}>
                <span className="truncate pr-10 inline-block max-w-full align-middle">{c.name}</span>
                <span className="float-right text-xs text-foreground-400">
                  {stats[c.id]?.n ?? 0}
                </span>
              </button>
              <div className="absolute right-1.5 top-1/2 -translate-y-1/2 hidden group-hover:flex items-center gap-0.5 bg-background-50 rounded">
                <button
                  onClick={() => onEditCourse(c)}
                  className="w-6 h-6 flex items-center justify-center rounded hover:bg-background-200 text-foreground-500 cursor-pointer"
                  title="术语表 / 纠错表"
                >
                  <i className="ri-settings-3-line text-xs"></i>
                </button>
                <button
                  onClick={() => void onDeleteCourse(c.id)}
                  className="w-6 h-6 flex items-center justify-center rounded hover:bg-background-200 text-foreground-500 cursor-pointer"
                  title="删除课程（不会删录音）"
                >
                  <i className="ri-delete-bin-line text-xs"></i>
                </button>
              </div>
            </div>
          ))}

          <div onDragOver={(e) => e.preventDefault()} onDrop={() => void drop(null)}>
            <button onClick={() => setSelected(UNSORTED)} className={rowCls(selected === UNSORTED)}>
              未分类
              <span className="float-right text-xs text-foreground-400">
                {stats[UNSORTED]?.n ?? 0}
              </span>
            </button>
          </div>

          {adding ? (
            <div className="flex items-center gap-1 pt-1">
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={async (e) => {
                  if (e.key === 'Enter' && newName.trim()) {
                    await onCreateCourse(newName.trim());
                    setNewName('');
                    setAdding(false);
                  }
                  if (e.key === 'Escape') setAdding(false);
                }}
                placeholder="课程名"
                className="flex-1 min-w-0 text-sm px-2 py-1.5 rounded border border-background-200"
              />
              <button
                onClick={async () => {
                  if (!newName.trim()) return;
                  await onCreateCourse(newName.trim());
                  setNewName('');
                  setAdding(false);
                }}
                className="px-2 py-1.5 bg-accent-500 text-background-50 rounded text-xs cursor-pointer"
              >
                建
              </button>
            </div>
          ) : (
            <button
              onClick={() => setAdding(true)}
              className="w-full text-left px-3 py-2 text-xs text-accent-600 hover:text-accent-700 cursor-pointer"
            >
              <i className="ri-add-line mr-1"></i>新建课程
            </button>
          )}

          <p className="px-3 pt-2 text-xs text-foreground-300 leading-relaxed">
            把右边的课时拖到课程上就能归类
          </p>
        </div>

        {/* 右：课时 */}
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="text-xs text-foreground-500">
              {selectMode ? `已选 ${picked.size} 节` : `${shown.length} 节 · 累计 ${fmtDuration(shown.reduce((a, s) => a + (s.duration_s ?? 0), 0))}`}
            </span>
            <div className="flex items-center gap-2">
              {onBatchExport && !selectMode && (
                <button
                  onClick={() => { setSelectMode(true); setPicked(new Set()); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-background-100 text-foreground-600 rounded-full text-xs hover:bg-background-200 cursor-pointer"
                >
                  <i className="ri-file-pdf-2-line"></i>批量导出
                </button>
              )}
              {onBatchExport && selectMode && (
                <>
                  <button
                    onClick={() => {
                      const ids = shown.map((s) => s.id);
                      const all = ids.length > 0 && ids.every((id) => picked.has(id));
                      setPicked(all ? new Set() : new Set(ids));
                    }}
                    className="px-3 py-1.5 bg-background-100 text-foreground-600 rounded-full text-xs hover:bg-background-200 cursor-pointer"
                  >
                    {shown.length > 0 && shown.every((s) => picked.has(s.id)) ? '取消全选' : '全选'}
                  </button>
                  <button
                    disabled={picked.size === 0 || exporting}
                    onClick={async () => {
                      setExporting(true);
                      try { await onBatchExport(shown.filter((s) => picked.has(s.id)).map((s) => s.id)); }
                      finally { setExporting(false); }
                    }}
                    className="px-3.5 py-1.5 bg-accent-500 text-background-50 rounded-full text-xs font-semibold hover:bg-accent-600 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {exporting ? '导出中…' : `导出选中 PDF (${picked.size})`}
                  </button>
                  <button
                    onClick={() => { setSelectMode(false); setPicked(new Set()); }}
                    className="px-3 py-1.5 bg-background-100 text-foreground-600 rounded-full text-xs hover:bg-background-200 cursor-pointer"
                  >
                    取消
                  </button>
                </>
              )}
              <button
                onClick={onReload}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-background-100 text-foreground-600 rounded-full text-xs hover:bg-background-200 cursor-pointer"
              >
                <i className={`ri-refresh-line ${loading ? 'animate-spin' : ''}`}></i>刷新
              </button>
            </div>
          </div>

          {shown.length === 0 && !loading && (
            <div className="bg-background-50 border border-background-200 rounded-xl p-10 text-center">
              <i className="ri-inbox-line text-foreground-300 text-3xl"></i>
              <p className="text-sm text-foreground-400 mt-3">这里还没有课时</p>
            </div>
          )}

          {shown.map((s) => {
            const active = s.id === activeSessionId;
            const course = courses.find((c) => c.id === assign[s.id]);
            return (
              <div
                key={s.id}
                draggable={!selectMode}
                onDragStart={() => setDragSid(s.id)}
                onDragEnd={() => setDragSid(null)}
                onClick={() => (selectMode ? togglePick(s.id) : onSelectSession(s.id))}
                className={`p-4 rounded-xl border transition-colors cursor-pointer ${
                  selectMode && picked.has(s.id) ? 'bg-accent-50 border-accent-400'
                    : active && !selectMode ? 'bg-accent-50 border-accent-300'
                    : 'bg-background-50 border-background-200 hover:border-background-300'
                } ${busy === s.id ? 'opacity-50' : ''}`}
              >
                <div className="flex items-start gap-3">
                  {selectMode && (
                    <span className={`mt-0.5 w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 ${picked.has(s.id) ? 'bg-accent-500 border-accent-500 text-background-50' : 'border-background-300'}`}>
                      {picked.has(s.id) && <i className="ri-check-line text-xs"></i>}
                    </span>
                  )}
                  <div className="flex-1 min-w-0 flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h4 className="text-sm font-semibold text-foreground-900 truncate">
                      {sessionTitle(s)}
                    </h4>
                    <p className="text-xs text-foreground-400 mt-1">
                      {sessionDate(s)} · {fmtDuration(s.duration_s)} · {s.lines ?? 0} 句
                      {course && <span className="ml-2 text-accent-600">{course.name}</span>}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 justify-end flex-shrink-0">
                    {(s.speakers ?? []).slice(0, 3).map((sp) => (
                      <span
                        key={sp.id}
                        className="px-2 py-0.5 bg-background-100 text-foreground-500 rounded-full text-xs whitespace-nowrap"
                      >
                        {sp.name} {Math.round(sp.seconds)}s
                      </span>
                    ))}
                  </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
