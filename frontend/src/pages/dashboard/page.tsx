import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { quickActions } from '@/mocks/dashboardData';
import { useRecords, sessionTitle, fmtDuration } from '@/hooks/useRecords';
import type { ScheduleCourse, ScheduleEvent } from '@/hooks/useRecords';
import { useTagsStore } from '@/hooks/useTagsStore';
import { loadSettings } from '@/lib/settings';
import { findSimilarTag } from '@/lib/tagMatch';
import AnimatedNumber from '@/components/feature/AnimatedNumber';
import Calendar from '@/components/feature/Calendar';
import NewSessionModal from '@/pages/dashboard/components/NewSessionModal';
import ImportModal from '@/pages/dashboard/components/ImportModal';
import SyncShuModal from '@/pages/dashboard/components/SyncShuModal';
import SearchBar from '@/pages/dashboard/components/SearchBar';
import CourseTypeModal from '@/pages/dashboard/components/CourseTypeModal';
import TagCoursesModal from '@/pages/dashboard/components/TagCoursesModal';
import SummaryListModal from '@/pages/dashboard/components/SummaryListModal';
import AudioListModal from '@/pages/dashboard/components/AudioListModal';
import VoicePrintModal from '@/pages/dashboard/components/VoicePrintModal';
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
  const { tags, addTag } = useTagsStore();
  const [showNewSession, setShowNewSession] = useState(false);
  const [preselectedDate, setPreselectedDate] = useState('');
  const [createdSessions, setCreatedSessions] = useState<CreatedSession[]>([]);
  const [createdMessage, setCreatedMessage] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [showSyncShu, setShowSyncShu] = useState(false);
  const [importDate, setImportDate] = useState('');
  const [scheduleEvents, setScheduleEvents] = useState<ScheduleEvent[]>([]);   // Dated course events (deduplicated)
  const [calendarFocus, setCalendarFocus] = useState('');   // After import, make the calendar jump to the month of the courses
  const [showCourseTypes, setShowCourseTypes] = useState(false);
  const [showTagCourses, setShowTagCourses] = useState(false);
  const [showSummaryList, setShowSummaryList] = useState(false);
  const [showAudioList, setShowAudioList] = useState(false);
  const [showVoices, setShowVoices] = useState(false);

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

  // Course events store the tag label, but the calendar needs an id, so map label->id here
  const labelToId = useMemo(() => {
    const map: Record<string, string> = {};
    tags.forEach((t) => { map[t.label.trim()] = t.id; });
    return map;
  }, [tags]);

  const records = useRecords();

  // Actually-recorded sessions (from backend /api/sessions), mapped to the fields the dashboard needs
  const realSessions = useMemo(
    () =>
      records.sessions.map((s) => {
        // Split the date and time out of the sid (2026-07-30_1349_title):
        // The calendar groups by day and needs a pure YYYY-MM-DD, no time, or it won't match a cell
        const m = s.id.match(/^(\d{4}-\d{2}-\d{2})_(\d{2})(\d{2})/);
        return {
          id: s.id,
          title: sessionTitle(s),
          date: m ? m[1] : '',
          time: m ? `${m[2]}:${m[3]}` : '',
          duration: fmtDuration(s.duration_s),
          durationSec: s.duration_s,
          tags: [] as string[],
          description: `${s.lines ?? 0} 句`,
          summary: s.summary ?? '',
          keyPoints: s.key_points ?? [],
        };
      }),
    [records.sessions]
  );

  const allSessions = useMemo(
    () => [...realSessions, ...createdSessions],
    [realSessions, createdSessions]
  );

  // Read back the saved course events
  useEffect(() => {
    void records.loadSchedule().then((r) => setScheduleEvents(r.events || [])).catch(() => {});
  }, [records]);

  // Map course events onto the calendar: number sessions of the same course by time as 「第1课/第2课…」, so they're distinguishable and their recordings don't clash.
  const scheduleSessions = useMemo(() => {
    const byName = new Map<string, ScheduleEvent[]>();
    [...scheduleEvents]
      .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start))
      .forEach((e) => {
        const arr = byName.get(e.name) || [];
        arr.push(e);
        byName.set(e.name, arr);
      });
    const out: Array<{ id: string; title: string; date: string; time: string; duration: string; tags: string[]; description: string; summary: string; keyPoints: string[] }> = [];
    byName.forEach((arr, name) => {
      arr.forEach((e, i) => {
        const tagId = e.tag ? labelToId[e.tag.trim()] : undefined;
        out.push({
          id: `sched-${e.date}-${e.name}-${e.start}`,
          title: arr.length > 1 ? `${name} 第${i + 1}课` : name,   // Don't number a course that appears only once
          date: e.date, time: e.start,
          duration: '', tags: tagId ? [tagId] : [],
          description: `${e.location} ${e.room}`.trim(),
          summary: '', keyPoints: [] as string[],
        });
      });
    });
    return out;
  }, [scheduleEvents, labelToId]);

  // "Total courses" is grouped by the base name with numbering stripped: 高数第1课/第2课… all count as one 「高数」
  const distinctCourses = useMemo(() => {
    const baseName = (t: string) =>
      (t || '').replace(/\s*第\s*\d+\s*[课讲节]\s*$/, '').replace(/\s*[（(]\s*\d+\s*[）)]\s*$/, '').trim();
    const map = new Map<string, { name: string; recordings: number; schedule: number }>();
    const add = (name: string, key: 'recordings' | 'schedule') => {
      const n = baseName(name);
      if (!n) return;
      const e = map.get(n) || { name: n, recordings: 0, schedule: 0 };
      e[key] += 1;
      map.set(n, e);
    };
    allSessions.forEach((s) => add(s.title, 'recordings'));
    scheduleEvents.forEach((ev) => add(ev.name, 'schedule'));
    return Array.from(map.values()).sort(
      (a, b) => (b.recordings + b.schedule) - (a.recordings + a.schedule)
    );
  }, [allSessions, scheduleEvents]);

  // "Tag count" card: organized by tag -- aggregating both imported timetable courses and actual recordings.
  const tagGroups = useMemo(() => {
    const map = new Map<string, { courses: Set<string>; count: number }>();
    const ensure = (tag: string) => {
      let v = map.get(tag);
      if (!v) { v = { courses: new Set<string>(), count: 0 }; map.set(tag, v); }
      return v;
    };
    // Imported timetable courses (each carries its own tag; deduped by name)
    scheduleEvents.forEach((e) => {
      const t = (e.tag || '').trim();
      if (t && e.name) ensure(t).courses.add(e.name);
    });
    // Tags on actual recordings
    records.sessions.forEach((s) => {
      (s.tags || []).forEach((t) => {
        const name = (t || '').trim();
        if (name) ensure(name).count += 1;
      });
    });
    return Array.from(map.entries())
      .map(([tag, v]) => ({ tag, courses: Array.from(v.courses), count: v.count }))
      .sort((a, b) => (b.courses.length + b.count) - (a.courses.length + a.count));
  }, [scheduleEvents, records.sessions]);

  const recentSessions = useMemo(() => allSessions.slice(0, 6), [allSessions]);

  const totalMinutes = useMemo(
    () => Math.round(records.sessions.reduce((a, s) => a + (s.duration_s ?? 0), 0) / 60),
    [records.sessions]
  );
  // This week's activity: number of actual recordings per day this week (Mon-Sun)
  const weekly = useMemo(() => {
    const days = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
    const pad = (n: number) => String(n).padStart(2, '0');
    const now = new Date();
    const dow = (now.getDay() + 6) % 7; // Monday = 0
    const monday = new Date(now);
    monday.setDate(now.getDate() - dow);
    const keyOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const dateKeys = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      return keyOf(d);
    });
    const counts = new Array(7).fill(0);
    records.sessions.forEach((s) => {
      const date = (s.id.match(/^(\d{4}-\d{2}-\d{2})/) || [])[1];
      const idx = date ? dateKeys.indexOf(date) : -1;
      if (idx >= 0) counts[idx] += 1;
    });
    return days.map((day, i) => ({ day, recordings: counts[i] }));
  }, [records.sessions]);

  // Session-duration distribution: the 6 longest sessions (in minutes)
  const durationDist = useMemo(() => {
    const colors = ['accent', 'primary', 'secondary'];
    return [...records.sessions]
      .sort((a, b) => (b.duration_s ?? 0) - (a.duration_s ?? 0))
      .slice(0, 6)
      .map((s, i) => ({
        tag: sessionTitle(s).slice(0, 8),
        count: Math.max(1, Math.round((s.duration_s ?? 0) / 60)),
        color: colors[i % 3],
      }));
  }, [records.sessions]);

  const stats = [
    { label: '课程总数', value: distinctCourses.length, suffix: ' 门', icon: 'ri-book-open-line', color: 'accent' },
    { label: '录音时长', value: totalMinutes, suffix: ' 分钟', icon: 'ri-mic-line', color: 'primary' },
    { label: '总摘要数', value: allSessions.length, suffix: ' 份', icon: 'ri-sparkling-2-line', color: 'accent' },
    { label: '标签数量', value: tags.length, suffix: ' 个', icon: 'ri-price-tag-3-line', color: 'secondary' },
  ];

  const colorConfig = {
    accent: { bg: 'bg-accent-100', icon: 'text-accent-600', bar: 'bg-accent-500', glow: 'from-accent-400/20' },
    primary: { bg: 'bg-primary-100', icon: 'text-primary-600', bar: 'bg-primary-500', glow: 'from-primary-400/20' },
    secondary: { bg: 'bg-secondary-100', icon: 'text-secondary-600', bar: 'bg-secondary-500', glow: 'from-secondary-400/20' },
  };

  const handleSelectSession = (id: string) => {
    // A timetable course (not yet recorded) -> start a new recording and prefill its title with the course name; an already-recorded one -> open it
    if (id.startsWith('sched-')) {
      const ev = scheduleSessions.find((s) => s.id === id);
      const q = ev?.title ? `&title=${encodeURIComponent(ev.title)}` : '';
      navigate(`/course?new=1${q}`);
      return;
    }
    navigate('/course?sid=' + encodeURIComponent(id));
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

  // Merge a batch of dated course events straight into the calendar (used by SHU sync)
  const handleAddEvents = (newEvents: ScheduleEvent[]) => {
    const key = (e: ScheduleEvent) => `${e.date}|${e.start}|${e.name}`;
    const map = new Map(scheduleEvents.map((e) => [key(e), e]));
    newEvents.forEach((e) => map.set(key(e), e));
    const merged = Array.from(map.values());
    setScheduleEvents(merged);
    void records.saveSchedule(merged).catch(() => {});
    const first = newEvents.map((e) => e.date).sort()[0];
    if (first) setCalendarFocus(`${first}|${Date.now()}`);
    setCreatedMessage(`已把 ${newEvents.length} 节课加进日历`);
    setTimeout(() => setCreatedMessage(''), 4000);
  };

  const handleImportImage = (dataUrl: string) => records.importTimetable(dataUrl);

  const handleConfirmCourses = (courses: ScheduleCourse[], anchorMonday?: string) => {
    const pad = (n: number) => String(n).padStart(2, '0');
    // Reference Monday: prefer the real date from the timetable header, fall back to this week only if it can't be recognized
    let monday: Date;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(anchorMonday || '');
    if (m) {
      monday = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    } else {
      const today = new Date();
      monday = new Date(today);
      monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
    }
    // (1) First assign a tag per course by name: reuse a similar existing tag if found, otherwise create a new one.
    //     Stick the result on the course itself (event.tag), so every course on the timetable/calendar carries its own tag.
    const st = loadSettings();
    const autoTag = st.importTagSimilar || st.importTagNew;
    const nameToTag = new Map<string, string>();   // course name -> tag label
    const createdNames: string[] = [];
    const groupedNames: string[] = [];
    if (autoTag) {
      const palette = ['accent', 'primary', 'secondary'];
      const known = [...tags];   // Accumulate ones newly created within this batch too, to avoid duplicate creation in a single import
      Array.from(new Set(courses.map((c) => c.name))).forEach((name) => {
        const trimmed = (name || '').trim();
        if (!trimmed) return;
        const similar = st.importTagSimilar ? findSimilarTag(trimmed, known) : null;
        if (similar) { nameToTag.set(name, similar.label); groupedNames.push(trimmed); return; }
        if (st.importTagNew) {
          let t = known.find((k) => k.label.trim() === trimmed);
          if (!t) { t = addTag(trimmed, palette[known.length % palette.length]); known.push(t); createdNames.push(trimmed); }
          nameToTag.set(name, t.label);
        }
      });
    }

    // (2) Place each course only on its real day (this week), no duplicates; attach the tag just assigned
    const newEvents: ScheduleEvent[] = courses.map((c) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + (c.day - 1));
      return {
        name: c.name,
        date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
        start: c.start, end: c.end, location: c.location, room: c.room,
        tag: nameToTag.get(c.name) || undefined,
      };
    });
    // Merge and dedup with the existing ones (by date+time+course name) -- supports accumulating across multiple weekly imports
    const key = (e: ScheduleEvent) => `${e.date}|${e.start}|${e.name}`;
    const map = new Map(scheduleEvents.map((e) => [key(e), e]));
    newEvents.forEach((e) => map.set(key(e), e));
    const merged = Array.from(map.values());
    setScheduleEvents(merged);
    void records.saveSchedule(merged).catch(() => {});
    // Jump to the month of this batch's earliest day so you see it right away (otherwise courses in another month stay hidden)
    const firstDate = newEvents.map((e) => e.date).sort()[0];
    if (firstDate) setCalendarFocus(`${firstDate}|${Date.now()}`); // Include a timestamp so every import re-triggers the jump
    const monthTxt = firstDate ? firstDate.slice(0, 7) : '';

    const tagged = nameToTag.size;
    const tagTxt = tagged ? `,已给 ${tagged} 门课打上标签(新建 ${createdNames.length} 个 / 沿用已有 ${groupedNames.length} 个)` : '';
    setCreatedMessage(`已把 ${courses.length} 门课加进日历${monthTxt ? `(${monthTxt})` : ''}${tagTxt}`);
    setTimeout(() => setCreatedMessage(''), 4000);
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
              onClick={() => navigate('/reference')}
              className="flex items-center gap-2 px-4 py-3 bg-background-100 text-foreground-700 rounded-xl text-sm font-medium hover:bg-background-200 transition-all cursor-pointer whitespace-nowrap self-start md:self-auto border border-background-200"
            >
              <i className="ri-booklet-line text-lg"></i>
              参考资料
            </button>
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
              {user?.role === 'admin' && (
                <button
                  onClick={() => setShowVoices(true)}
                  className="w-9 h-9 flex items-center justify-center rounded-lg bg-background-100 text-foreground-400 hover:text-foreground-600 hover:bg-background-200 transition-colors cursor-pointer"
                  title="语音标记 / 声纹库(管理员)"
                >
                  <i className="ri-user-voice-line"></i>
                </button>
              )}
              <button
                onClick={() => navigate('/help')}
                className="w-9 h-9 flex items-center justify-center rounded-lg bg-background-100 text-foreground-400 hover:text-foreground-600 hover:bg-background-200 transition-colors cursor-pointer"
                title="说明书"
              >
                <i className="ri-book-2-line"></i>
              </button>
              <button
                onClick={() => navigate('/settings')}
                className="w-9 h-9 flex items-center justify-center rounded-lg bg-background-100 text-foreground-400 hover:text-foreground-600 hover:bg-background-200 transition-colors cursor-pointer"
                title="设置"
              >
                <i className="ri-settings-3-line"></i>
              </button>
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
            const isAudioCard = sIdx === 1;
            const isSummaryCard = sIdx === 2;
            const isTagsCard = sIdx === 3;
            const isClickable = isCoursesCard || isAudioCard || isSummaryCard || isTagsCard;
            return (
              <div
                key={stat.label}
                data-guide={isCoursesCard ? 'dash-courses' : isTagsCard ? 'dash-tags' : isSummaryCard ? 'dash-summaries' : undefined}
                onClick={
                  isCoursesCard ? () => setShowCourseTypes(true)
                  : isAudioCard ? () => setShowAudioList(true)
                  : isSummaryCard ? () => setShowSummaryList(true)
                  : isTagsCard ? () => setShowTagCourses(true)
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
          sessions={[...allSessions, ...scheduleSessions]}
          focusDate={calendarFocus}
          tagLabels={tagLabels}
          tagColorMap={tagColorMap}
          onSelectSession={handleSelectSession}
          onCreateSession={handleCreateSession}
          onImport={handleOpenImport}
          onSyncShu={() => setShowSyncShu(true)}
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
                {recentSessions.length === 0 && (
                  <div className="px-5 py-8 text-center text-sm text-foreground-400">
                    还没有课程。点上面「开始录音」录第一节课吧。
                  </div>
                )}
                {recentSessions.map((session, idx) => (
                  <button
                    key={session.id}
                    onClick={() => navigate('/course?sid=' + encodeURIComponent(session.id))}
                    className={`w-full text-left px-5 py-4 flex items-center gap-4 hover:bg-background-100 transition-colors cursor-pointer ${
                      idx < recentSessions.length - 1 ? 'border-b border-background-100' : ''
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
                          {session.date} {session.time}
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
                  <BarChart data={weekly} barGap={2}>
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
                    <Bar dataKey="recordings" name="录音数" fill="oklch(var(--accent-500) / 0.7)" radius={[6, 6, 0, 0]} />
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
                课时时长(分钟)
              </h3>
              <div className="space-y-2.5">
                {durationDist.length === 0 && (
                  <p className="text-xs text-foreground-400 py-2">还没有录音</p>
                )}
                {durationDist.map((item) => {
                  const maxCount = Math.max(...durationDist.map((t) => t.count));
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
        onImportImage={handleImportImage}
        onConfirmCourses={handleConfirmCourses}
      />

      <SyncShuModal
        isOpen={showSyncShu}
        onClose={() => setShowSyncShu(false)}
        onSync={records.importShu}
        onConfirmEvents={handleAddEvents}
      />

      <CourseTypeModal
        isOpen={showCourseTypes}
        onClose={() => setShowCourseTypes(false)}
        courses={distinctCourses}
        onSelect={(name) => { setShowCourseTypes(false); navigate('/course-detail?name=' + encodeURIComponent(name)); }}
      />

      <TagCoursesModal
        isOpen={showTagCourses}
        onClose={() => setShowTagCourses(false)}
        groups={tagGroups}
        onSelect={(tag) => { setShowTagCourses(false); navigate('/course-detail?tag=' + encodeURIComponent(tag)); }}
        onManage={() => { setShowTagCourses(false); navigate('/tags'); }}
      />

      <SummaryListModal
        isOpen={showSummaryList}
        onClose={() => setShowSummaryList(false)}
        sessions={allSessions}
        tagLabels={tagLabels}
      />

      <AudioListModal
        isOpen={showAudioList}
        onClose={() => setShowAudioList(false)}
        sessions={realSessions}
      />

      <VoicePrintModal isOpen={showVoices && user?.role === 'admin'} onClose={() => setShowVoices(false)} />
    </div>
  );
}