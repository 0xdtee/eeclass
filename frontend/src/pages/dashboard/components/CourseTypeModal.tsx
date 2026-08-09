import { useState } from 'react';
import Modal from '@/components/base/Modal';
import { useT } from '@/lib/i18n';

export interface CourseGroup {
  name: string;
  recordings: number;   // How many times this course was recorded
  schedule: number;     // How many sessions appear in the timetable
}

interface CourseTypeModalProps {
  isOpen: boolean;
  onClose: () => void;
  courses: CourseGroup[];
  onSelect?: (name: string) => void;
}

export default function CourseTypeModal({ isOpen, onClose, courses, onSelect }: CourseTypeModalProps) {
  const t = useT();
  const [search, setSearch] = useState('');
  const filtered = courses.filter((c) => !search.trim() || c.name.toLowerCase().includes(search.trim().toLowerCase()));

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('全部课程')} width="max-w-lg">
      <div className="flex flex-col" style={{ maxHeight: '70vh' }}>
        {/* Stats + search */}
        <div className="flex items-center justify-between px-1 pb-4 border-b border-background-100 mb-3">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 flex items-center justify-center bg-accent-100 rounded-xl">
              <i className="ri-book-open-line text-accent-600 text-lg"></i>
            </div>
            <div>
              <p className="text-xs text-foreground-400">{t('课程门数(同名归为一门)')}</p>
              <p className="text-2xl font-bold text-foreground-900">{t('{n} 门', { n: courses.length })}</p>
            </div>
          </div>
          <div className="relative">
            <div className="w-4 h-4 flex items-center justify-center absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
              <i className="ri-search-line text-foreground-400 text-xs"></i>
            </div>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('搜索课程…')}
              className="h-8 pl-8 pr-3 w-40 bg-background-100 border border-background-200 rounded-lg text-xs text-foreground-700 placeholder:text-foreground-300 focus:outline-none focus:border-accent-400 focus:ring-1 focus:ring-accent-100 transition-all"
            />
          </div>
        </div>

        {/* Course list */}
        <div className="overflow-y-auto flex-1 space-y-2">
          {filtered.length === 0 ? (
            <div className="py-10 text-center text-sm text-foreground-400">
              {courses.length === 0 ? t('还没有课程。去录一节课,或导入课表。') : t('没找到匹配的课程')}
            </div>
          ) : (
            filtered.map((c, idx) => (
              <button
                key={c.name}
                data-guide={idx === 0 ? 'course-pick' : undefined}
                onClick={() => onSelect?.(c.name)}
                className="w-full flex items-center gap-3 px-3 py-2.5 bg-background-50 border border-background-100 rounded-xl hover:border-accent-300 hover:bg-accent-50/40 transition-colors cursor-pointer text-left group"
              >
                <span className="w-6 h-6 flex items-center justify-center flex-shrink-0 bg-accent-100 text-accent-700 rounded-lg text-xs font-bold">
                  {idx + 1}
                </span>
                <span className="text-sm font-medium text-foreground-800 flex-1 truncate">{c.name}</span>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {c.recordings > 0 && (
                    <span className="px-2 py-0.5 bg-primary-100 text-primary-700 rounded-full text-[11px] font-medium whitespace-nowrap">
                      <i className="ri-mic-line mr-0.5"></i>{t('录制 {n} 次', { n: c.recordings })}
                    </span>
                  )}
                  {c.schedule > 0 && (
                    <span className="px-2 py-0.5 bg-secondary-100 text-secondary-700 rounded-full text-[11px] font-medium whitespace-nowrap">
                      <i className="ri-calendar-line mr-0.5"></i>{t('课表 {n} 节', { n: c.schedule })}
                    </span>
                  )}
                </div>
                <i className="ri-arrow-right-s-line text-foreground-300 group-hover:text-accent-500 flex-shrink-0"></i>
              </button>
            ))
          )}
        </div>
      </div>
    </Modal>
  );
}
