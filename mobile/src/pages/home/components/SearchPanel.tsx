import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useSearch, type SearchResult } from '@/hooks/useRecords';

interface SearchPanelProps {
  onNavigateResult: (sid: string, start: number, lineId: number) => void;
}

export default function SearchPanel({ onNavigateResult }: SearchPanelProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const { results, total, loading, error, search } = useSearch();

  // Debounce input
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleInput = useCallback((val: string) => {
    setQuery(val);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      search(val);
    }, 300);
  }, [search]);

  useEffect(() => {
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  // Keyboard shortcut "/" to focus
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === '/' && e.target === document.body && !open) {
        e.preventDefault();
        setOpen(true);
        setTimeout(() => inputRef.current?.focus(), 100);
      }
      if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  // Group results by sid
  const grouped = useMemo(() => {
    const groups: Record<string, { title: string; date: string; items: SearchResult[] }> = {};
    for (const r of results) {
      if (!groups[r.sid]) {
        groups[r.sid] = { title: r.title, date: r.date, items: [] };
      }
      groups[r.sid].items.push(r);
    }
    return groups;
  }, [results]);

  const highlightText = (text: string, q: string) => {
    if (!q.trim()) return text;
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const parts = text.split(new RegExp(`(${escaped})`, 'gi'));
    return parts.map((part, i) =>
      part.toLowerCase() === q.toLowerCase()
        ? <mark key={i} className="bg-yellow-200 text-foreground-900 rounded px-0.5">{part}</mark>
        : part
    );
  };

  return (
    <div className="relative">
      {/* Trigger */}
      <button
        onClick={() => { setOpen(!open); if (!open) setTimeout(() => inputRef.current?.focus(), 100); }}
        className="w-9 h-9 flex items-center justify-center rounded-lg bg-background-100 text-foreground-500 hover:text-foreground-700 hover:bg-background-200 transition-colors cursor-pointer"
        title="搜索 (/ 快捷键)"
      >
        <i className="ri-search-line"></i>
      </button>

      {/* Dropdown Panel */}
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)}></div>
          <div className="absolute right-0 top-full mt-2 z-50 bg-background-50 rounded-xl border border-background-200 w-[520px] max-h-[70vh] flex flex-col overflow-hidden max-sm:w-[calc(100vw-32px)]">
            {/* Search Input */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-background-100">
              <div className="w-5 h-5 flex items-center justify-center flex-shrink-0">
                <i className="ri-search-line text-foreground-400"></i>
              </div>
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => handleInput(e.target.value)}
                placeholder="搜索所有课程转写内容..."
                className="flex-1 bg-transparent text-sm text-foreground-800 placeholder:text-foreground-400 outline-none border-none"
                autoComplete="off"
              />
              {query && (
                <button
                  onClick={() => handleInput('')}
                  className="w-5 h-5 flex items-center justify-center rounded-full hover:bg-background-100 text-foreground-400 cursor-pointer"
                >
                  <i className="ri-close-line text-xs"></i>
                </button>
              )}
              <span className="text-xs text-foreground-300 bg-background-100 px-1.5 py-0.5 rounded">/</span>
            </div>

            {/* Results */}
            <div className="overflow-y-auto flex-1">
              {loading && (
                <div className="flex items-center justify-center py-10">
                  <div className="w-6 h-6 flex items-center justify-center">
                    <i className="ri-loader-4-line animate-spin text-foreground-400"></i>
                  </div>
                </div>
              )}

              {error && (
                <div className="p-6 text-center">
                  <p className="text-sm text-red-500">{error}</p>
                </div>
              )}

              {!loading && !error && query && results.length === 0 && (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <div className="w-12 h-12 flex items-center justify-center mb-3">
                    <i className="ri-inbox-line text-foreground-300 text-2xl"></i>
                  </div>
                  <p className="text-sm text-foreground-400">没有找到「{query}」</p>
                </div>
              )}

              {!loading && !error && results.length > 0 && (
                <div className="py-2">
                  <div className="px-4 py-2 text-xs text-foreground-400">
                    共 {total} 条结果
                  </div>
                  {Object.entries(grouped).map(([sid, group]) => (
                    <div key={sid} className="mb-1">
                      <div className="px-4 py-2 bg-background-100/50 text-xs font-semibold text-foreground-500 flex items-center gap-2">
                        <div className="w-4 h-4 flex items-center justify-center">
                          <i className="ri-folder-line text-foreground-400"></i>
                        </div>
                        {group.title}
                        <span className="font-normal text-foreground-300">{group.date}</span>
                        <span className="ml-auto text-foreground-300">{group.items.length} 条</span>
                      </div>
                      {group.items.map((item) => (
                        <button
                          key={`${item.sid}-${item.line_id}`}
                          onClick={() => {
                            setOpen(false);
                            onNavigateResult(item.sid, item.start, item.line_id);
                          }}
                          className="w-full text-left px-4 py-2.5 hover:bg-background-100 transition-colors cursor-pointer flex items-start gap-3"
                        >
                          <span className="text-xs font-mono text-accent-600 flex-shrink-0 pt-0.5">{item.ts}</span>
                          <span className="text-xs text-foreground-400 flex-shrink-0 w-10 pt-0.5">{item.speaker}</span>
                          <span className="text-sm text-foreground-700 leading-relaxed">
                            {highlightText(item.text, query)}
                          </span>
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}