import { useState } from 'react';
import { useT } from '@/lib/i18n';

interface SummaryTabProps {
  summary: string;
  keyPoints: string[];
  corrections?: string[];
  /** Original error strings already one-click-replaced; hide these entries from the list */
  appliedCorrections?: string[];
  /** The current full transcript (used to show only replaceable items that "really are still in the transcript", avoiding clicks with no effect) */
  transcriptText?: string;
  onApplyCorrection?: (from: string, to: string, raw?: string) => void | Promise<void>;
  onApplyAll?: () => void | Promise<void>;
  sessionTitle: string;
  onExport: (format: 'word' | 'pdf', opts?: { summary?: boolean; corrections?: boolean; transcript?: boolean }) => void;
  onSaveSummary?: () => void | Promise<void>;
  canSave?: boolean;
  error?: string;
  deepseekReady?: boolean;
}

/** Parse 「听成"X"应为"Y",解释…」 into {from:X, to:Y}.
 *  Recognizes ASCII/full-width quotes; to is cut off at a quote or punctuation (so it doesn't swallow the trailing explanation); returns null for invalid entries where from==to. */
export function parseCorrection(s: string): { from: string; to: string } | null {
  const m = (s || '').match(
    /听成[\s"'“”「『]*(.+?)[\s"'“”」』]*应为[\s"'“”「『]*(.+?)(?:["'“”」』]|[，,。；;、]|$)/
  );
  if (!m) return null;
  const clean = (x: string) => x.trim().replace(/^[「『"'“”\s]+|[」』"'“”。，,、；;\s]+$/g, '').trim();
  const from = clean(m[1]);
  const to = clean(m[2]);
  if (!from || !to || from === to) return null;   // Drop empty ones, or unchanged ones like "no error here / correct"
  return { from, to };
}

export default function SummaryTab({
  summary,
  keyPoints,
  corrections,
  transcriptText,
  appliedCorrections,
  onApplyCorrection,
  onApplyAll,
  sessionTitle,
  onExport,
  onSaveSummary,
  canSave,
  error,
  deepseekReady,
}: SummaryTabProps) {
  const t = useT();
  const [exportOpen, setExportOpen] = useState(false);
  const [exportFmt, setExportFmt] = useState<'word' | 'pdf'>('word');
  const [exportOpts, setExportOpts] = useState({ summary: true, corrections: false, transcript: false });
  const toggleOpt = (k: 'summary' | 'corrections' | 'transcript') =>
    setExportOpts((o) => ({ ...o, [k]: !o[k] }));
  const doExport = () => { setExportOpen(false); onExport(exportFmt, exportOpts); };
  const applied = appliedCorrections ?? [];
  // Interactive list: only show entries not yet replaced, parseable as "X->Y", and whose error word **really is still in the transcript** --
  // otherwise (already fixed by homophone/AI correction) clicking replace would "find nothing" and look broken.
  const pendingCorrections = (corrections ?? []).filter((c) => {
    if (applied.includes(c)) return false;
    const p = parseCorrection(c);
    if (!p) return false;
    if (transcriptText && transcriptText.length > 0) return transcriptText.includes(p.from);
    return true;   // When the full transcript is unavailable, don't filter; leave as is
  });
  const exportCorrections = () => {
    const text = (corrections ?? [])
      .map((c) => {
        const p = parseCorrection(c);
        return p ? `${p.from} → ${p.to}` : c;
      })
      .join('\n');
    const blob = new Blob([`【识别可能听错】${sessionTitle}\n\n${text}\n`], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(sessionTitle || '课程').replace(/[\\/:*?"<>|]/g, '_')}-纠错清单.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <div className="space-y-5">
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <p className="text-xs text-red-700 leading-relaxed">
            <i className="ri-error-warning-line mr-1"></i>
            {error}
          </p>
        </div>
      )}
      {deepseekReady === false && (
        <div className="bg-accent-50 border border-accent-200 rounded-xl p-4">
          <p className="text-xs text-accent-700 leading-relaxed">
            <i className="ri-information-line mr-1"></i>
            {t('服务端还没配 DeepSeek API key，「生成AI摘要」会退回本机规则提取的重点。')}
            {t(' 把 key 填到 ')}<code>service/config.json</code>{t(' 的 ')}<code>deepseek.api_key</code>{t(' 后重启服务即可。')}
          </p>
        </div>
      )}
      <div className="bg-background-50 border border-background-200 rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 flex items-center justify-center">
              <i className="ri-ai-generate text-foreground-500 text-lg"></i>
            </div>
            <h3 className="text-sm font-semibold text-foreground-800">{t('AI 摘要预览')}</h3>
          </div>
          <div className="flex items-center gap-2">
            {onSaveSummary && (
              <button
                onClick={() => void onSaveSummary()}
                disabled={!summary || !canSave}
                title={!canSave ? t('这节课还没保存,先停止录音') : undefined}
                className="flex items-center gap-1.5 px-4 py-2 bg-background-100 text-foreground-700 rounded-full text-xs font-semibold hover:bg-background-200 transition-colors cursor-pointer whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <i className="ri-save-3-line text-sm"></i>
                {t('保存')}
              </button>
            )}
            {/* Export as…: open it to first choose a format (Word/PDF), then check what to export */}
            <div className="relative">
              <button
                onClick={() => setExportOpen((v) => !v)}
                className="flex items-center gap-1.5 px-4 py-2 bg-primary-500 text-background-50 rounded-full text-xs font-semibold hover:bg-primary-600 transition-colors cursor-pointer whitespace-nowrap"
              >
                <i className="ri-download-2-line text-sm"></i>
                {t('导出为…')}
                <i className={`ri-arrow-${exportOpen ? 'up' : 'down'}-s-line text-sm`}></i>
              </button>
              {exportOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setExportOpen(false)} />
                  <div className="absolute right-0 top-full mt-2 z-20 w-52 bg-background-50 border border-background-200 rounded-xl shadow-lg p-3">
                    {/* Format */}
                    <p className="text-[11px] text-foreground-400 mb-1.5">{t('导出格式')}</p>
                    <div className="flex gap-2 mb-3">
                      {([
                        { f: 'word', label: 'Word', icon: 'ri-file-word-2-line' },
                        { f: 'pdf', label: 'PDF', icon: 'ri-file-pdf-2-line' },
                      ] as const).map((it) => (
                        <button
                          key={it.f}
                          onClick={() => setExportFmt(it.f)}
                          className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-xs font-semibold border cursor-pointer transition-colors ${
                            exportFmt === it.f
                              ? 'bg-primary-500 text-background-50 border-primary-500'
                              : 'bg-background-50 text-foreground-600 border-background-200 hover:bg-background-100'
                          }`}
                        >
                          <i className={`${it.icon} text-sm`}></i>
                          {it.label}
                        </button>
                      ))}
                    </div>
                    {/* Content */}
                    <p className="text-[11px] text-foreground-400 mb-1">{t('导出内容')}</p>
                    {([
                      { k: 'summary', label: '摘要', icon: 'ri-magic-line' },
                      { k: 'corrections', label: '可能错误', icon: 'ri-error-warning-line' },
                      { k: 'transcript', label: '原文', icon: 'ri-file-text-line' },
                    ] as const).map((it) => (
                      <label
                        key={it.k}
                        className="flex items-center gap-2 px-1 py-1.5 rounded-lg hover:bg-background-100 cursor-pointer text-sm text-foreground-700"
                      >
                        <input
                          type="checkbox"
                          checked={exportOpts[it.k]}
                          onChange={() => toggleOpt(it.k)}
                          className="accent-primary-500 w-3.5 h-3.5"
                        />
                        <i className={`${it.icon} text-foreground-400 text-sm`}></i>
                        {t(it.label)}
                      </label>
                    ))}
                    <button
                      onClick={doExport}
                      className="mt-2 w-full px-3 py-1.5 bg-primary-500 text-background-50 rounded-lg text-xs font-semibold hover:bg-primary-600 cursor-pointer"
                    >
                      {t('导出为')} {exportFmt === 'pdf' ? 'PDF' : 'Word'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {summary ? (
          <div className="space-y-4">
            <div className="p-4 bg-accent-50 rounded-lg border border-accent-100">
              <p className="text-sm leading-relaxed text-foreground-700">{summary}</p>
            </div>

            {keyPoints.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-foreground-500 uppercase tracking-wider mb-3">
                  {t('重点知识点')}
                </h4>
                <div className="space-y-2">
                  {keyPoints.map((point, idx) => (
                    <div key={idx} className="flex items-start gap-3 p-3 bg-background-100 rounded-lg">
                      <span className="w-6 h-6 flex items-center justify-center flex-shrink-0 bg-primary-500 text-background-50 rounded-full text-xs font-bold">
                        {idx + 1}
                      </span>
                      <p className="text-sm text-foreground-700 pt-0.5">{point}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {pendingCorrections.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
                  <h4 className="text-sm font-semibold text-amber-700 flex items-center gap-1.5">
                    <i className="ri-error-warning-line"></i>{t('识别可能听错 · 一键替换')}
                    {applied.length > 0 && (
                      <span className="text-xs font-normal text-amber-500">{t('(已替换 {n} 条)', { n: applied.length })}</span>
                    )}
                  </h4>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-amber-600 hidden sm:inline">{t('选中一条按 Tab 键替换并跳下一条')}</span>
                    {onApplyAll && (
                      <button
                        onClick={() => void onApplyAll()}
                        className="flex items-center gap-1 px-3 py-1.5 bg-amber-500 text-background-50 rounded-full text-xs font-semibold hover:bg-amber-600 cursor-pointer whitespace-nowrap"
                      >
                        <i className="ri-check-double-line"></i>{t('全部替换')}
                      </button>
                    )}
                    <button
                      onClick={exportCorrections}
                      className="flex items-center gap-1 px-3 py-1.5 bg-amber-100 text-amber-700 rounded-full text-xs font-medium hover:bg-amber-200 cursor-pointer whitespace-nowrap"
                    >
                      <i className="ri-download-line"></i>{t('导出清单')}
                    </button>
                  </div>
                </div>
                <div className="space-y-2">
                  {pendingCorrections.map((c, idx) => {
                    const p = parseCorrection(c);
                    return (
                      <div
                        key={idx}
                        tabIndex={p ? 0 : -1}
                        onKeyDown={(e) => {
                          if (p && (e.key === 'Tab' || e.key === 'Enter')) {
                            e.preventDefault();
                            (e.currentTarget.nextElementSibling as HTMLElement | null)?.focus();
                            void onApplyCorrection?.(p.from, p.to, c);
                          }
                        }}
                        className="flex items-center justify-between gap-3 p-2.5 bg-background-50 border border-amber-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
                      >
                        <div className="text-sm min-w-0">
                          {p ? (
                            <span className="flex items-center gap-2 flex-wrap">
                              <span className="line-through text-foreground-400">{p.from}</span>
                              <i className="ri-arrow-right-line text-amber-400"></i>
                              <span className="font-semibold text-amber-800">{p.to}</span>
                            </span>
                          ) : (
                            <span className="text-amber-800">{c}</span>
                          )}
                        </div>
                        {p && onApplyCorrection && (
                          <button
                            onClick={() => void onApplyCorrection(p.from, p.to, c)}
                            className="flex-shrink-0 px-3 py-1.5 bg-amber-500 text-background-50 rounded-full text-xs font-semibold hover:bg-amber-600 cursor-pointer whitespace-nowrap"
                          >
                            {t('替换')}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-16 h-16 flex items-center justify-center mb-4">
              <i className="ri-magic-line text-foreground-300 text-3xl"></i>
            </div>
            <p className="text-sm text-foreground-400">{t('暂无摘要内容')}</p>
            <p className="text-xs text-foreground-300 mt-1">{t('请在「实时转写」标签页中点击「生成AI摘要」按钮')}</p>
          </div>
        )}
      </div>
    </div>
  );
}