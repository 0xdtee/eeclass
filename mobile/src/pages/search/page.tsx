import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useSearch } from '@/hooks/useRecords';

export default function SearchPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { results, total, loading, error, search } = useSearch();
  const [q, setQ] = useState(params.get('q') || '');

  // 首屏若带 ?q= 直接搜一次
  useEffect(() => {
    const initial = params.get('q') || '';
    if (initial.trim()) search(initial.trim());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = () => {
    const term = q.trim();
    setParams(term ? { q: term } : {});
    search(term);
  };

  return (
    <div className="min-h-full bg-background-50">
      {/* Header + search box */}
      <div className="px-5 md:px-8 pt-6 md:pt-8 pb-4">
        <h1 className="text-lg md:text-2xl font-bold text-foreground-900 mb-4">跨课搜索</h1>
        <div className="relative max-w-5xl">
          <div className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center">
            <i className="ri-search-line text-foreground-400"></i>
          </div>
          <input
            type="text"
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder="搜索所有课堂的转写内容…"
            className="w-full pl-10 pr-10 py-2.5 md:py-3 bg-background-100 border border-background-200 rounded-xl text-sm md:text-base text-foreground-800 placeholder:text-foreground-300 focus:outline-none focus:border-accent-400 focus:ring-2 focus:ring-accent-100 transition-all"
          />
          {q && (
            <button
              onClick={submit}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 md:w-8 md:h-8 flex items-center justify-center rounded-lg bg-accent-500 text-background-50 cursor-pointer"
            >
              <i className="ri-arrow-right-line text-sm"></i>
            </button>
          )}
        </div>
      </div>

      <div className="px-5 md:px-8 pb-8 max-w-5xl">
        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-16">
            <i className="ri-loader-4-line animate-spin text-accent-500 text-2xl"></i>
          </div>
        )}

        {/* Error */}
        {!loading && error && (
          <div className="flex flex-col items-center py-16 text-center">
            <div className="w-12 h-12 flex items-center justify-center bg-red-50 rounded-xl mb-2">
              <i className="ri-error-warning-line text-red-400 text-xl"></i>
            </div>
            <p className="text-sm text-red-500">{error}</p>
          </div>
        )}

        {/* Result count */}
        {!loading && !error && results.length > 0 && (
          <p className="text-xs text-foreground-400 mb-3">共 {total} 条结果</p>
        )}

        {/* Empty (searched, nothing) */}
        {!loading && !error && params.get('q') && results.length === 0 && (
          <div className="flex flex-col items-center py-16 text-center">
            <div className="w-12 h-12 flex items-center justify-center bg-background-100 rounded-xl mb-3">
              <i className="ri-search-line text-foreground-300 text-xl"></i>
            </div>
            <p className="text-sm text-foreground-400">没有找到相关内容</p>
          </div>
        )}

        {/* Idle (no query yet) */}
        {!loading && !error && !params.get('q') && results.length === 0 && (
          <div className="flex flex-col items-center py-16 text-center">
            <div className="w-12 h-12 flex items-center justify-center bg-accent-100 rounded-xl mb-3">
              <i className="ri-search-2-line text-accent-500 text-xl"></i>
            </div>
            <p className="text-sm text-foreground-400">输入关键词，检索所有课堂转写</p>
          </div>
        )}

        {/* Results */}
        <div className="space-y-2">
          {results.map((r) => (
            <button
              key={`${r.sid}-${r.line_id}`}
              onClick={() => navigate(`/session/${encodeURIComponent(r.sid)}`)}
              className="w-full text-left bg-background-50 rounded-xl p-4 border border-background-200 hover:border-accent-300 hover:bg-accent-50/40 transition-all cursor-pointer"
            >
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <span className="text-xs font-medium text-foreground-800 truncate flex items-center gap-1">
                  <i className="ri-book-open-line text-accent-500"></i>
                  {r.title}
                </span>
                <span className="text-[11px] text-foreground-400 whitespace-nowrap">{r.date}</span>
              </div>
              <p className="text-sm text-foreground-700 leading-relaxed">
                {r.speaker && <span className="text-xs font-medium text-accent-600 mr-1.5">{r.speaker}</span>}
                {r.text}
              </p>
              <div className="flex items-center gap-2 mt-1.5">
                <span className="text-[11px] text-foreground-400 font-mono flex items-center gap-1">
                  <i className="ri-time-line"></i>{r.ts}
                </span>
                {r.kind === 'key' && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-700">重点</span>
                )}
                {r.kind === 'define' && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700">定义</span>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
