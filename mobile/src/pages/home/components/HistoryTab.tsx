import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { sessions as mockSessions, tags } from '@/mocks/courseData';
import { type SessionRecord, type Course, type CorrectionRule } from '@/hooks/useRecords';
import TagBadge from '@/components/base/TagBadge';
import CourseSidebar from '@/pages/home/components/CourseSidebar';

interface HistoryTabProps {
  selectedTags: string[];
  onSelectSession: (sessionId: string) => void;
  activeSessionId: string;
  // Real API data
  apiSessions?: SessionRecord[];
  apiCourses?: Course[];
  apiLoading?: boolean;
  apiError?: string;
  selectedCourseId?: string | null;
  onSelectCourse?: (courseId: string | null) => void;
  onCreateCourse?: (name: string) => Promise<Course | null>;
  onRenameCourse?: (id: string, name: string) => void;
  onDeleteCourse?: (id: string) => void;
  onUpdateCourse?: (id: string, patch: { hotwords?: string; corrections?: CorrectionRule[] }) => void;
  onMoveSession?: (sid: string, courseId: string) => void;
}

export default function HistoryTab({
  selectedTags,
  onSelectSession,
  activeSessionId,
  apiSessions,
  apiCourses,
  apiLoading,
  apiError,
  selectedCourseId,
  onSelectCourse,
  onCreateCourse,
  onRenameCourse,
  onDeleteCourse,
  onUpdateCourse,
  onMoveSession,
}: HistoryTabProps) {
  const navigate = useNavigate();

  // Use real data if available, fall back to mock
  const sessions: SessionRecord[] = apiSessions && apiSessions.length > 0
    ? apiSessions
    : mockSessions.map((s) => ({
        sid: s.id,
        title: s.title,
        date: s.date,
        duration: s.duration,
        tags: s.tags,
        course_id: undefined,
      }));

  const courses = apiCourses || [];
  const showSidebar = courses.length > 0 || apiCourses !== undefined;

  const filteredSessions = useMemo(() => {
    let list = sessions;
    if (selectedCourseId) {
      list = list.filter((s) => s.course_id === selectedCourseId);
    } else if (selectedCourseId === null && apiCourses?.length) {
      // Show all when "全部课程" selected
    }
    if (selectedTags.length > 0) {
      list = list.filter((s) => s.tags.some((t) => selectedTags.includes(t)));
    }
    return list;
  }, [sessions, selectedCourseId, selectedTags, apiCourses]);

  const getTagLabel = (tagId: string) => {
    const tag = tags.find((t) => t.id === tagId);
    return tag?.label ?? tagId;
  };

  return (
    <div className="space-y-5">
      <div className={`${showSidebar ? 'flex flex-col lg:flex-row gap-5' : ''}`}>
        {/* Sidebar */}
        {showSidebar && onSelectCourse && onCreateCourse && onRenameCourse && onDeleteCourse && onUpdateCourse && onMoveSession && (
          <div className="w-full lg:w-64 flex-shrink-0">
            <CourseSidebar
              courses={courses}
              sessions={sessions}
              activeSessionId={activeSessionId}
              selectedCourseId={selectedCourseId ?? null}
              onSelectCourse={onSelectCourse}
              onSelectSession={onSelectSession}
              onCreateCourse={onCreateCourse}
              onRenameCourse={onRenameCourse}
              onDeleteCourse={onDeleteCourse}
              onUpdateCourse={onUpdateCourse}
              onMoveSession={onMoveSession}
            />
          </div>
        )}

        {/* Session list */}
        <div className="flex-1 min-w-0">
          <div className="bg-background-50 border border-background-200 rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-background-100">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 flex items-center justify-center">
                  <i className="ri-history-line text-foreground-500 text-lg"></i>
                </div>
                <h3 className="text-sm font-semibold text-foreground-800">
                  历史课程记录
                  {selectedTags.length > 0 && (
                    <span className="ml-2 text-xs font-normal text-foreground-400">
                      （已筛选 {filteredSessions.length}/{sessions.length} 条）
                    </span>
                  )}
                </h3>
              </div>
            </div>

            {apiLoading && (
              <div className="flex items-center justify-center py-20">
                <div className="w-6 h-6 flex items-center justify-center">
                  <i className="ri-loader-4-line animate-spin text-foreground-400"></i>
                </div>
              </div>
            )}

            {apiError && (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <p className="text-sm text-red-500">{apiError}</p>
              </div>
            )}

            {!apiLoading && !apiError && filteredSessions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <div className="w-16 h-16 flex items-center justify-center mb-4">
                  <i className="ri-inbox-line text-foreground-300 text-3xl"></i>
                </div>
                <p className="text-sm text-foreground-400">没有匹配的课程记录</p>
                <p className="text-xs text-foreground-300 mt-1">尝试调整章节筛选条件</p>
              </div>
            ) : !apiLoading && !apiError && (
              <div className="divide-y divide-background-100">
                {filteredSessions.map((session) => (
                  <button
                    key={session.sid}
                    onClick={() => onSelectSession(session.sid)}
                    className={`w-full text-left px-6 py-4 hover:bg-background-100 transition-colors cursor-pointer ${
                      activeSessionId === session.sid ? 'bg-accent-50 border-l-3 border-l-accent-500' : ''
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1.5">
                          <h4 className="text-sm font-semibold text-foreground-800 truncate">{session.title}</h4>
                          {activeSessionId === session.sid && (
                            <span className="flex-shrink-0 w-1.5 h-1.5 rounded-full bg-accent-500"></span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-xs text-foreground-400">
                          <span className="flex items-center gap-1">
                            <i className="ri-calendar-line"></i>
                            {session.date}
                          </span>
                          <span className="flex items-center gap-1">
                            <i className="ri-time-line"></i>
                            {session.duration}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {session.tags.map((tagId) => (
                            <TagBadge key={tagId} label={getTagLabel(tagId)} size="sm" color="secondary" />
                          ))}
                        </div>
                      </div>
                      <div className="flex-shrink-0 w-8 h-8 flex items-center justify-center">
                        <i className="ri-arrow-right-s-line text-foreground-300 text-lg"></i>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}