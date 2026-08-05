import { useState, useEffect } from 'react';
import BackButton from '@/components/feature/BackButton';
import { apiFetch } from '@/lib/api';

interface SyllabusItem { name: string; official: boolean }
interface Syllabus {
  course: string;
  source?: string;
  overview?: string;
  credits_hint?: string;
  textbooks?: string[];
  chapters?: { title: string; topics?: string[]; exam_points?: string[] }[];
  key_formulas?: string[];
}

export default function SyllabusPage() {
  const [items, setItems] = useState<SyllabusItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [openName, setOpenName] = useState<string | null>(null);
  const [detail, setDetail] = useState<Syllabus | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');

  useEffect(() => {
    let alive = true;
    apiFetch<{ courses: SyllabusItem[] }>('/api/syllabus')
      .then((d) => { if (alive) setItems(d.courses || []); })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : '加载失败'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const open = async (name: string) => {
    if (openName === name) { setOpenName(null); setDetail(null); return; }
    setOpenName(name);
    setDetail(null);
    setDetailError('');
    setDetailLoading(true);
    try {
      const d = await apiFetch<Syllabus>(`/api/syllabus/${encodeURIComponent(name)}`);
      setDetail(d);
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setDetailLoading(false);
    }
  };

  return (
    <div className="min-h-full bg-background-50">
      {/* Header */}
      <div className="px-5 md:px-8 pt-6 md:pt-8 pb-4">
        <BackButton />
        <h1 className="text-lg md:text-2xl font-bold text-foreground-900">参考资料</h1>
        <p className="text-xs md:text-sm text-foreground-400 mt-1">课程教学大纲</p>
      </div>

      <div className="px-5 md:px-8 pb-8 max-w-5xl">
        {loading && (
          <div className="flex items-center justify-center py-16">
            <i className="ri-loader-4-line animate-spin text-accent-500 text-2xl"></i>
          </div>
        )}

        {!loading && error && (
          <div className="flex flex-col items-center py-16 text-center">
            <div className="w-12 h-12 flex items-center justify-center bg-red-50 rounded-xl mb-2">
              <i className="ri-error-warning-line text-red-400 text-xl"></i>
            </div>
            <p className="text-sm text-red-500">{error}</p>
          </div>
        )}

        {!loading && !error && items.length === 0 && (
          <div className="flex flex-col items-center py-16 text-center">
            <div className="w-16 h-16 flex items-center justify-center bg-secondary-100 rounded-2xl mb-4">
              <i className="ri-book-open-line text-secondary-600 text-2xl"></i>
            </div>
            <p className="text-sm text-foreground-400">还没有可查看的教学大纲</p>
          </div>
        )}

        <div className="space-y-2">
          {items.map((it) => (
            <div key={it.name} className="bg-background-50 rounded-xl border border-background-200 overflow-hidden">
              <button
                onClick={() => open(it.name)}
                className="w-full flex items-center gap-3 px-4 py-3.5 text-left cursor-pointer hover:bg-background-100 transition-colors"
              >
                <div className="w-8 h-8 flex items-center justify-center bg-secondary-100 rounded-lg flex-shrink-0">
                  <i className="ri-book-read-line text-secondary-600"></i>
                </div>
                <span className="flex-1 text-sm font-medium text-foreground-800 truncate">{it.name}</span>
                {it.official && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent-100 text-accent-700 flex-shrink-0">官方</span>
                )}
                <i className={`ri-arrow-down-s-line text-foreground-300 transition-transform ${openName === it.name ? 'rotate-180' : ''}`}></i>
              </button>

              {openName === it.name && (
                <div className="px-4 pb-4 border-t border-background-200 pt-3">
                  {detailLoading && (
                    <div className="flex items-center gap-2 text-xs text-foreground-400 py-2">
                      <i className="ri-loader-4-line animate-spin"></i> 加载中…
                    </div>
                  )}
                  {detailError && <p className="text-xs text-red-500 py-2">{detailError}</p>}
                  {detail && !detailLoading && (
                    <div className="space-y-3">
                      {detail.overview && (
                        <p className="text-sm text-foreground-700 leading-relaxed whitespace-pre-wrap">{detail.overview}</p>
                      )}
                      {detail.credits_hint && (
                        <p className="text-xs text-foreground-400"><i className="ri-award-line mr-1"></i>{detail.credits_hint}</p>
                      )}
                      {detail.textbooks && detail.textbooks.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-foreground-600 mb-1">教材</p>
                          <ul className="space-y-0.5">
                            {detail.textbooks.map((t, i) => (
                              <li key={i} className="text-xs text-foreground-600 flex gap-1.5">
                                <i className="ri-book-line text-secondary-500 mt-0.5"></i><span>{t}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {detail.chapters && detail.chapters.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-foreground-600 mb-1.5">章节与考点</p>
                          <div className="space-y-2">
                            {detail.chapters.map((ch, i) => (
                              <div key={i} className="bg-background-100 rounded-lg p-3">
                                <p className="text-sm font-medium text-foreground-800">{i + 1}. {ch.title}</p>
                                {ch.topics && ch.topics.length > 0 && (
                                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                                    {ch.topics.map((t, j) => (
                                      <span key={j} className="text-[11px] px-1.5 py-0.5 rounded bg-background-50 text-foreground-500 border border-background-200">{t}</span>
                                    ))}
                                  </div>
                                )}
                                {ch.exam_points && ch.exam_points.length > 0 && (
                                  <ul className="mt-1.5 space-y-0.5">
                                    {ch.exam_points.map((p, j) => (
                                      <li key={j} className="text-[11px] text-accent-700 flex gap-1">
                                        <i className="ri-focus-3-line mt-0.5"></i><span>{p}</span>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {detail.key_formulas && detail.key_formulas.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-foreground-600 mb-1">重要公式</p>
                          <ul className="space-y-0.5">
                            {detail.key_formulas.map((f, i) => (
                              <li key={i} className="text-xs text-foreground-700 font-mono bg-background-100 rounded px-2 py-1">{f}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
