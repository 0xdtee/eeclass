import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Modal from '@/components/base/Modal';
import { useT } from '@/lib/i18n';
import { exportWord } from '@/lib/exportWord';
import { exportPdf, exportPdfBatch } from '@/lib/exportPdf';

interface SessionItem {
  id: string;
  title: string;
  date: string;
  time: string;
  duration: string;
  tags: string[];
  summary: string;
  keyPoints: string[];
}

interface SummaryListModalProps {
  isOpen: boolean;
  onClose: () => void;
  sessions: SessionItem[];
  tagLabels: Record<string, string>;
}

const TAG_COLOR_CLASS = 'bg-accent-100 text-accent-700';

function SummaryCard({
  session,
  tagLabels,
  onNavigate,
  checked,
  onToggle,
}: {
  session: SessionItem;
  tagLabels: Record<string, string>;
  onNavigate: (sessionId: string, view: 'summary' | 'transcript') => void;
  checked: boolean;
  onToggle: () => void;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const hasSummary = session.summary && session.summary.trim().length > 0;
  const preview = hasSummary
    ? session.summary.slice(0, 100) + (session.summary.length > 100 ? '…' : '')
    : t('暂无摘要内容');

  return (
    <div className={`border-b border-background-100 last:border-b-0 ${checked ? 'bg-accent-50/60' : ''}`}>
      <div className="px-5 py-4">
        {/* Header row */}
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <input
              type="checkbox"
              checked={checked}
              onChange={onToggle}
              title={t('勾选以批量导出')}
              className="accent-accent-500 w-4 h-4 flex-shrink-0 mt-3 cursor-pointer"
            />
            <div className="w-8 h-8 flex items-center justify-center bg-accent-100 rounded-lg flex-shrink-0 mt-0.5">
              <i className="ri-magic-line text-accent-600 text-sm"></i>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground-800 truncate">{session.title}</p>
              <div className="flex items-center gap-3 mt-0.5 text-xs text-foreground-400">
                <span className="flex items-center gap-1">
                  <i className="ri-calendar-line text-[11px]"></i>
                  {session.date}
                </span>
                <span className="flex items-center gap-1">
                  <i className="ri-time-line text-[11px]"></i>
                  {session.duration}
                </span>
              </div>
            </div>
          </div>
          {/* Tag badges */}
          <div className="flex flex-wrap gap-1 flex-shrink-0">
            {session.tags.slice(0, 2).map((tagId) => (
              <span
                key={tagId}
                className={`px-2 py-0.5 rounded-full text-[10px] font-medium whitespace-nowrap ${TAG_COLOR_CLASS}`}
              >
                {tagLabels[tagId] ?? tagId}
              </span>
            ))}
            {session.tags.length > 2 && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-background-100 text-foreground-400 whitespace-nowrap">
                +{session.tags.length - 2}
              </span>
            )}
          </div>
        </div>

        {/* Key points */}
        {session.keyPoints && session.keyPoints.length > 0 && (
          <div className="ml-11 mb-2">
            <div
              className={`overflow-hidden transition-all duration-300 ${expanded ? 'max-h-[300px]' : 'max-h-[44px]'}`}
            >
              <ul className="space-y-1">
                {session.keyPoints.map((pt, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-xs text-foreground-500">
                    <span className="w-1.5 h-1.5 rounded-full bg-accent-400 flex-shrink-0 mt-1.5"></span>
                    <span className="leading-relaxed">{pt}</span>
                  </li>
                ))}
              </ul>
            </div>
            {session.keyPoints.length > 2 && (
              <button
                onClick={() => setExpanded((p) => !p)}
                className="mt-1 text-[11px] text-accent-600 hover:text-accent-700 cursor-pointer whitespace-nowrap transition-colors"
              >
                {expanded ? t('收起') : t('展开全部 {n} 条', { n: session.keyPoints.length })}
              </button>
            )}
          </div>
        )}

        {/* Summary preview (only if no keyPoints) */}
        {(!session.keyPoints || session.keyPoints.length === 0) && (
          <p className="ml-11 mb-2 text-xs text-foreground-500 leading-relaxed line-clamp-2">
            {preview}
          </p>
        )}

        {/* Action buttons */}
        <div className="ml-11 flex items-center gap-2">
          <button
            onClick={() => onNavigate(session.id, 'summary')}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-accent-500 text-background-50 rounded-lg text-xs font-semibold hover:bg-accent-600 transition-colors cursor-pointer whitespace-nowrap"
          >
            <i className="ri-file-list-3-line text-xs"></i>
            {t('查看纪要')}
          </button>
          <button
            onClick={() => onNavigate(session.id, 'transcript')}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-background-100 text-foreground-600 border border-background-200 rounded-lg text-xs font-semibold hover:bg-background-200 transition-colors cursor-pointer whitespace-nowrap"
          >
            <i className="ri-file-text-line text-xs"></i>
            {t('查看原文')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function SummaryListModal({ isOpen, onClose, sessions, tagLabels }: SummaryListModalProps) {
  const t = useT();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);   // ids chosen for export

  const filtered = sessions.filter((s) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      s.title.toLowerCase().includes(q) ||
      s.summary.toLowerCase().includes(q) ||
      s.tags.some((t) => (tagLabels[t] ?? t).toLowerCase().includes(q))
    );
  });

  /** Export whatever is currently listed (search-filtered): one doc per class, zipped when there are several. */
  const doExport = async (fmt: 'word' | 'pdf') => {
    setExportOpen(false);
    const chosen = picked.length ? filtered.filter((x) => picked.includes(x.id)) : filtered;
    if (!chosen.length || exporting) return;
    setExporting(true);
    try {
      const docs = chosen.map((s) => ({
        title: s.title,
        subtitle: [s.date, s.time, s.duration].filter(Boolean).join(' · '),
        summary: s.summary,
        keyPoints: s.keyPoints ?? [],
      }));
      if (fmt === 'word') {
        // .docx has no batch container; emit them one after another
        for (const d of docs) await exportWord(d);
      } else if (docs.length === 1) {
        await exportPdf(docs[0]);
      } else {
        await exportPdfBatch(docs, t('课堂摘要合集'));
      }
    } catch {
      /* the browser cancelled the download; nothing to recover */
    } finally {
      setExporting(false);
    }
  };

  const handleNavigate = (sessionId: string, view: 'summary' | 'transcript') => {
    onClose();
    // Pass the course id and target tab: minutes -> summary page (auto-generated), original text -> class-transcript page
    const tab = view === 'summary' ? 'summary' : 'transcription';
    navigate(`/course?sid=${encodeURIComponent(sessionId)}&tab=${tab}`);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('AI 摘要列表')} width="max-w-2xl">
      <div className="flex flex-col" style={{ maxHeight: '70vh' }}>
        {/* Stats bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-1 pb-4 border-b border-background-100 mb-3">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 flex items-center justify-center bg-accent-100 rounded-lg">
                <i className="ri-magic-line text-accent-600"></i>
              </div>
              <div>
                <p className="text-xs text-foreground-400">{t('共有摘要')}</p>
                <p className="text-lg font-bold text-foreground-900">{t('{n} 份', { n: sessions.length })}</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
          {/* Export everything currently listed */}
          <div className="relative">
            <button
              onClick={() => setExportOpen((v) => !v)}
              disabled={filtered.length === 0 || exporting}
              className="h-8 px-3 flex items-center gap-1.5 bg-accent-500 text-background-50 rounded-lg text-xs font-semibold hover:bg-accent-600 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
            >
              <i className={`${exporting ? 'ri-loader-4-line animate-spin' : 'ri-download-2-line'} text-sm`}></i>
              {exporting ? t('导出中…') : picked.length ? t('导出 {n} 份', { n: picked.length }) : t('导出摘要')}
            </button>
            {exportOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setExportOpen(false)} />
                <div className="absolute right-0 top-full mt-2 z-20 w-44 bg-background-50 border border-background-200 rounded-xl shadow-lg p-2">
                  <p className="px-2 pb-1 text-[11px] text-foreground-400">
                    {picked.length
                      ? t('导出勾选的 {n} 份', { n: picked.length })
                      : t('未勾选,导出列表里全部 {n} 份', { n: filtered.length })}
                  </p>
                  <button onClick={() => void doExport('pdf')} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-foreground-700 hover:bg-background-100 cursor-pointer">
                    <i className="ri-file-pdf-2-line text-foreground-400"></i>{t('导出为 PDF')}
                  </button>
                  <button onClick={() => void doExport('word')} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-foreground-700 hover:bg-background-100 cursor-pointer">
                    <i className="ri-file-word-2-line text-foreground-400"></i>{t('导出为 Word')}
                  </button>
                </div>
              </>
            )}
          </div>
          {/* Search */}
          <div className="relative">
            <div className="w-4 h-4 flex items-center justify-center absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
              <i className="ri-search-line text-foreground-400 text-xs"></i>
            </div>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('搜索摘要…')}
              className="h-8 pl-8 pr-3 w-36 sm:w-44 bg-background-100 border border-background-200 rounded-lg text-xs text-foreground-700 placeholder:text-foreground-300 focus:outline-none focus:border-accent-400 focus:ring-1 focus:ring-accent-100 transition-all"
            />
          </div>
          </div>
        </div>

        {/* Tip + selection row */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 mb-3">
          <i className="ri-information-line text-foreground-300 text-xs"></i>
          <p className="text-[11px] text-foreground-300">{t('勾选左侧方框可批量导出;点「查看纪要」进入摘要页')}</p>
          {filtered.length > 0 && (
            <button
              onClick={() => setPicked(picked.length === filtered.length ? [] : filtered.map((x) => x.id))}
              className="ml-auto text-[11px] font-medium text-accent-600 hover:text-accent-700 cursor-pointer whitespace-nowrap"
            >
              {picked.length === filtered.length ? t('取消全选') : t('全选 {n} 份', { n: filtered.length })}
            </button>
          )}
          {picked.length > 0 && picked.length !== filtered.length && (
            <button
              onClick={() => setPicked([])}
              className="text-[11px] text-foreground-400 hover:text-foreground-600 cursor-pointer whitespace-nowrap"
            >
              {t('清空勾选')}
            </button>
          )}
        </div>

        {/* Session list */}
        <div className="overflow-y-auto flex-1 -mx-6 px-0">
          <div className="bg-background-50 mx-0 rounded-xl border border-background-100 overflow-hidden">
            {filtered.length === 0 ? (
              <div className="py-12 text-center">
                <div className="w-12 h-12 mx-auto flex items-center justify-center bg-background-100 rounded-full mb-3">
                  <i className="ri-search-line text-foreground-300 text-xl"></i>
                </div>
                <p className="text-sm text-foreground-400">{t('未找到匹配的摘要')}</p>
              </div>
            ) : (
              filtered.map((session) => (
                <SummaryCard
                  key={session.id}
                  session={session}
                  tagLabels={tagLabels}
                  onNavigate={handleNavigate}
                  checked={picked.includes(session.id)}
                  onToggle={() => setPicked((p) =>
                    p.includes(session.id) ? p.filter((x) => x !== session.id) : [...p, session.id])}
                />
              ))
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}