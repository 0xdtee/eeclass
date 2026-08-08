import { useState, useRef, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

interface SessionData {
  id: string;
  title: string;
  date: string;
  time: string;
  duration: string;
  tags: string[];
  description: string;
  summary: string;
  keyPoints: string[];
}

interface SearchBarProps {
  sessions: SessionData[];
  tagLabels: Record<string, string>;
}

type SearchMode = 'all' | 'title' | 'content' | 'tag';

const MODE_OPTIONS: { value: SearchMode; label: string }[] = [
  { value: 'all', label: '全部搜索' },
  { value: 'title', label: '标题搜索' },
  { value: 'content', label: '内容搜索' },
  { value: 'tag', label: '标签搜索' },
];

function getHighlightedSnippet(text: string, query: string, maxLen: number = 80): string {
  const lower = text.toLowerCase();
  const qLower = query.toLowerCase();
  const idx = lower.indexOf(qLower);
  if (idx === -1) return text.slice(0, maxLen) + (text.length > maxLen ? '...' : '');

  const start = Math.max(0, idx - 30);
  const end = Math.min(text.length, idx + query.length + 50);
  let snippet = '';
  if (start > 0) snippet += '...';
  snippet += text.slice(start, end);
  if (end < text.length) snippet += '...';
  return snippet;
}

export default function SearchBar({ sessions, tagLabels }: SearchBarProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<SearchMode>('all');
  const [showModeDropdown, setShowModeDropdown] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.trim().toLowerCase();

    return sessions
      .filter((s) => {
        switch (mode) {
          case 'title':
            return s.title.toLowerCase().includes(q);
          case 'content':
            return (
              s.description.toLowerCase().includes(q) ||
              s.summary.toLowerCase().includes(q)
            );
          case 'tag':
            return s.tags.some((tagId) => {
              const label = tagLabels[tagId];
              return label?.toLowerCase().includes(q) || tagId.toLowerCase().includes(q);
            });
          case 'all':
          default:
            return (
              s.title.toLowerCase().includes(q) ||
              s.description.toLowerCase().includes(q) ||
              s.summary.toLowerCase().includes(q) ||
              s.tags.some((tagId) => {
                const label = tagLabels[tagId];
                return label?.toLowerCase().includes(q);
              })
            );
        }
      })
      .slice(0, 20);
  }, [query, mode, sessions, tagLabels]);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowResults(false);
        setShowModeDropdown(false);
        setSelectedIdx(-1);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (id: string) => {
    setQuery('');
    setShowResults(false);
    setSelectedIdx(-1);
    navigate(`/course?sid=${encodeURIComponent(id)}`);   // Open the matched session, not a blank new-recording page
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showResults || results.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx((prev) => (prev < results.length - 1 ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx((prev) => (prev > 0 ? prev - 1 : results.length - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (selectedIdx >= 0 && selectedIdx < results.length) {
        handleSelect(results[selectedIdx].id);
      }
    } else if (e.key === 'Escape') {
      setShowResults(false);
      setSelectedIdx(-1);
      inputRef.current?.blur();
    }
  };

  const currentModeLabel = MODE_OPTIONS.find((m) => m.value === mode)?.label ?? '全部搜索';

  const getResultSnippet = (s: SessionData): { text: string; field: string } => {
    const q = query.trim().toLowerCase();
    if (s.title.toLowerCase().includes(q)) {
      return { text: s.title, field: '标题' };
    }
    if (s.description.toLowerCase().includes(q)) {
      return { text: getHighlightedSnippet(s.description, q), field: '描述' };
    }
    if (s.summary.toLowerCase().includes(q)) {
      return { text: getHighlightedSnippet(s.summary, q), field: '摘要' };
    }
    const matchedTag = s.tags.find((tagId) => {
      const label = tagLabels[tagId];
      return label?.toLowerCase().includes(q);
    });
    if (matchedTag) {
      return { text: tagLabels[matchedTag] ?? matchedTag, field: '标签' };
    }
    return { text: s.title, field: '' };
  };

  return (
    <div ref={containerRef} className="relative w-full max-w-2xl">
      <div className="flex items-center gap-0">
        {/* Mode selector button */}
        <div className="relative z-10">
          <button
            type="button"
            onClick={() => {
              setShowModeDropdown(!showModeDropdown);
              setShowResults(false);
            }}
            className="flex items-center gap-1.5 h-11 px-4 bg-background-100 border border-background-200 border-r-0 rounded-l-xl text-xs font-medium text-foreground-600 hover:bg-background-200 transition-colors cursor-pointer whitespace-nowrap"
          >
            {currentModeLabel}
            <div className="w-3.5 h-3.5 flex items-center justify-center">
              {showModeDropdown ? (
                <i className="ri-arrow-up-s-line text-foreground-400"></i>
              ) : (
                <i className="ri-arrow-down-s-line text-foreground-400"></i>
              )}
            </div>
          </button>

          {showModeDropdown && (
            <div className="absolute top-full left-0 mt-1 w-40 bg-background-50 rounded-xl border border-background-200 shadow-xl z-[60] py-1">
              {MODE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => {
                    setMode(opt.value);
                    setShowModeDropdown(false);
                    setSelectedIdx(-1);
                    if (query.trim()) setShowResults(true);
                  }}
                  className={`w-full text-left px-4 py-2.5 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                    mode === opt.value
                      ? 'bg-accent-50 text-accent-700'
                      : 'text-foreground-600 hover:bg-background-100'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Search input */}
        <div className="relative flex-1">
          <div className="w-4 h-4 flex items-center justify-center absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none">
            <i className="ri-search-line text-foreground-400 text-base"></i>
          </div>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setShowResults(e.target.value.trim().length > 0);
              setSelectedIdx(-1);
            }}
            onFocus={() => {
              if (query.trim()) setShowResults(true);
            }}
            onKeyDown={handleKeyDown}
            placeholder={`搜索课时记录 — ${currentModeLabel}`}
            className="w-full h-11 pl-10 pr-10 bg-background-100 border border-background-200 rounded-r-xl text-sm text-foreground-800 placeholder:text-foreground-300 focus:outline-none focus:border-accent-400 focus:ring-2 focus:ring-accent-100 transition-all"
          />
          {query && (
            <button
              onClick={() => {
                setQuery('');
                setShowResults(false);
                setSelectedIdx(-1);
                inputRef.current?.focus();
              }}
              className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center text-foreground-300 hover:text-foreground-500 transition-colors cursor-pointer"
            >
              <i className="ri-close-circle-fill text-sm"></i>
            </button>
          )}
        </div>
      </div>

      {/* Results dropdown */}
      {showResults && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-background-50 rounded-2xl border border-background-200 shadow-lg z-50 overflow-hidden max-h-[420px] overflow-y-auto">
          {results.length === 0 ? (
            <div className="px-5 py-8 text-center">
              <div className="w-12 h-12 mx-auto flex items-center justify-center bg-background-100 rounded-full mb-3">
                <i className="ri-search-line text-foreground-300 text-xl"></i>
              </div>
              <p className="text-sm text-foreground-400">未找到匹配的课时记录</p>
              <p className="text-xs text-foreground-300 mt-1">试试换个关键词或切换搜索模式</p>
            </div>
          ) : (
            <>
              <div className="px-5 py-3 border-b border-background-100">
                <p className="text-xs text-foreground-400">
                  找到 <span className="font-semibold text-foreground-600">{results.length}</span> 条结果
                  {results.length >= 20 && <span className="text-foreground-300">（仅显示前20条）</span>}
                </p>
              </div>
              <div className="py-1">
                {results.map((s, idx) => {
                  const snippet = getResultSnippet(s);
                  return (
                    <button
                      key={s.id}
                      onClick={() => handleSelect(s.id)}
                      onMouseEnter={() => setSelectedIdx(idx)}
                      className={`w-full text-left px-5 py-3 transition-colors cursor-pointer border-b border-background-50 last:border-b-0 ${
                        idx === selectedIdx ? 'bg-accent-50' : 'hover:bg-background-100'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3 mb-1">
                        <p className="text-sm font-semibold text-foreground-800 truncate">{s.title}</p>
                        <span className="text-xs text-foreground-400 whitespace-nowrap">{s.date}</span>
                      </div>
                      <div className="flex items-center gap-2 mb-1.5">
                        {snippet.field && (
                          <span className="px-1.5 py-0.5 bg-accent-100 text-accent-700 rounded text-[10px] font-medium whitespace-nowrap">
                            {snippet.field}
                          </span>
                        )}
                        <p className="text-xs text-foreground-500 truncate">{snippet.text}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {s.tags.map((tagId) => (
                          <span key={tagId} className="px-1.5 py-0.5 bg-secondary-100 text-secondary-700 rounded text-[10px] font-medium whitespace-nowrap">
                            {tagLabels[tagId] ?? tagId}
                          </span>
                        ))}
                        <span className="text-[10px] text-foreground-300">{s.time} · {s.duration}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}