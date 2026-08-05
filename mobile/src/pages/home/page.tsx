import { useState, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Tabs from '@/components/base/Tabs';
import TagFilter from '@/pages/home/components/TagFilter';
import TranscriptionTab from '@/pages/home/components/TranscriptionTab';
import SummaryTab from '@/pages/home/components/SummaryTab';
import HistoryTab from '@/pages/home/components/HistoryTab';
import StudyTab from '@/pages/home/components/StudyTab';
import SharePanel from '@/pages/home/components/SharePanel';
import EditHistoryPanel from '@/pages/home/components/EditHistoryPanel';
import SearchPanel from '@/pages/home/components/SearchPanel';
import CorrectionBanner from '@/pages/home/components/CorrectionBanner';
import { type AudioPlayerHandle } from '@/pages/home/components/AudioPlayer';
import { courseData, sessions as mockSessions } from '@/mocks/courseData';
import {
  useSessions,
  useCourses,
  useSessionDetail,
  type CorrectionRule,
  type Course,
} from '@/hooks/useRecords';
import { exportTranscriptionAsPdf } from '@/lib/exportPdf';

export type RecordingStatus = 'idle' | 'recording' | 'paused';

const tabs = [
  { id: 'transcription', label: '实时转写', icon: 'ri-mic-line' },
  { id: 'summary', label: '摘要预览', icon: 'ri-magic-line' },
  { id: 'history', label: '历史重点内容', icon: 'ri-history-line' },
  { id: 'study', label: '复习', icon: 'ri-lightbulb-line' },
];

export default function HomePage() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('transcription');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [activeSessionId, setActiveSessionId] = useState(mockSessions[0]?.id || '');
  const [showSharePanel, setShowSharePanel] = useState(false);
  const [showEditHistory, setShowEditHistory] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [summary, setSummary] = useState(mockSessions[0]?.summary || '');
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);

  // Correction banner state (Feature 6)
  const [correctionBanner, setCorrectionBanner] = useState<{ from: string; to: string; courseId?: string } | null>(null);

  // API hooks
  const { sessions: apiSessions, loading: sessionsLoading, error: sessionsError } = useSessions();
  const { courses: apiCourses, create: createCourse, update: updateCourse, remove: removeCourse } = useCourses();
  const { detail: sessionDetail } = useSessionDetail(activeSessionId);

  const audioRef = useRef<AudioPlayerHandle>(null);

  const activeSession = useMemo(
    () => mockSessions.find((s) => s.id === activeSessionId) ?? mockSessions[0],
    [activeSessionId]
  );

  // Real transcription lines from API or parsed
  const transcriptionLines = useMemo(() => {
    if (sessionDetail?.transcription && sessionDetail.transcription.length > 0) {
      return sessionDetail.transcription;
    }
    return undefined;
  }, [sessionDetail]);

  const handleSelectSession = useCallback(
    (sessionId: string) => {
      setActiveSessionId(sessionId);
      const session = mockSessions.find((s) => s.id === sessionId);
      if (session) {
        setSummary(session.summary || '');
      }
      setActiveTab('transcription');
    },
    []
  );

  const handleGenerateSummary = useCallback(() => {
    setIsGenerating(true);
    setTimeout(() => {
      setSummary(activeSession.summary || '');
      setIsGenerating(false);
      setActiveTab('summary');
    }, 2000);
  }, [activeSession]);

  const handleExportPDF = useCallback(() => {
    if (transcriptionLines) {
      exportTranscriptionAsPdf(
        sessionDetail?.title || activeSession.title,
        transcriptionLines.map((l) => ({ ts: l.ts, speaker: l.speaker, text: l.text })),
        summary
      );
    } else {
      alert('PDF 导出功能即将上线，敬请期待！');
    }
  }, [transcriptionLines, sessionDetail, activeSession, summary]);

  const handleTimeSeek = useCallback((time: number) => {
    if (audioRef.current) {
      audioRef.current.seekTo(time);
    }
  }, []);

  // Search result navigation
  const handleSearchNavigate = useCallback((sid: string, start: number, _lineId: number) => {
    setActiveSessionId(sid);
    setActiveTab('transcription');
    // Seek after a short delay for DOM to render
    setTimeout(() => {
      if (audioRef.current) {
        audioRef.current.seekTo(start);
      }
    }, 300);
  }, []);

  // Course management
  const handleCreateCourse = useCallback(async (name: string): Promise<Course | null> => {
    if (createCourse) return createCourse(name);
    return null;
  }, [createCourse]);

  const handleRenameCourse = useCallback((id: string, name: string) => {
    updateCourse(id, { name });
  }, [updateCourse]);

  const handleDeleteCourse = useCallback((id: string) => {
    removeCourse(id);
  }, [removeCourse]);

  const handleUpdateCourse = useCallback((id: string, patch: { hotwords?: string; corrections?: CorrectionRule[] }) => {
    updateCourse(id, patch);
  }, [updateCourse]);

  const handleMoveSession = useCallback(async (sid: string, courseId: string) => {
    const { assignSessionToCourse } = await import('@/hooks/useRecords');
    try {
      await assignSessionToCourse(sid, courseId || null);
    } catch {
      // silently fail, user can retry
    }
  }, []);

  // Correction (Feature 6)
  const handleConfirmCorrection = useCallback((courseId?: string) => {
    if (correctionBanner && courseId) {
      const course = apiCourses.find((c) => c.id === courseId);
      if (course) {
        const newCorrections = [
          ...(course.corrections || []),
          { from: correctionBanner.from, to: correctionBanner.to, enabled: true },
        ];
        updateCourse(courseId, { corrections: newCorrections });
      }
    }
    setCorrectionBanner(null);
  }, [correctionBanner, apiCourses, updateCourse]);

  const isHistory = !!activeSessionId && activeSessionId !== '';

  return (
    <div className="min-h-screen bg-background-100">
      <nav className="sticky top-0 z-30 bg-background-50/95 backdrop-blur-sm border-b border-background-200">
        <div className="flex items-center justify-between h-14 px-6">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => navigate('/')}
              className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-background-100 text-foreground-500 hover:text-foreground-700 transition-colors cursor-pointer"
              title="返回控制台"
            >
              <i className="ri-arrow-left-line"></i>
            </button>
            <div className="w-8 h-8 flex items-center justify-center bg-accent-100 rounded-lg flex-shrink-0">
              <i className="ri-book-open-line text-accent-600"></i>
            </div>
            <h1 className="text-sm font-semibold text-foreground-900 truncate">
              {courseData.title}
            </h1>
            <span className="hidden sm:inline text-xs text-foreground-400 flex-shrink-0">
              {courseData.teacher} · {courseData.semester}
            </span>
          </div>

          <div className="flex items-center gap-3">
            <SearchPanel onNavigateResult={handleSearchNavigate} />

            <TagFilter selectedTags={selectedTags} onTagsChange={setSelectedTags} />

            <button
              onClick={() => setShowEditHistory(true)}
              className="w-9 h-9 flex items-center justify-center rounded-lg bg-background-100 text-foreground-500 hover:text-foreground-700 hover:bg-background-200 transition-colors cursor-pointer"
              title="编辑历史"
            >
              <i className="ri-history-line"></i>
            </button>

            <button
              onClick={() => setShowSharePanel(true)}
              className="w-9 h-9 flex items-center justify-center rounded-lg bg-background-100 text-foreground-500 hover:text-foreground-700 hover:bg-background-200 transition-colors cursor-pointer"
              title="共享设置"
            >
              <i className="ri-share-line"></i>
            </button>
          </div>
        </div>
      </nav>

      <div className="max-w-5xl mx-auto px-6 py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-base font-semibold text-foreground-900">
              {sessionDetail?.title || activeSession.title}
            </h2>
            <p className="text-xs text-foreground-400 mt-0.5">
              {sessionDetail?.date || activeSession.date} · {sessionDetail?.duration || activeSession.duration}
            </p>
          </div>
          <Tabs tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />
        </div>

        {activeTab === 'transcription' && (
          <TranscriptionTab
            transcription={activeSession.transcription || ''}
            lines={transcriptionLines}
            sessionTitle={sessionDetail?.title || activeSession.title}
            sessionId={activeSessionId}
            isHistory={isHistory}
            onGenerateSummary={handleGenerateSummary}
            isGenerating={isGenerating}
            onTimeSeek={handleTimeSeek}
          />
        )}

        {activeTab === 'summary' && (
          <SummaryTab
            summary={summary}
            keyPoints={sessionDetail?.key_points || activeSession.keyPoints}
            sessionTitle={sessionDetail?.title || activeSession.title}
            onExportPDF={handleExportPDF}
          />
        )}

        {activeTab === 'history' && (
          <HistoryTab
            selectedTags={selectedTags}
            onSelectSession={handleSelectSession}
            activeSessionId={activeSessionId}
            apiSessions={apiSessions}
            apiCourses={apiCourses}
            apiLoading={sessionsLoading}
            apiError={sessionsError}
            selectedCourseId={selectedCourseId}
            onSelectCourse={setSelectedCourseId}
            onCreateCourse={handleCreateCourse}
            onRenameCourse={handleRenameCourse}
            onDeleteCourse={handleDeleteCourse}
            onUpdateCourse={handleUpdateCourse}
            onMoveSession={handleMoveSession}
          />
        )}

        {activeTab === 'study' && (
          <StudyTab
            sessionId={activeSessionId}
            onTimeSeek={handleTimeSeek}
          />
        )}
      </div>

      <SharePanel isOpen={showSharePanel} onClose={() => setShowSharePanel(false)} />

      <EditHistoryPanel
        sessionId={activeSessionId}
        isOpen={showEditHistory}
        onClose={() => setShowEditHistory(false)}
      />

      {correctionBanner && (
        <CorrectionBanner
          from={correctionBanner.from}
          to={correctionBanner.to}
          onConfirm={() => handleConfirmCorrection(correctionBanner.courseId)}
          onDismiss={() => setCorrectionBanner(null)}
        />
      )}
    </div>
  );
}