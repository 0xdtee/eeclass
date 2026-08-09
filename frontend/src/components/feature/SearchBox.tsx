/**
 * Full-text search across courses. After a semester's worth of dozens of classes, "what did the teacher say the time they covered Green's theorem" is impossible to find by scrolling.
 * Press / to focus, search as you type (debounced), results grouped by course.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SearchHit } from '@/hooks/useLibrary';
import { useT } from '@/lib/i18n';

interface SearchBoxProps {
  onSearch: (q: string) => Promise<{ results: SearchHit[]; total: number }>;
  onJump: (hit: SearchHit) => void;
}

export default function SearchBox({ onSearch, onJump }: SearchBoxProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  // Press / to start searching directly (when not in an input field)
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === '/' && !['INPUT', 'TEXTAREA'].includes(t.tagName)) {
        e.preventDefault();
        setOpen(true);
        setTimeout(() => inputRef.current?.focus(), 0);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const run = useCallback(
    async (text: string) => {
      if (!text.trim()) {
        setHits([]);
        setTotal(0);
        return;
      }
      setBusy(true);
      setError('');
      try {
        const j = await onSearch(text.trim());
        setHits(j.results);
        setTotal(j.total);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [onSearch]
  );

  // Search as you type, debounced 300ms
  useEffect(() => {
    const t = setTimeout(() => void run(q), 300);
    return () => clearTimeout(t);
  }, [q, run]);

  /** Highlight matched keywords in yellow */
  const highlight = (text: string) => {
    const chars = Array.from(new Set(Array.from(q.trim())));
    if (chars.length === 0) return text;
    const re = new RegExp(`(${chars.map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'g');
    return text.split(re).map((part, i) =>
      chars.includes(part) ? (
        <mark key={i} className="bg-yellow-200 text-foreground-900 rounded px-0.5">
          {part}
        </mark>
      ) : (
        part
      )
    );
  };

  // Group by course
  const groups: { sid: string; title: string; date: string; items: SearchHit[] }[] = [];
  for (const h of hits) {
    let g = groups.find((x) => x.sid === h.sid);
    if (!g) {
      g = { sid: h.sid, title: h.title, date: h.date, items: [] };
      groups.push(g);
    }
    g.items.push(h);
  }

  return (
    <div ref={boxRef} className="relative">
      {!open ? (
        <button
          onClick={() => {
            setOpen(true);
            setTimeout(() => inputRef.current?.focus(), 0);
          }}
          className="w-9 h-9 flex items-center justify-center rounded-lg bg-background-100 text-foreground-500 hover:text-foreground-700 hover:bg-background-200 transition-colors cursor-pointer"
          title={t('搜索所有课程（按 / ）')}
        >
          <i className="ri-search-line"></i>
        </button>
      ) : (
        <div className="flex items-center gap-2">
          <div className="relative">
            <i className="ri-search-line absolute left-2.5 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></i>
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('搜所有课程的转写…')}
              className="w-52 sm:w-72 text-xs pl-8 pr-3 py-2 rounded-lg border border-background-200 bg-background-50 text-foreground-700"
            />
            {busy && (
              <i className="ri-loader-4-line animate-spin absolute right-2.5 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></i>
            )}
          </div>
        </div>
      )}

      {open && q.trim() && (
        <div className="absolute right-0 mt-2 w-[min(560px,90vw)] max-h-[70vh] overflow-y-auto bg-background-50 border border-background-200 rounded-xl shadow-xl z-50">
          {error && <p className="p-4 text-xs text-red-600">{error}</p>}

          {!error && hits.length === 0 && !busy && (
            <p className="p-6 text-center text-xs text-foreground-400">
              {t('没有找到「{q}」', { q: q.trim() })}
            </p>
          )}

          {hits.length > 0 && (
            <p className="px-4 pt-3 pb-1 text-xs text-foreground-400">
              {t('共 {total} 条，显示前 {n} 条', { total, n: hits.length })}
            </p>
          )}

          {groups.map((g) => (
            <div key={g.sid} className="px-2 py-1">
              <div className="px-2 py-1.5 flex items-center justify-between">
                <span className="text-xs font-semibold text-foreground-700 truncate">{g.title}</span>
                <span className="text-xs text-foreground-400 flex-shrink-0 ml-2">
                  {g.date} · {t('{n} 处', { n: g.items.length })}
                </span>
              </div>
              {g.items.map((h) => (
                <button
                  key={`${h.sid}-${h.line_id}`}
                  onClick={() => {
                    onJump(h);
                    setOpen(false);
                  }}
                  className="w-full text-left px-2 py-2 rounded-lg hover:bg-background-100 transition-colors cursor-pointer"
                >
                  <span className="text-xs text-foreground-400 font-mono mr-2">{h.ts}</span>
                  <span className="text-xs text-accent-600 mr-2">{h.speaker}</span>
                  <span className="text-xs text-foreground-700">{highlight(h.text)}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
