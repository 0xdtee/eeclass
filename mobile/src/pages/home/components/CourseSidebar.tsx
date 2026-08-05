import { useState, useCallback } from 'react';
import { type Course, type SessionRecord } from '@/hooks/useRecords';
import GlossaryModal from '@/pages/home/components/GlossaryModal';

interface CourseSidebarProps {
  courses: Course[];
  sessions: SessionRecord[];
  activeSessionId: string;
  selectedCourseId: string | null;
  onSelectCourse: (courseId: string | null) => void;
  onSelectSession: (sid: string) => void;
  onCreateCourse: (name: string) => Promise<Course | null>;
  onRenameCourse: (id: string, name: string) => void;
  onDeleteCourse: (id: string) => void;
  onUpdateCourse: (id: string, patch: { hotwords?: string; corrections?: { from: string; to: string; enabled: boolean }[] }) => void;
  onMoveSession: (sid: string, courseId: string) => void;
}

export default function CourseSidebar({
  courses,
  sessions,
  activeSessionId,
  selectedCourseId,
  onSelectCourse,
  onSelectSession,
  onCreateCourse,
  onRenameCourse,
  onDeleteCourse,
  onUpdateCourse,
  onMoveSession,
}: CourseSidebarProps) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');
  const [glossaryCourse, setGlossaryCourse] = useState<Course | null>(null);

  const unassignedSessions = sessions.filter((s) => !s.course_id);
  const courseSessionMap: Record<string, SessionRecord[]> = {};
  for (const c of courses) {
    courseSessionMap[c.id] = sessions.filter((s) => s.course_id === c.id);
  }

  const totalDurationStr = (sessList: SessionRecord[]) => {
    if (sessList.length === 0) return '';
    return `${sessList.length} 节`;
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    const course = await onCreateCourse(newName.trim());
    if (course) {
      setNewName('');
      setCreating(false);
    }
  };

  // Drag and drop session to course
  const handleDragStart = (e: React.DragEvent, sid: string) => {
    e.dataTransfer.setData('text/plain', sid);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, courseId: string) => {
    e.preventDefault();
    const sid = e.dataTransfer.getData('text/plain');
    if (sid) onMoveSession(sid, courseId);
  };

  const handleDropUnassigned = (e: React.DragEvent) => {
    e.preventDefault();
    const sid = e.dataTransfer.getData('text/plain');
    if (sid) onMoveSession(sid, ''); // empty = unassign
  };

  return (
    <>
      <div className="bg-background-50 border border-background-200 rounded-xl overflow-hidden flex flex-col min-h-[400px]">
        <div className="px-4 py-3 border-b border-background-100 flex items-center justify-between">
          <span className="text-xs font-semibold text-foreground-500 uppercase tracking-wider">课程分组</span>
          <button
            onClick={() => setCreating(true)}
            className="w-6 h-6 flex items-center justify-center rounded-md hover:bg-background-100 text-foreground-400 hover:text-foreground-600 transition-colors cursor-pointer"
          >
            <i className="ri-add-line text-sm"></i>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Create input */}
          {creating && (
            <div className="px-4 py-2 flex items-center gap-2">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setCreating(false); }}
                placeholder="课程名称"
                className="flex-1 px-2.5 py-1.5 bg-background-100 border border-background-200 rounded text-xs text-foreground-800 outline-none focus:border-accent-300"
                autoFocus
              />
              <button onClick={handleCreate} className="w-6 h-6 flex items-center justify-center rounded text-accent-600 hover:bg-accent-50 cursor-pointer">
                <i className="ri-check-line text-xs"></i>
              </button>
              <button onClick={() => setCreating(false)} className="w-6 h-6 flex items-center justify-center rounded text-foreground-400 hover:bg-background-100 cursor-pointer">
                <i className="ri-close-line text-xs"></i>
              </button>
            </div>
          )}

          {/* "All" */}
          <button
            onClick={() => onSelectCourse(null)}
            className={`w-full text-left px-4 py-2.5 flex items-center justify-between hover:bg-background-100 transition-colors cursor-pointer ${
              selectedCourseId === null ? 'bg-accent-50 border-l-3 border-l-accent-500' : ''
            }`}
          >
            <span className="text-sm font-medium text-foreground-800">全部课程</span>
            <span className="text-xs text-foreground-400">{sessions.length} 节</span>
          </button>

          {/* Unassigned - with drop zone */}
          <div
            onDragOver={handleDragOver}
            onDrop={handleDropUnassigned}
            className={`px-4 py-2.5 border-t border-background-100 ${
              unassignedSessions.length > 0 ? 'min-h-[40px]' : ''
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-foreground-400">未分类</span>
              <span className="text-xs text-foreground-300">{unassignedSessions.length} 节</span>
            </div>
            {unassignedSessions.map((s) => (
              <button
                key={s.sid}
                draggable
                onDragStart={(e) => handleDragStart(e, s.sid)}
                onClick={() => onSelectSession(s.sid)}
                className={`w-full text-left px-3 py-1.5 rounded-md text-xs transition-colors cursor-grab active:cursor-grabbing ${
                  activeSessionId === s.sid
                    ? 'bg-accent-100 text-accent-800 font-medium'
                    : 'text-foreground-600 hover:bg-background-100'
                }`}
              >
                {s.title}
              </button>
            ))}
          </div>

          {/* Course items */}
          {courses.map((course) => {
            const list = courseSessionMap[course.id] || [];
            return (
              <div key={course.id} className="border-t border-background-100">
                {/* Course header */}
                <div
                  onDragOver={handleDragOver}
                  onDrop={(e) => handleDrop(e, course.id)}
                >
                  {renaming === course.id ? (
                    <div className="px-4 py-2 flex items-center gap-2">
                      <input
                        type="text"
                        value={renameText}
                        onChange={(e) => setRenameText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') { onRenameCourse(course.id, renameText); setRenaming(null); }
                          if (e.key === 'Escape') setRenaming(null);
                        }}
                        className="flex-1 px-2.5 py-1 bg-background-100 border border-background-200 rounded text-xs outline-none focus:border-accent-300"
                        autoFocus
                      />
                      <button onClick={() => { onRenameCourse(course.id, renameText); setRenaming(null); }} className="w-5 h-5 flex items-center justify-center rounded text-accent-600 cursor-pointer">
                        <i className="ri-check-line text-xs"></i>
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center px-4 py-2.5 group">
                      <button
                        onClick={() => onSelectCourse(course.id)}
                        className={`flex-1 text-left flex items-center gap-2 cursor-pointer ${
                          selectedCourseId === course.id ? '' : ''
                        }`}
                      >
                        <span
                          className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                            course.color === 'accent' ? 'bg-accent-500' : course.color === 'primary' ? 'bg-primary-500' : 'bg-secondary-500'
                          }`}
                        ></span>
                        <span className={`text-sm font-medium ${
                          selectedCourseId === course.id ? 'text-accent-700' : 'text-foreground-800'
                        }`}>
                          {course.name}
                        </span>
                      </button>
                      <span className="text-xs text-foreground-300 mr-2">{list.length} 节</span>
                      <div className="hidden group-hover:flex items-center gap-0.5">
                        <button
                          onClick={() => setGlossaryCourse(course)}
                          className="w-5 h-5 flex items-center justify-center rounded text-foreground-400 hover:text-accent-600 cursor-pointer"
                          title="术语表"
                        >
                          <i className="ri-book-read-line text-xs"></i>
                        </button>
                        <button
                          onClick={() => { setRenaming(course.id); setRenameText(course.name); }}
                          className="w-5 h-5 flex items-center justify-center rounded text-foreground-400 hover:text-foreground-600 cursor-pointer"
                          title="重命名"
                        >
                          <i className="ri-edit-line text-xs"></i>
                        </button>
                        <button
                          onClick={() => { if (confirm(`删除课程 "${course.name}"？课时不会删除，只会变为未分类。`)) onDeleteCourse(course.id); }}
                          className="w-5 h-5 flex items-center justify-center rounded text-foreground-400 hover:text-red-500 cursor-pointer"
                          title="删除"
                        >
                          <i className="ri-delete-bin-line text-xs"></i>
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Sessions under course */}
                {list.map((s) => (
                  <button
                    key={s.sid}
                    draggable
                    onDragStart={(e) => handleDragStart(e, s.sid)}
                    onClick={() => onSelectSession(s.sid)}
                    className={`w-full text-left pl-10 pr-4 py-1.5 text-xs transition-colors cursor-grab active:cursor-grabbing ${
                      activeSessionId === s.sid
                        ? 'bg-accent-100 text-accent-800 font-medium'
                        : 'text-foreground-600 hover:bg-background-100'
                    }`}
                  >
                    {s.title}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      {glossaryCourse && (
        <GlossaryModal
          isOpen={!!glossaryCourse}
          onClose={() => setGlossaryCourse(null)}
          course={glossaryCourse}
          onSave={(patch) => onUpdateCourse(glossaryCourse.id, patch)}
        />
      )}
    </>
  );
}