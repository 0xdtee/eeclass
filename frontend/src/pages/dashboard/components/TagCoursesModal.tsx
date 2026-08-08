import { useState } from 'react';
import Modal from '@/components/base/Modal';

export interface TagGroup {
  tag: string;         // Tag name
  courses: string[];   // Course names under this tag (from the imported timetable)
  count: number;       // How many recordings carry this tag
}

interface TagCoursesModalProps {
  isOpen: boolean;
  onClose: () => void;
  groups: TagGroup[];
  onSelect: (tag: string) => void;
  onManage?: () => void;   // Go to /tags to manage tags
}

export default function TagCoursesModal({ isOpen, onClose, groups, onSelect, onManage }: TagCoursesModalProps) {
  const [search, setSearch] = useState('');
  const filtered = groups.filter((g) => !search.trim() || g.tag.toLowerCase().includes(search.trim().toLowerCase()));

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="按标签整理课程" width="max-w-lg">
      <div className="flex flex-col" style={{ maxHeight: '70vh' }}>
        {/* Stats + search */}
        <div className="flex items-center justify-between px-1 pb-4 border-b border-background-100 mb-3">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 flex items-center justify-center bg-secondary-100 rounded-xl">
              <i className="ri-price-tag-3-line text-secondary-600 text-lg"></i>
            </div>
            <div>
              <p className="text-xs text-foreground-400">用到的标签(按标签整理课程与录音)</p>
              <p className="text-2xl font-bold text-foreground-900">{groups.length} 个</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {onManage && (
              <button
                onClick={onManage}
                className="h-8 px-3 flex items-center gap-1 bg-background-100 text-foreground-600 rounded-lg text-xs font-medium hover:bg-background-200 transition-colors cursor-pointer whitespace-nowrap"
                title="管理标签"
              >
                <i className="ri-settings-3-line text-xs"></i>管理标签
              </button>
            )}
            <div className="relative">
              <div className="w-4 h-4 flex items-center justify-center absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
                <i className="ri-search-line text-foreground-400 text-xs"></i>
              </div>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索标签…"
                className="h-8 pl-8 pr-3 w-32 bg-background-100 border border-background-200 rounded-lg text-xs text-foreground-700 placeholder:text-foreground-300 focus:outline-none focus:border-accent-400 focus:ring-1 focus:ring-accent-100 transition-all"
              />
            </div>
          </div>
        </div>

        {/* Tag list */}
        <div className="overflow-y-auto flex-1 space-y-2">
          {filtered.length === 0 ? (
            <div className="py-10 text-center">
              {groups.length === 0 ? (
                <>
                  <div className="w-14 h-14 mx-auto flex items-center justify-center bg-background-100 rounded-2xl mb-4">
                    <i className="ri-price-tag-3-line text-foreground-300 text-2xl"></i>
                  </div>
                  <p className="text-sm font-medium text-foreground-500 mb-1">还没有带标签的课程</p>
                  <p className="text-xs text-foreground-300 mb-4">用图片导入课表时会按课名自动给课打标签;也可到某节课的「录音集合」给录音打标签,之后就能在这里按标签整理。</p>
                  {onManage && (
                    <button
                      onClick={onManage}
                      className="inline-flex items-center gap-1.5 px-4 py-2 bg-accent-500 text-background-50 rounded-full text-xs font-semibold hover:bg-accent-600 transition-colors cursor-pointer"
                    >
                      <i className="ri-settings-3-line"></i>去管理标签
                    </button>
                  )}
                </>
              ) : (
                <p className="text-sm text-foreground-400">没找到匹配的标签</p>
              )}
            </div>
          ) : (
            filtered.map((g, idx) => (
              <div key={g.tag} className="bg-background-50 border border-background-100 rounded-xl overflow-hidden">
                <button
                  onClick={() => onSelect(g.tag)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-accent-50/40 transition-colors cursor-pointer text-left group"
                >
                  <span className="w-6 h-6 flex items-center justify-center flex-shrink-0 bg-secondary-100 text-secondary-700 rounded-lg text-xs font-bold">
                    {idx + 1}
                  </span>
                  <span className="text-sm font-medium text-foreground-800 flex-1 truncate">{g.tag}</span>
                  {g.courses.length > 0 && (
                    <span className="px-2 py-0.5 bg-secondary-100 text-secondary-700 rounded-full text-[11px] font-medium whitespace-nowrap flex-shrink-0">
                      <i className="ri-book-2-line mr-0.5"></i>{g.courses.length} 门课
                    </span>
                  )}
                  {g.count > 0 && (
                    <span className="px-2 py-0.5 bg-primary-100 text-primary-700 rounded-full text-[11px] font-medium whitespace-nowrap flex-shrink-0">
                      <i className="ri-mic-line mr-0.5"></i>{g.count} 段录音
                    </span>
                  )}
                  <i className="ri-arrow-right-s-line text-foreground-300 group-hover:text-accent-500 flex-shrink-0"></i>
                </button>
                {g.courses.length > 0 && (
                  <div className="px-3 pb-2.5 flex flex-wrap gap-1.5">
                    {g.courses.map((c) => (
                      <span key={c} className="px-2 py-0.5 bg-background-100 text-foreground-600 rounded-md text-[11px]">{c}</span>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </Modal>
  );
}
