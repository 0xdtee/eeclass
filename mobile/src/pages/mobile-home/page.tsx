import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { apiFetch, getServerUrl } from '@/lib/api';
import { useSessions } from '@/hooks/useRecords';
import { useTagsStore } from '@/hooks/useTagsStore';
import AnimatedNumber from '@/components/feature/AnimatedNumber';
import CourseTypeModal from '@/pages/dashboard/components/CourseTypeModal';
import SummaryListModal from '@/pages/dashboard/components/SummaryListModal';
import AudioListModal from '@/pages/dashboard/components/AudioListModal';

interface SessionMeta {
  sid: string;
  title: string;
  date: string;
  duration: string;
  has_summary: boolean;
}

interface HomeStats {
  totalCourses: number;
  totalMinutes: number;
  totalSummaries: number;
  totalTags: number;
}

const defaultTags = [
  '大学物理', '大学物理实验', '大学计算机基础', '大学英语',
  '马克思主义基本原理', '毛泽东思想和中国特色社会主义理论体系概论',
  '习近平新时代中国特色社会主义思想概论', '思想道德与法治',
  '中国近现代史纲要', '军事理论', '大学生心理健康教育',
];

export default function MobileHomePage() {
  const navigate = useNavigate();
  const { user, isAuthenticated, isOffline } = useAuth();
  const [stats, setStats] = useState<HomeStats | null>(null);
  const [recentSessions, setRecentSessions] = useState<SessionMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  // List modal (same as web: click a stat card to pop up the list)
  const [showCourseTypes, setShowCourseTypes] = useState(false);
  const [showAudioList, setShowAudioList] = useState(false);
  const [showSummaryList, setShowSummaryList] = useState(false);

  const tagCount = useMemo(() => defaultTags.length, []);

  // Real data: all sessions + tags
  const { sessions } = useSessions();
  const { tags } = useTagsStore();

  const tagLabels = useMemo(() => {
    const map: Record<string, string> = {};
    tags.forEach((t) => { map[t.id] = t.label; });
    return map;
  }, [tags]);

  // Backend SessionRecord → unified shape the modal needs (aligned with web's SessionItem)
  const modalSessions = useMemo(
    () =>
      sessions.map((s) => ({
        id: s.sid,
        title: s.title,
        date: s.date,
        time: '',
        duration: s.duration,
        tags: s.tags || [],
        summary: s.summary || '',
        keyPoints: s.key_points || [],
      })),
    [sessions]
  );

  // Only show sessions that have a summary (matches the "AI摘要" card count)
  const summarySessions = useMemo(
    () => modalSessions.filter((s) => s.summary && s.summary.trim().length > 0),
    [modalSessions]
  );

  // "课程总数" groups by base name after stripping the number: 高数第1课/第2课… all count as one "高数"
  const distinctCourses = useMemo(() => {
    const baseName = (t: string) =>
      (t || '').replace(/\s*第\s*\d+\s*[课讲节]\s*$/, '').replace(/\s*[（(]\s*\d+\s*[）)]\s*$/, '').trim();
    const map = new Map<string, { name: string; recordings: number; schedule: number }>();
    modalSessions.forEach((s) => {
      const n = baseName(s.title);
      if (!n) return;
      const e = map.get(n) || { name: n, recordings: 0, schedule: 0 };
      e.recordings += 1;
      map.set(n, e);
    });
    return Array.from(map.values()).sort(
      (a, b) => (b.recordings + b.schedule) - (a.recordings + a.schedule)
    );
  }, [modalSessions]);

  useEffect(() => {
    if (!isAuthenticated) return;

    if (isOffline) {
      import('@/mocks/dashboardData').then((mod) => {
        const d = mod.dashboardStats;
        setStats({
          totalCourses: d.totalCourses,
          totalMinutes: d.totalRecordingMinutes,
          totalSummaries: d.totalSummaries,
          totalTags: tagCount,
        });
        setRecentSessions(
          d.recentSessions.map((s) => ({
            sid: s.id,
            title: s.title,
            date: s.date,
            duration: s.duration,
            has_summary: true,
          }))
        );
        setLoading(false);
      });
      return;
    }

    setLoading(true);
    setError('');
    apiFetch<{ sessions: Record<string, unknown>[] }>('/api/sessions')
      .then((data) => {
        const raw = data.sessions || [];
        const fmtDur = (sec?: number) => {
          const s = Math.floor(Number(sec) || 0);
          if (s < 60) return `${s}秒`;
          const m = Math.floor(s / 60);
          return s % 60 ? `${m}分${s % 60}秒` : `${m}分钟`;
        };
        // Backend returns { id, title, duration_s, summary? }; field names differ from this page's type, so adapt
        const sessions: SessionMeta[] = raw.map((s) => {
          const id = String((s.id ?? s.sid) ?? '');
          const title = typeof s.title === 'string' && s.title.trim() ? (s.title as string) : id;
          return {
            sid: id,
            title,
            date: id.slice(0, 10),
            duration: fmtDur(s.duration_s as number),
            has_summary: !!(s.summary || s.has_summary),
          };
        });
        setRecentSessions(sessions.slice(0, 5));
        const totalMinutes = raw.reduce((sum, s) => sum + (Number(s.duration_s) || 0) / 60, 0);
        setStats({
          totalCourses: sessions.length,
          totalMinutes: Math.round(totalMinutes),
          totalSummaries: sessions.filter((s) => s.has_summary).length,
          totalTags: tagCount,
        });
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : '加载失败');
      })
      .finally(() => setLoading(false));
  }, [isAuthenticated, isOffline, tagCount]);

  const handleSearch = () => {
    if (searchQuery.trim()) {
      navigate(`/search?q=${encodeURIComponent(searchQuery.trim())}`);
    }
  };

  const quickActions = [
    { icon: 'ri-mic-line', label: '开始录音', bg: 'bg-accent-500', iconColor: 'text-background-50', path: '/record' },
    { icon: 'ri-history-line', label: '历史记录', bg: 'bg-background-100', iconColor: 'text-accent-600', path: '/courses' },
    { icon: 'ri-magic-line', label: 'AI摘要', bg: 'bg-background-100', iconColor: 'text-primary-600', path: '/courses' },
    { icon: 'ri-book-open-line', label: '参考资料', bg: 'bg-background-100', iconColor: 'text-secondary-600', path: '/syllabus' },
  ];

  return (
    <div className="min-h-full bg-background-50">
      {/* Header */}
      <div className="px-5 md:px-8 pt-6 md:pt-8 pb-4 md:pb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-xs text-foreground-400">2026 年秋季学期</p>
            <h1 className="text-lg md:text-2xl font-bold text-foreground-900">课堂纪要</h1>
          </div>
          <div className="flex items-center gap-2 md:hidden">
            {user && (
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-background-100 rounded-lg">
                <div className="w-6 h-6 flex items-center justify-center bg-accent-100 rounded-full">
                  <i className={`${user.role === 'teacher' ? 'ri-user-star-line' : 'ri-user-line'} text-accent-600 text-xs`}></i>
                </div>
                <span className="text-xs font-medium text-foreground-700">{user.name}</span>
              </div>
            )}
          </div>
        </div>

        {/* Offline badge */}
        {isOffline && (
          <div className="flex items-center gap-2 px-2.5 py-1.5 bg-amber-50 border border-amber-200 rounded-lg mb-3 md:mb-4">
            <i className="ri-wifi-off-line text-amber-600 text-xs"></i>
            <span className="text-[10px] text-amber-700 font-medium">离线体验模式</span>
          </div>
        )}

        {/* Search */}
        <div className="relative max-w-5xl">
          <div className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center">
            <i className="ri-search-line text-foreground-400"></i>
          </div>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="搜索课堂内容…"
            className="w-full pl-10 pr-10 py-2.5 md:py-3 bg-background-100 border border-background-200 rounded-xl text-sm md:text-base text-foreground-800 placeholder:text-foreground-300 focus:outline-none focus:border-accent-400 focus:ring-2 focus:ring-accent-100 transition-all"
          />
          {searchQuery && (
            <button
              onClick={handleSearch}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 md:w-8 md:h-8 flex items-center justify-center rounded-lg bg-accent-500 text-background-50 cursor-pointer"
            >
              <i className="ri-arrow-right-line text-sm"></i>
            </button>
          )}
        </div>
      </div>

      {/* Stats Grid */}
      <div className="px-5 md:px-8 mb-4 md:mb-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
          <div onClick={() => setShowCourseTypes(true)} className="bg-background-50 rounded-xl p-4 md:p-5 border border-background-200 hover:border-accent-200 transition-colors cursor-pointer active:scale-[0.98]">
            <div className="w-9 h-9 md:w-10 md:h-10 flex items-center justify-center bg-accent-100 rounded-xl mb-2 md:mb-3">
              <i className="ri-book-open-line text-accent-600 text-base md:text-lg"></i>
            </div>
            <p className="text-xs text-foreground-400 mb-0.5">课程总数</p>
            <p className="text-xl md:text-2xl font-bold text-foreground-900">
              {stats ? <AnimatedNumber value={stats.totalCourses} suffix="" /> : '-'}
            </p>
          </div>
          <div onClick={() => setShowAudioList(true)} className="bg-background-50 rounded-xl p-4 md:p-5 border border-background-200 hover:border-primary-200 transition-colors cursor-pointer active:scale-[0.98]">
            <div className="w-9 h-9 md:w-10 md:h-10 flex items-center justify-center bg-primary-100 rounded-xl mb-2 md:mb-3">
              <i className="ri-mic-line text-primary-600 text-base md:text-lg"></i>
            </div>
            <p className="text-xs text-foreground-400 mb-0.5">录音时长</p>
            <p className="text-xl md:text-2xl font-bold text-foreground-900">
              {stats ? <AnimatedNumber value={stats.totalMinutes} suffix="" /> : '-'}
              <span className="text-xs font-normal text-foreground-400 ml-0.5">分钟</span>
            </p>
          </div>
          <div onClick={() => setShowSummaryList(true)} className="bg-background-50 rounded-xl p-4 md:p-5 border border-background-200 hover:border-accent-200 transition-colors cursor-pointer active:scale-[0.98]">
            <div className="w-9 h-9 md:w-10 md:h-10 flex items-center justify-center bg-accent-100 rounded-xl mb-2 md:mb-3">
              <i className="ri-magic-line text-accent-600 text-base md:text-lg"></i>
            </div>
            <p className="text-xs text-foreground-400 mb-0.5">AI摘要</p>
            <p className="text-xl md:text-2xl font-bold text-foreground-900">
              {stats ? <AnimatedNumber value={stats.totalSummaries} suffix="" /> : '-'}
              <span className="text-xs font-normal text-foreground-400 ml-0.5">份</span>
            </p>
          </div>
          <div onClick={() => navigate('/tags')} className="bg-background-50 rounded-xl p-4 md:p-5 border border-background-200 hover:border-secondary-200 transition-colors cursor-pointer active:scale-[0.98]">
            <div className="w-9 h-9 md:w-10 md:h-10 flex items-center justify-center bg-secondary-100 rounded-xl mb-2 md:mb-3">
              <i className="ri-price-tag-3-line text-secondary-600 text-base md:text-lg"></i>
            </div>
            <p className="text-xs text-foreground-400 mb-0.5">标签数量</p>
            <p className="text-xl md:text-2xl font-bold text-foreground-900">
              {stats ? <AnimatedNumber value={stats.totalTags} suffix="" /> : '-'}
              <span className="text-xs font-normal text-foreground-400 ml-0.5">个</span>
            </p>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="px-5 md:px-8 mb-4 md:mb-6">
        <h2 className="text-sm md:text-base font-semibold text-foreground-800 mb-3 md:mb-4">快捷入口</h2>
        <div className="grid grid-cols-4 md:grid-cols-4 gap-3 md:gap-4 md:max-w-2xl">
          {quickActions.map((action) => (
            <button
              key={action.label}
              onClick={() => {
                if (!isAuthenticated && action.path !== '/record') {
                  navigate('/login');
                  return;
                }
                navigate(action.path);
              }}
              className="flex flex-col items-center gap-1.5 md:gap-2 cursor-pointer group"
            >
              <div className={`w-12 h-12 md:w-14 md:h-14 flex items-center justify-center rounded-xl md:rounded-2xl ${action.bg} transition-transform group-hover:scale-105`}>
                <div className="w-5 h-5 md:w-6 md:h-6 flex items-center justify-center">
                  <i className={`${action.icon} ${action.iconColor} text-lg md:text-xl`}></i>
                </div>
              </div>
              <span className="text-[11px] md:text-xs text-foreground-600 font-medium">{action.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Recent Sessions */}
      <div className="px-5 md:px-8 pb-6 md:pb-8">
        <div className="flex items-center justify-between mb-3 md:mb-4">
          <h2 className="text-sm md:text-base font-semibold text-foreground-800">最近课时</h2>
          <button
            onClick={() => navigate('/courses')}
            className="text-xs md:text-sm text-accent-600 font-medium cursor-pointer flex items-center gap-0.5 hover:text-accent-700"
          >
            全部
            <div className="w-3.5 h-3.5 flex items-center justify-center">
              <i className="ri-arrow-right-s-line"></i>
            </div>
          </button>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-12">
            <i className="ri-loader-4-line animate-spin text-accent-500 text-xl md:text-2xl"></i>
          </div>
        )}

        {error && (
          <div className="flex flex-col items-center py-12 text-center">
            <div className="w-10 h-10 md:w-12 md:h-12 flex items-center justify-center bg-red-50 rounded-xl mb-2">
              <i className="ri-error-warning-line text-red-400 text-lg md:text-xl"></i>
            </div>
            <p className="text-xs md:text-sm text-red-500">{error}</p>
            <p className="text-xs text-foreground-400 mt-1">请检查后端服务是否运行</p>
          </div>
        )}

        {!loading && !error && recentSessions.length === 0 && (
          <div className="flex flex-col items-center py-12 text-center">
            <div className="w-12 h-12 md:w-16 md:h-16 flex items-center justify-center bg-background-100 rounded-xl mb-3">
              <i className="ri-mic-line text-foreground-300 text-xl md:text-2xl"></i>
            </div>
            <p className="text-sm md:text-base text-foreground-400">还没有录制过课程</p>
            <button
              onClick={() => navigate('/record')}
              className="mt-3 px-4 md:px-5 py-2 md:py-2.5 bg-accent-500 text-background-50 rounded-lg text-xs md:text-sm font-medium cursor-pointer whitespace-nowrap hover:bg-accent-600 transition-colors"
            >
              开始第一节录音
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 md:gap-3">
          {recentSessions.map((session) => (
            <button
              key={session.sid}
              onClick={() => navigate(`/session/${session.sid}`)}
              className="w-full text-left bg-background-50 rounded-xl p-4 md:p-5 border border-background-200 hover:border-accent-300 hover:bg-accent-50/50 transition-all cursor-pointer group"
            >
              <div className="flex items-start gap-3 md:gap-4">
                <div className="w-9 h-9 md:w-11 md:h-11 flex items-center justify-center bg-accent-100 rounded-xl flex-shrink-0 mt-0.5 group-hover:bg-accent-200 transition-colors">
                  <i className="ri-file-text-line text-accent-600 text-base md:text-lg"></i>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm md:text-base font-medium text-foreground-800 truncate">{session.title}</p>
                  <div className="flex items-center gap-3 mt-1.5">
                    <span className="text-xs text-foreground-400 flex items-center gap-1">
                      <i className="ri-calendar-line"></i>
                      {session.date}
                    </span>
                    <span className="text-xs text-foreground-400 flex items-center gap-1">
                      <i className="ri-time-line"></i>
                      {session.duration}
                    </span>
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

      {/* Stat card modal: same as web, click a card to pop up the list */}
      <CourseTypeModal
        isOpen={showCourseTypes}
        onClose={() => setShowCourseTypes(false)}
        courses={distinctCourses}
        onSelect={(name) => { setShowCourseTypes(false); navigate('/course-detail?name=' + encodeURIComponent(name)); }}
      />

      <AudioListModal
        isOpen={showAudioList}
        onClose={() => setShowAudioList(false)}
        sessions={modalSessions}
      />

      <SummaryListModal
        isOpen={showSummaryList}
        onClose={() => setShowSummaryList(false)}
        sessions={summarySessions}
        tagLabels={tagLabels}
      />
    </div>
  );
}