import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { dashboardStats, quickActions } from '@/mocks/dashboardData';
import { sessions } from '@/mocks/courseData';
import { useTagsStore } from '@/hooks/useTagsStore';
import AnimatedNumber from '@/components/feature/AnimatedNumber';
import Calendar from '@/components/feature/Calendar';
import NewSessionModal from '@/pages/dashboard/components/NewSessionModal';
import ImportModal from '@/pages/dashboard/components/ImportModal';
import SearchBar from '@/pages/dashboard/components/SearchBar';
import CourseTypeModal from '@/pages/dashboard/components/CourseTypeModal';
import SummaryListModal from '@/pages/dashboard/components/SummaryListModal';
import { useAuth } from '@/hooks/useAuth';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';

interface CreatedSession {
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

export default function DashboardHome() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { tags } = useTagsStore();
  const [showNewSession, setShowNewSession] = useState(false);
  const [preselectedDate, setPreselectedDate] = useState('');
  const [createdSessions, setCreatedSessions] = useState<CreatedSession[]>([]);
  const [createdMessage, setCreatedMessage] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [importDate, setImportDate] = useState('');
  const [showCourseTypes, setShowCourseTypes] = useState(false);
  const [showSummaryList, setShowSummaryList] = useState(false);

  const tagLabels = useMemo(() => {
    const map: Record<string, string> = {};
    tags.forEach((t) => { map[t.id] = t.label; });
    return map;
  }, [tags]);

  const tagColorMap = useMemo(() => {
    const map: Record<string, string> = {};
    tags.forEach((t) => { map[t.id] = t.color; });
    return map;
  }, [tags]);

  const allSessions = useMemo(() => {
    const refs = sessions.map((s) => ({
      id: s.id,
      title: s.title,
      date: s.date,
      time: s.time,
      duration: s.duration,
      tags: s.tags,
      description: s.description,
      summary: s.summary ?? s.description,
      keyPoints: s.keyPoints ?? [],
    }));
    return [...refs, ...createdSessions];
  }, [createdSessions]);

  const stats = [
    { label: '课程总数', value: dashboardStats.totalCourses + createdSessions.length, suffix: ' 门', icon: 'ri-book-open-line', color: 'accent' },
    { label: '录音时长', value: dashboardStats.totalRecordingMinutes, suffix: ' 分钟', icon: 'ri-mic-line', color: 'primary' },
    { label: 'AI摘要', value: dashboardStats.totalSummaries, suffix: ' 份', icon: 'ri-magic-line', color: 'accent' },
    { label: '标签数量', value: tags.length, suffix: ' 个', icon: 'ri-price-tag-3-line', color: 'secondary' },
  ];

  const colorConfig = {
    accent: { bg: 'bg-accent-100', icon: 'text-accent-600', bar: 'bg-accent-500', glow: 'from-accent-400/20' },
    primary: { bg: 'bg-primary-100', icon: 'text-primary-600', bar: 'bg-primary-500', glow: 'from-primary-400/20' },
    secondary: { bg: 'bg-secondary-100', icon: 'text-secondary-600', bar: 'bg-secondary-500', glow: 'from-secondary-400/20' },
  };

  const handleSelectSession = (id: string) => {
    navigate('/course');
  };

  const handleCreateSession = (date: string) => {
    setPreselectedDate(date);
    setShowNewSession(true);
  };

  const handleOpenImport = () => {
    setImportDate('');
    setShowImport(true);
  };

  const handleConfirmCreate = (data: { title: string; date: string; time: string; duration: string; tags: string[]; description: string }) => {
    const newSession: CreatedSession = {
      id: `created-${Date.now()}`,
      ...data,
      summary: data.description,
      keyPoints: [],
    };
    setCreatedSessions((prev) => [newSession, ...prev]);
    setCreatedMessage(`「${data.title}」已创建！`);
    setTimeout(() => setCreatedMessage(''), 3000);
  };

  return (
    <div className="min-h-screen bg-background-100">
      {/* Created toast */}
      {createdMessage && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 px-5 py-3 bg-accent-500 text-background-50 rounded-xl text-sm font-semibold shadow-lg animate-bounce">
          <i className="ri-check-line mr-2"></i>
          {createdMessage}
        </div>
      )}

      {/* Hero Header */}
      <div className="relative z-20 bg-background-50 border-b border-background-200">
        <div className="absolute inset-0 bg-gradient-to-br from-accent-50/60 via-transparent to-primary-50/40"></div>
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-accent-100/30 rounded-full blur-3xl -translate-y-1/2 translate-x-1/4"></div>
        <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-primary-50/40 rounded-full blur-3xl translate-y-1/2 -translate-x-1/4"></div>
        <div className="relative z-10 max-w-6xl mx-auto px-6 py-10 md:py-14">
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6">
            <div>
              <div className="flex items-center gap-2 mb-3">
                <span className="px-3 py-1 bg-accent-100 text-accent-700 text-xs font-semibold rounded-full">
                  2026年秋季学期
                </span>
              </div>
              <h1 className="text-3xl md:text-4xl font-bold text-foreground-900 mb-2">
                课堂纪要控制台
              </h1>
              <p className="text-sm text-foreground-400 max-w-lg mb-4">
                智能管理你的课堂录音、AI摘要与学习资料。实时转写、一键总结、师生共享——让知识管理更高效。
              </p>
              <SearchBar sessions={allSessions} tagLabels={tagLabels} />
            </div>
            <button
              onClick={() => navigate('/course')}
              className="flex items-center gap-2 px-6 py-3 bg-accent-500 text-background-50 rounded-xl text-sm font-semibold hover:bg-accent-600 transition-all cursor-pointer whitespace-nowrap self-start md:self-auto"
            >
              <i className="ri-mic-line text-lg"></i>
              开始新课录制
            </button>
            <div className="flex items-center gap-3 self-start md:self-auto">
              <div className="flex items-center gap-2 px-3 py-2 bg-background-100 rounded-lg">
                <div className="w-7 h-7 flex items-center justify-center bg-accent-100 rounded-full">
                  <i className={`${user?.role === 'teacher' ? 'ri-user-star-line' : 'ri-user-line'} text-accent-600 text-xs`}></i>
                </div>
                <div className="text-left">
                  <p className="text-xs font-medium text-foreground-800">{user?.name || '用户'}</p>
                  <p className="text-xs text-foreground-400">{user?.role === 'teacher' ? '教师' : '学生'}</p>
                </div>
              </div>
              <button
                onClick={() => { logout(); navigate('/'); }}
                className="w-9 h-9 flex items-center justify-center rounded-lg bg-background-100 text-foreground-400 hover:text-foreground-600 hover:bg-background-200 transition-colors cursor-pointer"
                title="退出登录"
              >
                <i className="ri-logout-box-line"></i>
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-8 space-y-8">
        {/* Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {stats.map((stat, sIdx) => {
            const c = colorConfig[stat.color as keyof typeof colorConfig];
            const isCoursesCard = sIdx === 0;
            const isSummaryCard = sIdx === 2;
            const isTagsCard = sIdx === 3;
            const isClickable = isCoursesCard || isSummaryCard || isTagsCard;
            return (
              <div
                key={stat.label}
                onClick={
                  isCoursesCard ? () => setShowCourseTypes(true)
                  : isSummaryCard ? () => setShowSummaryList(true)
                  : isTagsCard ? () => navigate('/tags')
                  : undefined
                }
                className={`relative overflow-hidden bg-background-50 rounded-2xl p-5 border border-background-200 transition-all duration-300 ${
                  isClickable ? 'cursor-pointer hover:border-accent-400 hover:bg-accent-50/30 group' : 'cursor-default group'
                }`}
              >
                <div className={`absolute top-0 right-0 w-20 h-20 bg-gradient-to-bl ${c.glow} to-transparent rounded-full blur-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500`}></div>
                <div className="relative z-10">
                  <div className={`w-10 h-10 flex items-center justify-center ${c.bg} rounded-xl mb-3`}>
                    <i className={`${stat.icon} ${c.icon} text-lg`}></i>
                  </div>
                  <p className="text-xs font-medium text-foreground-400 mb-1 flex items-center gap-1">
                    {stat.label}
                    {isClickable && (
                      <span className="opacity-0 group-hover:opacity-100 transition-opacity">
                        <div className="w-3.5 h-3.5 flex items-center justify-center">
                          <i className="ri-arrow-right-up-line text-accent-400 text-xs"></i>
                        </div>
                      </span>
                    )}
                  </p>
                  <p className="text-2xl font-bold text-foreground-900">
                    <AnimatedNumber value={stat.value} suffix={stat.suffix} />
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Calendar */}
        <Calendar
          sessions={allSessions}
          tagLabels={tagLabels}
          tagColorMap={tagColorMap}
          onSelectSession={handleSelectSession}
          onCreateSession={handleCreateSession}
          onImport={handleOpenImport}
        />

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: Quick Actions + Recent Sessions */}
          <div className="lg:col-span-2 space-y-6">
            {/* Quick Actions */}
            <div>
              <h3 className="text-sm font-semibold text-foreground-800 mb-3 flex items-center gap-2">
                <div className="w-5 h-5 flex items-center justify-center">
                  <i className="ri-flashlight-line text-accent-500"></i>
                </div>
                快捷通道
              </h3>
              <div className="grid grid-cols-3 gap-3">
                {quickActions.map((action) => {
                  const c = colorConfig[action.color as keyof typeof colorConfig];
                  return (
                    <button
                      key={action.id}
                      onClick={() => navigate(action.link)}
                      className="group relative bg-background-50 rounded-xl p-4 border border-background-200 hover:border-accent-200 transition-all duration-300 text-left cursor-pointer overflow-hidden"
                    >
                      <div className={`absolute inset-0 bg-gradient-to-br ${c.glow} to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500`}></div>
                      <div className="relative z-10">
                        <div className={`w-9 h-9 flex items-center justify-center ${c.bg} rounded-lg mb-2.5 group-hover:scale-110 transition-transform duration-300`}>
                          <i className={`${action.icon} ${c.icon} text-base`}></i>
                        </div>
                        <p className="text-sm font-semibold text-foreground-800 mb-0.5">{action.label}</p>
                        <p className="text-xs text-foreground-400">{action.description}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Recent Sessions */}
            <div>
              <h3 className="text-sm font-semibold text-foreground-800 mb-3 flex items-center gap-2">
                <div className="w-5 h-5 flex items-center justify-center">
                  <i className="ri-time-line text-primary-500"></i>
                </div>
                最近课时
              </h3>
              <div className="bg-background-50 rounded-2xl border border-background-200 overflow-hidden">
                {dashboardStats.recentSessions.map((session, idx) => (
                  <button
                    key={session.id}
                    onClick={() => navigate('/course')}
                    className={`w-full text-left px-5 py-4 flex items-center gap-4 hover:bg-background-100 transition-colors cursor-pointer ${
                      idx < dashboardStats.recentSessions.length - 1 ? 'border-b border-background-100' : ''
                    }`}
                  >
                    <div className="w-10 h-10 flex items-center justify-center bg-accent-100 rounded-xl flex-shrink-0">
                      <i className="ri-file-text-line text-accent-600"></i>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground-800 truncate">{session.title}</p>
                      <div className="flex items-center gap-3 mt-1 text-xs text-foreground-400">
                        <span className="flex items-center gap-1">
                          <i className="ri-calendar-line"></i>
                          {session.date}
                        </span>
                        <span className="flex items-center gap-1">
                          <i className="ri-time-line"></i>
                          {session.duration}
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1 flex-shrink-0">
                      {session.tags.map((tag) => (
                        <span key={tag} className="px-2 py-0.5 bg-secondary-100 text-secondary-700 rounded-full text-xs font-medium whitespace-nowrap">
                          {tag}
                        </span>
                      ))}
                    </div>
                    <div className="w-6 h-6 flex items-center justify-center flex-shrink-0">
                      <i className="ri-arrow-right-s-line text-foreground-300"></i>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Right: Charts */}
          <div className="space-y-6">
            {/* Weekly Activity Chart */}
            <div className="bg-background-50 rounded-2xl border border-background-200 p-5">
              <h3 className="text-sm font-semibold text-foreground-800 mb-4 flex items-center gap-2">
                <div className="w-5 h-5 flex items-center justify-center">
                  <i className="ri-bar-chart-line text-accent-500"></i>
                </div>
                本周活跃度
              </h3>
              <div className="h-[200px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dashboardStats.weeklyActivity} barGap={2}>
                    <CartesianGrid strokeDasharray="3 3" stroke="oklch(var(--background-200) / 1)" />
                    <XAxis
                      dataKey="day"
                      tick={{ fontSize: 11, fill: 'oklch(var(--foreground-400) / 1)' }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: 'oklch(var(--foreground-400) / 1)' }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'oklch(var(--background-50) / 0.95)',
                        border: '1px solid oklch(var(--background-200) / 1)',
                        borderRadius: '12px',
                        fontSize: '12px',
                      }}
                    />
                    <Legend
                      wrapperStyle={{ fontSize: '11px' }}
                    />
                    <Bar dataKey="recordings" name="录音" fill="oklch(var(--accent-500) / 0.7)" radius={[6, 6, 0, 0]} />
                    <Bar dataKey="summaries" name="摘要" fill="oklch(var(--primary-500) / 0.7)" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Tag Distribution */}
            <div className="bg-background-50 rounded-2xl border border-background-200 p-5">
              <h3 className="text-sm font-semibold text-foreground-800 mb-4 flex items-center gap-2">
                <div className="w-5 h-5 flex items-center justify-center">
                  <i className="ri-pie-chart-line text-primary-500"></i>
                </div>
                章节分布
              </h3>
              <div className="space-y-2.5">
                {dashboardStats.tagDistribution.map((item) => {
                  const maxCount = Math.max(...dashboardStats.tagDistribution.map((t) => t.count));
                  const width = (item.count / maxCount) * 100;
                  const barColor = item.color === 'primary'
                    ? 'bg-primary-500'
                    : item.color === 'secondary'
                      ? 'bg-secondary-500'
                      : 'bg-accent-500';
                  return (
                    <div key={item.tag} className="flex items-center gap-3">
                      <span className="text-xs text-foreground-600 w-14 flex-shrink-0">{item.tag}</span>
                      <div className="flex-1 h-5 bg-background-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full ${barColor} rounded-full transition-all duration-700`}
                          style={{ width: `${width}%` }}
                        ></div>
                      </div>
                      <span className="text-xs font-medium text-foreground-500 w-6 text-right">{item.count}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>

      <NewSessionModal
        isOpen={showNewSession}
        onClose={() => setShowNewSession(false)}
        preselectedDate={preselectedDate}
        dateLocked={!!preselectedDate}
        onConfirm={handleConfirmCreate}
      />

      <ImportModal
        isOpen={showImport}
        onClose={() => setShowImport(false)}
        onConfirm={handleConfirmCreate}
      />

      <CourseTypeModal
        isOpen={showCourseTypes}
        onClose={() => setShowCourseTypes(false)}
        sessions={allSessions}
        tags={tags}
      />

      <SummaryListModal
        isOpen={showSummaryList}
        onClose={() => setShowSummaryList(false)}
        sessions={allSessions}
        tagLabels={tagLabels}
      />
    </div>
  );
}