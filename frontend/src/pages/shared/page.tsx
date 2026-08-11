/**
 * Read-only page opened by others via a share link.
 * No token needed, and only this session's text is visible -- recordings, edits, and other sessions are all off-limits.
 */
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { SERVICE_ORIGIN } from '@/hooks/useLiveCaption';
import { fmtDuration } from '@/hooks/useRecords';
import type { TranscriptLine } from '@/hooks/useRecords';
import { exportWord } from '@/lib/exportWord';
import { useT } from '@/lib/i18n';

const KIND_STYLE: Record<string, string> = {
  key: 'bg-[linear-gradient(transparent_20%,#fef08a_20%)] box-decoration-clone px-0.5',
  define: 'bg-[linear-gradient(transparent_20%,#bbf7d0_20%)] box-decoration-clone px-0.5',
};

interface Shared {
  sid: string;
  meta: { title?: string | null; duration_s?: number; lines?: number };
  lines: TranscriptLine[];
  allow_download: boolean;
}

export default function SharedPage() {
  const { key = '' } = useParams();
  const [data, setData] = useState<Shared | null>(null);
  const [error, setError] = useState('');
  const t = useT();

  useEffect(() => {
    fetch(`${SERVICE_ORIGIN}/api/shared/${encodeURIComponent(key)}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
        return j as Shared;
      })
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [key]);

  const title = data?.meta?.title || data?.sid?.replace(/^\d{4}-\d{2}-\d{2}_\d{4}_?/, '') || t('课堂记录');

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background-100 p-6">
        <div className="bg-background-50 border border-background-200 rounded-xl p-8 text-center max-w-md">
          <i className="ri-link-unlink text-foreground-300 text-3xl"></i>
          <p className="text-sm text-foreground-600 mt-3">{error}</p>
          <p className="text-xs text-foreground-400 mt-2">
            {t('链接可能已停止共享,或您与分享者不在同一 WiFi。')}
          </p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background-100">
        <div className="w-8 h-8 border-2 border-accent-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background-100">
      <nav className="sticky top-0 z-30 bg-background-50/95 backdrop-blur-sm border-b border-background-200">
        <div className="flex items-center justify-between h-14 px-6 max-w-4xl mx-auto">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 flex items-center justify-center bg-accent-100 rounded-lg flex-shrink-0">
              <i className="ri-book-open-line text-accent-600"></i>
            </div>
            <div className="min-w-0">
              <h1 className="text-sm font-semibold text-foreground-900 truncate">{title}</h1>
              <p className="text-xs text-foreground-400">
                {data.lines.length} {t('句')} · {fmtDuration(data.meta?.duration_s)} · {t('只读共享')}
              </p>
            </div>
          </div>
          {data.allow_download && (
            <button
              onClick={() =>
                void exportWord({
                  title,
                  subtitle: `${data.lines.length} ${t('句')} · ${fmtDuration(data.meta?.duration_s)}`,
                  lines: data.lines.map((l) => ({
                    ts: l.ts, speaker: l.speaker, text: l.text, kind: l.kind,
                  })),
                }).catch(() => alert(t('导出 Word 失败,请重试')))
              }
              className="flex items-center gap-1.5 px-3 py-2 bg-background-100 text-foreground-600 rounded-full text-xs font-medium hover:bg-background-200 cursor-pointer whitespace-nowrap"
            >
              <i className="ri-file-word-2-line"></i>
              {t('导出 Word')}
            </button>
          )}
        </div>
      </nav>

      <div className="max-w-4xl mx-auto px-6 py-6">
        <div className="bg-background-50 border border-background-200 rounded-xl p-6 space-y-3">
          {data.lines.map((l) => (
            <div key={l.id} className={l.new_para ? 'pt-2' : ''}>
              <span className="text-xs text-foreground-400 font-mono mr-2">{l.ts}</span>
              <span className="text-xs font-medium text-accent-600 mr-2">{l.speaker}</span>
              <span className={`text-sm leading-relaxed text-foreground-700 ${KIND_STYLE[l.kind ?? ''] ?? ''}`}>
                {l.text}
              </span>
            </div>
          ))}
          {data.lines.length === 0 && (
            <p className="text-sm text-foreground-400 italic">{t('这节课没有转写内容')}</p>
          )}
        </div>
      </div>
    </div>
  );
}
