import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSessions, useCourses } from '@/hooks/useRecords';

export default function CoursesPage() {
  const navigate = useNavigate();
  const { sessions, loading, error } = useSessions();
  const { courses } = useCourses();
  const [activeCourse, setActiveCourse] = useState<string>('all');

  // Group sessions by course: sid -> course_id; uncategorized go to all
  const courseOf = useMemo(() => {
    const map = new Map<string, string>();
    courses.forEach((c) => (c.session_ids || []).forEach((sid) => map.set(sid, c.id)));
    return map;
  }, [courses]);

  const filtered = useMemo(() => {
    if (activeCourse === 'all') return sessions;
    return sessions.filter((s) => courseOf.get(s.sid) === activeCourse);
  }, [sessions, activeCourse, courseOf]);

  return (
    <div className="min-h-full bg-background-50">
      {/* Header */}
      <div className="px-5 md:px-8 pt-6 md:pt-8 pb-4">
        <h1 className="text-lg md:text-2xl font-bold text-foreground-900">课程</h1>
        <p className="text-xs md:text-sm text-foreground-400 mt-1">全部课时与课程分组</p>
      </div>

      {/* Course filter chips */}
      {courses.length > 0 && (
        <div className="px-5 md:px-8 mb-3">
          <div className="flex gap-2 overflow-x-auto pb-1">
            <button
              onClick={() => setActiveCourse('all')}
              className={`px-3 py-1.5 rounded-full text-xs whitespace-nowrap border transition-colors ${
                activeCourse === 'all' ? 'bg-accent-500 text-background-50 border-accent-500' : 'bg-background-50 text-foreground-600 border-background-200'
              }`}
            >
              全部
            </button>
            {courses.map((c) => (
              <button
                key={c.id}
                onClick={() => setActiveCourse(c.id)}
                className={`px-3 py-1.5 rounded-full text-xs whitespace-nowrap border transition-colors ${
                  activeCourse === c.id ? 'bg-accent-500 text-background-50 border-accent-500' : 'bg-background-50 text-foreground-600 border-background-200'
                }`}
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="px-5 md:px-8 pb-8">
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
            <p className="text-xs text-foreground-400 mt-1">请检查后端服务是否运行</p>
          </div>
        )}

        {/* Empty */}
        {!loading && !error && filtered.length === 0 && (
          <div className="flex flex-col items-center py-16 text-center">
            <div className="w-16 h-16 flex items-center justify-center bg-accent-100 rounded-2xl mb-4">
              <i className="ri-book-2-line text-accent-600 text-2xl"></i>
            </div>
            <p className="text-sm text-foreground-400 mb-4">还没有课时记录</p>
            <button
              onClick={() => navigate('/record')}
              className="px-5 py-2.5 bg-accent-500 text-background-50 rounded-lg text-sm font-medium cursor-pointer hover:bg-accent-600 transition-colors whitespace-nowrap"
            >
              开始录音
            </button>
          </div>
        )}

        {/* Session list */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 md:gap-3">
          {filtered.map((session) => (
            <button
              key={session.sid}
              onClick={() => navigate(`/session/${encodeURIComponent(session.sid)}`)}
              className="w-full text-left bg-background-50 rounded-xl p-4 md:p-5 border border-background-200 hover:border-accent-300 hover:bg-accent-50/50 transition-all cursor-pointer group"
            >
              <div className="flex items-start gap-3 md:gap-4">
                <div className="w-9 h-9 md:w-11 md:h-11 flex items-center justify-center bg-accent-100 rounded-xl flex-shrink-0 mt-0.5 group-hover:bg-accent-200 transition-colors">
                  <i className="ri-file-text-line text-accent-600 text-base md:text-lg"></i>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm md:text-base font-medium text-foreground-800 truncate">{session.title}</p>
                    {session.summary && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent-100 text-accent-700 flex-shrink-0">摘要</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-1.5">
                    <span className="text-xs text-foreground-400 flex items-center gap-1">
                      <i className="ri-calendar-line"></i>{session.date}
                    </span>
                    {session.duration && (
                      <span className="text-xs text-foreground-400 flex items-center gap-1">
                        <i className="ri-time-line"></i>{session.duration}
                      </span>
                    )}
                  </div>
                </div>
                <div className="w-6 h-6 flex items-center justify-center flex-shrink-0 text-foreground-300 group-hover:text-accent-500 transition-colors">
                  <i className="ri-arrow-right-s-line"></i>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
