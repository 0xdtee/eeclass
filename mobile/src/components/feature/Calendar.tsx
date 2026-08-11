import { useState, useMemo, useCallback } from 'react';

interface SessionRef {
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

interface CalendarProps {
  sessions: SessionRef[];
  tagLabels: Record<string, string>;
  tagColorMap: Record<string, string>;
  onSelectSession: (id: string) => void;
  onCreateSession: (date: string) => void;
  onImport?: () => void;
}

type CalendarView = 'year' | 'month' | 'day';

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
const MONTHS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function formatDate(year: number, month: number, day: number): string {
  const m = (month + 1).toString().padStart(2, '0');
  const d = day.toString().padStart(2, '0');
  return `${year}-${m}-${d}`;
}

function getColorClass(color: string, type: 'bg' | 'border' | 'text' | 'dot' | 'bar'): string {
  const map: Record<string, Record<string, string>> = {
    accent: { bg: 'bg-accent-50', border: 'border-accent-200/70', text: 'text-accent-700', dot: 'bg-accent-500', bar: 'bg-accent-400' },
    primary: { bg: 'bg-primary-50', border: 'border-primary-200/70', text: 'text-primary-700', dot: 'bg-primary-500', bar: 'bg-primary-400' },
    secondary: { bg: 'bg-secondary-50', border: 'border-secondary-200/70', text: 'text-secondary-700', dot: 'bg-secondary-500', bar: 'bg-secondary-400' },
  };
  return map[color]?.[type] ?? map.accent[type];
}

export default function Calendar({ sessions, tagLabels, tagColorMap, onSelectSession, onCreateSession, onImport }: CalendarProps) {
  const today = new Date();
  const [viewMode, setViewMode] = useState<CalendarView>('month');
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [viewDay, setViewDay] = useState(today.getDate());
  const [hoveredDate, setHoveredDate] = useState<string | null>(null);

  const sessionsByDate = useMemo(() => {
    const map: Record<string, SessionRef[]> = {};
    sessions.forEach((s) => {
      if (!map[s.date]) map[s.date] = [];
      map[s.date].push(s);
    });
    return map;
  }, [sessions]);

  const sessionsByMonth = useMemo(() => {
    const map: Record<string, number> = {};
    sessions.forEach((s) => {
      const [y, m] = s.date.split('-').map(Number);
      const key = `${y}-${(m || 1) - 1}`;
      map[key] = (map[key] || 0) + 1;
    });
    return map;
  }, [sessions]);

  const currentDateStr = formatDate(viewYear, viewMonth, viewDay);
  const currentSessions = sessionsByDate[currentDateStr] ?? [];

  const navigatePrev = useCallback(() => {
    if (viewMode === 'year') {
      setViewYear((y) => y - 1);
    } else if (viewMode === 'month') {
      if (viewMonth === 0) {
        setViewYear((y) => y - 1);
        setViewMonth(11);
      } else {
        setViewMonth((m) => m - 1);
      }
    } else {
      const prev = new Date(viewYear, viewMonth, viewDay - 1);
      setViewYear(prev.getFullYear());
      setViewMonth(prev.getMonth());
      setViewDay(prev.getDate());
    }
  }, [viewMode, viewYear, viewMonth, viewDay]);

  const navigateNext = useCallback(() => {
    if (viewMode === 'year') {
      setViewYear((y) => y + 1);
    } else if (viewMode === 'month') {
      if (viewMonth === 11) {
        setViewYear((y) => y + 1);
        setViewMonth(0);
      } else {
        setViewMonth((m) => m + 1);
      }
    } else {
      const next = new Date(viewYear, viewMonth, viewDay + 1);
      setViewYear(next.getFullYear());
      setViewMonth(next.getMonth());
      setViewDay(next.getDate());
    }
  }, [viewMode, viewYear, viewMonth, viewDay]);

  const goToday = () => {
    setViewYear(today.getFullYear());
    setViewMonth(today.getMonth());
    setViewDay(today.getDate());
    if (viewMode === 'year') setViewMode('month');
  };

  const headerLabel = useMemo(() => {
    if (viewMode === 'year') return `${viewYear}年`;
    if (viewMode === 'month') return `${viewYear}年 ${MONTHS[viewMonth]}`;
    const d = new Date(viewYear, viewMonth, viewDay);
    const weekDay = WEEKDAYS[d.getDay()];
    return `${viewYear}年${viewMonth + 1}月${viewDay}日 星期${weekDay}`;
  }, [viewMode, viewYear, viewMonth, viewDay]);

  const viewCount = useMemo(() => {
    if (viewMode === 'year') return sessions.length;
    if (viewMode === 'month') {
      const key = `${viewYear}-${viewMonth}`;
      return sessionsByMonth[key] || 0;
    }
    return currentSessions.length;
  }, [viewMode, sessions, sessionsByMonth, sessionsByDate, viewYear, viewMonth, currentSessions]);

  const handleDateClick = (year: number, month: number, day: number) => {
    // Drill down one level per click: year → month → day. At the day level, open the lesson or create one.
    if (viewMode === 'year') {
      setViewYear(year); setViewMonth(month); setViewMode('month');
      return;
    }
    if (viewMode === 'month') {
      setViewYear(year); setViewMonth(month); setViewDay(day); setViewMode('day');
      return;
    }
    const dateStr = formatDate(year, month, day);
    const daySessions = sessionsByDate[dateStr] ?? [];
    if (daySessions.length > 0) onSelectSession(daySessions[0].id);
    else onCreateSession(dateStr);
  };

  const handleMonthCardClick = (month: number) => {
    setViewMonth(month);
    setViewMode('month');
  };

  const switchToView = (mode: CalendarView) => {
    setViewMode(mode);
    if (mode === 'day' && viewMode === 'year') {
      setViewMonth(today.getMonth());
      setViewDay(today.getDate());
    }
  };

  return (
    <div className="bg-background-50 rounded-2xl border border-background-200 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-background-100">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 flex items-center justify-center">
            <i className="ri-calendar-line text-accent-500 text-lg"></i>
          </div>
          <h3 className="text-sm font-semibold text-foreground-800">课程日历</h3>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => onCreateSession('')}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-accent-500 text-background-50 rounded-lg text-xs font-semibold hover:bg-accent-600 transition-colors cursor-pointer whitespace-nowrap"
            >
              <i className="ri-add-line"></i>
              新建课时
            </button>
            {onImport && (
              <button
                onClick={onImport}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-background-100 text-foreground-600 rounded-lg text-xs font-medium hover:bg-background-200 hover:text-foreground-800 transition-colors cursor-pointer whitespace-nowrap border border-background-200"
              >
                <i className="ri-file-upload-line"></i>
                导入文档
              </button>
            )}
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center bg-background-100 rounded-full px-1 py-1">
              {(['year', 'month', 'day'] as CalendarView[]).map((mode) => (
                <button
                  key={mode}
                  onClick={() => switchToView(mode)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-full transition-all cursor-pointer whitespace-nowrap ${
                    viewMode === mode
                      ? 'bg-accent-500 text-background-50'
                      : 'text-foreground-400 hover:text-foreground-600'
                  }`}
                >
                  {mode === 'year' ? '年' : mode === 'month' ? '月' : '日'}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1">
              <button
                onClick={goToday}
                className="px-3 py-1.5 text-xs font-medium text-accent-600 hover:bg-accent-50 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
              >
                今天
              </button>
              <button
                onClick={navigatePrev}
                className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-background-100 text-foreground-500 transition-colors cursor-pointer"
              >
                <i className="ri-arrow-left-s-line"></i>
              </button>
              <span className="text-sm font-semibold text-foreground-800 min-w-[140px] text-center">
                {headerLabel}
              </span>
              <button
                onClick={navigateNext}
                className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-background-100 text-foreground-500 transition-colors cursor-pointer"
              >
                <i className="ri-arrow-right-s-line"></i>
              </button>
            </div>

            {viewCount > 0 && (
              <span className="px-2.5 py-1 bg-accent-50 text-accent-700 text-xs font-semibold rounded-full whitespace-nowrap">
                {viewCount} 课时
              </span>
            )}
          </div>
        </div>
      </div>

      {viewMode === 'year' && (
        <YearView
          viewYear={viewYear}
          today={today}
          sessionsByDate={sessionsByDate}
          sessionsByMonth={sessionsByMonth}
          tagLabels={tagLabels}
          tagColorMap={tagColorMap}
          onMonthClick={handleMonthCardClick}
          onDateClick={handleDateClick}
          onCreateSession={onCreateSession}
          hoveredDate={hoveredDate}
          setHoveredDate={setHoveredDate}
        />
      )}

      {viewMode === 'month' && (
        <MonthView
          viewYear={viewYear}
          viewMonth={viewMonth}
          today={today}
          sessionsByDate={sessionsByDate}
          tagLabels={tagLabels}
          tagColorMap={tagColorMap}
          onDateClick={handleDateClick}
          onCreateSession={onCreateSession}
          hoveredDate={hoveredDate}
          setHoveredDate={setHoveredDate}
        />
      )}

      {viewMode === 'day' && (
        <DayView
          viewYear={viewYear}
          viewMonth={viewMonth}
          viewDay={viewDay}
          today={today}
          currentSessions={currentSessions}
          tagLabels={tagLabels}
          tagColorMap={tagColorMap}
          onSelectSession={onSelectSession}
          onCreateSession={() => onCreateSession(currentDateStr)}
        />
      )}
    </div>
  );
}

/* ============ YEAR VIEW ============ */

interface YearViewProps {
  viewYear: number;
  today: Date;
  sessionsByDate: Record<string, SessionRef[]>;
  sessionsByMonth: Record<string, number>;
  tagLabels: Record<string, string>;
  tagColorMap: Record<string, string>;
  onMonthClick: (month: number) => void;
  onDateClick: (year: number, month: number, day: number) => void;
  onCreateSession: (date: string) => void;
  hoveredDate: string | null;
  setHoveredDate: (d: string | null) => void;
}

function YearView({
  viewYear, today, sessionsByDate, sessionsByMonth,
  tagLabels, tagColorMap, onMonthClick, onDateClick, onCreateSession,
  hoveredDate, setHoveredDate,
}: YearViewProps) {
  const daysInMonth = (month: number) => {
    if (month === 1 && isLeapYear(viewYear)) return 29;
    return MONTH_DAYS[month];
  };

  const getSessionColor = (dateStr: string): string => {
    const daySessions = sessionsByDate[dateStr];
    if (!daySessions || daySessions.length === 0) return '';
    const firstTag = daySessions[0].tags[0];
    return tagColorMap[firstTag] ?? 'accent';
  };

  return (
    <div className="p-4">
      <div className="grid grid-cols-4 gap-3">
        {MONTHS.map((monthLabel, monthIdx) => {
          const key = `${viewYear}-${monthIdx}`;
          const count = sessionsByMonth[key] || 0;
          const days = daysInMonth(monthIdx);
          const firstDay = new Date(viewYear, monthIdx, 1).getDay();

          return (
            <button
              key={monthLabel}
              onClick={() => onMonthClick(monthIdx)}
              className="text-left bg-background-100/50 rounded-xl p-3 border border-background-100 hover:border-accent-200 hover:bg-background-100 transition-all cursor-pointer group"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-foreground-700">{monthLabel}</span>
                {count > 0 && (
                  <span className="px-1.5 py-0.5 bg-accent-100 text-accent-700 text-[10px] font-semibold rounded-full">
                    {count}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-7 gap-px">
                {['日','一','二','三','四','五','六'].map((w) => (
                  <span key={w} className="text-center text-[9px] text-foreground-300 leading-4">{w}</span>
                ))}

                {Array.from({ length: firstDay }).map((_, i) => (
                  <div key={`empty-${i}`}></div>
                ))}

                {Array.from({ length: days }).map((_, dIdx) => {
                  const day = dIdx + 1;
                  const dateStr = formatDate(viewYear, monthIdx, day);
                  const hasSession = !!sessionsByDate[dateStr];
                  const isToday = viewYear === today.getFullYear() && monthIdx === today.getMonth() && day === today.getDate();
                  const color = getSessionColor(dateStr);
                  const dotClass = hasSession ? getColorClass(color, 'dot') : '';

                  return (
                    <div
                      key={day}
                      onClick={(e) => {
                        e.stopPropagation();
                        onDateClick(viewYear, monthIdx, day);
                      }}
                      onMouseEnter={() => setHoveredDate(dateStr)}
                      onMouseLeave={() => setHoveredDate(null)}
                      className={`relative flex items-center justify-center w-full aspect-square text-[9px] rounded-sm cursor-pointer transition-colors ${
                        hasSession
                          ? `${dotClass} text-background-50 font-semibold`
                          : isToday
                            ? 'bg-primary-100 text-primary-700 font-bold'
                            : 'text-foreground-400 hover:bg-background-200'
                      }`}
                      title={hasSession ? sessionsByDate[dateStr].map((s) => s.title).join('\n') : ''}
                    >
                      {day}
                    </div>
                  );
                })}
              </div>
            </button>
          );
        })}
      </div>

      {hoveredDate && sessionsByDate[hoveredDate] && (
        <div className="mt-3 p-3 bg-accent-50 rounded-xl border border-accent-100">
          <p className="text-xs font-semibold text-accent-700 mb-1.5">{hoveredDate}</p>
          <div className="space-y-1.5">
            {sessionsByDate[hoveredDate].slice(0, 3).map((s) => (
              <div key={s.id} className="text-xs text-foreground-600 flex items-center gap-2">
                <span className="w-1 h-1 rounded-full bg-accent-400 flex-shrink-0"></span>
                <span className="truncate">{s.title}</span>
                <span className="text-foreground-400 flex-shrink-0">{s.time}</span>
              </div>
            ))}
            {sessionsByDate[hoveredDate].length > 3 && (
              <p className="text-[10px] text-foreground-400 pl-3">
                还有 {sessionsByDate[hoveredDate].length - 3} 节课...
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ============ MONTH VIEW ============ */

interface MonthViewProps {
  viewYear: number;
  viewMonth: number;
  today: Date;
  sessionsByDate: Record<string, SessionRef[]>;
  tagLabels: Record<string, string>;
  tagColorMap: Record<string, string>;
  onDateClick: (year: number, month: number, day: number) => void;
  onCreateSession: (date: string) => void;
  hoveredDate: string | null;
  setHoveredDate: (d: string | null) => void;
}

function MonthView({
  viewYear, viewMonth, today, sessionsByDate, tagLabels,
  tagColorMap, onDateClick, onCreateSession,
  hoveredDate, setHoveredDate,
}: MonthViewProps) {
  const daysInMonth = viewMonth === 1 && isLeapYear(viewYear) ? 29 : MONTH_DAYS[viewMonth];
  const firstDayOfWeek = new Date(viewYear, viewMonth, 1).getDay();

  const calendarDays: number[] = [];
  for (let d = 1; d <= daysInMonth; d++) calendarDays.push(d);

  const getSessionColor = (dateStr: string): string => {
    const daySessions = sessionsByDate[dateStr];
    if (!daySessions || daySessions.length === 0) return '';
    const firstTag = daySessions[0].tags[0];
    return tagColorMap[firstTag] ?? 'accent';
  };

  return (
    <div className="p-4">
      <div className="grid grid-cols-7 mb-2">
        {WEEKDAYS.map((wd) => (
          <div key={wd} className="text-center text-xs font-medium text-foreground-400 py-1.5">{wd}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: firstDayOfWeek }).map((_, i) => (
          <div key={`empty-${i}`}></div>
        ))}

        {calendarDays.map((day) => {
          const dateStr = formatDate(viewYear, viewMonth, day);
          const daySessions = sessionsByDate[dateStr] ?? [];
          const hasSessions = daySessions.length > 0;
          const isToday = viewYear === today.getFullYear() && viewMonth === today.getMonth() && day === today.getDate();
          const color = getSessionColor(dateStr);
          const bgClass = hasSessions ? getColorClass(color, 'bg') : '';
          const borderClass = hasSessions ? getColorClass(color, 'border') : '';
          const textClass = hasSessions ? getColorClass(color, 'text') : '';
          const dotClass = hasSessions ? getColorClass(color, 'dot') : '';
          const barClass = hasSessions ? getColorClass(color, 'bar') : '';

          return (
            <button
              key={dateStr}
              onClick={() => onDateClick(viewYear, viewMonth, day)}
              onMouseEnter={() => hasSessions && setHoveredDate(dateStr)}
              onMouseLeave={() => setHoveredDate(null)}
              className={`relative flex flex-col items-start p-1.5 h-[108px] rounded-lg transition-all cursor-pointer group border text-left overflow-hidden ${
                hasSessions
                  ? `${bgClass} ${borderClass} hover:border-accent-400`
                  : isToday
                    ? 'bg-primary-50 border-primary-200'
                    : 'bg-background-50 border-transparent hover:border-background-200 hover:bg-background-100'
              }`}
            >
              {/* Left color accent bar */}
              {hasSessions && (
                <div className={`absolute left-0 top-0 bottom-0 w-[3px] ${barClass} rounded-r-full`}></div>
              )}

              <span className={`text-xs font-semibold mb-1.5 relative z-10 ${
                isToday
                  ? 'w-5 h-5 flex items-center justify-center bg-primary-500 text-background-50 rounded-full'
                  : hasSessions
                    ? textClass
                    : 'text-foreground-500'
              }`}>
                {isToday ? day : day}
              </span>

              <div className="flex-1 w-full overflow-hidden space-y-1 relative z-10">
                {daySessions.slice(0, 2).map((session, idx) => {
                  const displayTitle = session.title
                    .replace(/^第\d+讲：/, '')
                    .replace(/^补课：/, '')
                    .replace(/^虚拟实验室：/, '');

                  return (
                    <div key={session.id} className="space-y-0.5">
                      <div className={`flex items-center gap-1 px-1 py-0.5 rounded text-[10px] leading-tight ${bgClass} bg-background-50/60`}>
                        <span className={`w-1 h-1 rounded-full ${dotClass} flex-shrink-0`}></span>
                        <span className={`truncate font-medium ${textClass}`}>{displayTitle}</span>
                      </div>
                      {idx === 0 && session.summary && (
                        <p className="text-[9px] leading-tight text-foreground-400 px-1 line-clamp-2">
                          {session.summary.replace(/^本课时[^。]*。/, '').substring(0, 40)}
                        </p>
                      )}
                    </div>
                  );
                })}
                {daySessions.length > 2 && (
                  <span className={`text-[9px] font-medium px-1 ${textClass}`}>
                    +{daySessions.length - 2} 更多
                  </span>
                )}
              </div>

              {!hasSessions && (
                <span className="absolute opacity-0 group-hover:opacity-100 text-[10px] text-foreground-300 transition-opacity bottom-1.5 right-1.5">
                  + 新建
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ============ DAY VIEW ============ */

interface DayViewProps {
  viewYear: number;
  viewMonth: number;
  viewDay: number;
  today: Date;
  currentSessions: SessionRef[];
  tagLabels: Record<string, string>;
  tagColorMap: Record<string, string>;
  onSelectSession: (id: string) => void;
  onCreateSession: () => void;
}

function DayView({
  viewYear, viewMonth, viewDay, today,
  currentSessions, tagLabels, tagColorMap, onSelectSession, onCreateSession,
}: DayViewProps) {
  const isToday = viewYear === today.getFullYear() && viewMonth === today.getMonth() && viewDay === today.getDate();
  const weekDay = WEEKDAYS[new Date(viewYear, viewMonth, viewDay).getDay()];

  const timeSlots = [
    { label: '上午 08:00 - 10:00', range: '08' },
    { label: '上午 10:00 - 12:00', range: '10' },
    { label: '下午 13:00 - 15:00', range: '13' },
    { label: '下午 15:00 - 17:00', range: '15' },
    { label: '晚间 18:00 - 21:00', range: '18' },
  ];

  const sessionTimeSlots = timeSlots.map((slot) => {
    const matched = currentSessions.filter((s) => {
      const hour = parseInt(s.time.split(':')[0], 10);
      const slotHour = parseInt(slot.range, 10);
      return hour >= slotHour && hour < slotHour + 2;
    });
    return { ...slot, sessions: matched };
  }).filter((slot) => slot.sessions.length > 0);

  const emptySlots = timeSlots.filter((slot) => {
    const matched = currentSessions.filter((s) => {
      const hour = parseInt(s.time.split(':')[0], 10);
      const slotHour = parseInt(slot.range, 10);
      return hour >= slotHour && hour < slotHour + 2;
    });
    return matched.length === 0;
  });

  const getSessionColor = (session: SessionRef): string => {
    const firstTag = session.tags[0];
    return tagColorMap[firstTag] ?? 'accent';
  };

  return (
    <div className="p-5 max-h-[600px] overflow-y-auto">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h4 className="text-base font-bold text-foreground-800">
            {viewYear}年{viewMonth + 1}月{viewDay}日 <span className="text-sm font-normal text-foreground-400">星期{weekDay}</span>
          </h4>
          {isToday && (
            <span className="inline-block mt-1 px-2 py-0.5 bg-primary-100 text-primary-700 text-[10px] font-semibold rounded-full">今天</span>
          )}
        </div>
        <button
          onClick={onCreateSession}
          className="flex items-center gap-1.5 px-4 py-2 bg-accent-500 text-background-50 rounded-xl text-xs font-semibold hover:bg-accent-600 transition-colors cursor-pointer whitespace-nowrap"
        >
          <i className="ri-add-line"></i>
          新建课时
        </button>
      </div>

      {currentSessions.length === 0 ? (
        <div className="text-center py-12">
          <div className="w-16 h-16 mx-auto flex items-center justify-center bg-background-100 rounded-2xl mb-3">
            <i className="ri-calendar-check-line text-foreground-300 text-2xl"></i>
          </div>
          <p className="text-sm text-foreground-400 mb-3">当天暂无课程记录</p>
          <button
            onClick={onCreateSession}
            className="px-4 py-2 bg-accent-500 text-background-50 rounded-xl text-xs font-semibold hover:bg-accent-600 transition-colors cursor-pointer whitespace-nowrap"
          >
            创建课时
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {sessionTimeSlots.map((slot) => (
            <div key={slot.range}>
              <div className="flex items-center gap-2 mb-2">
                <div className="w-2 h-2 rounded-full bg-accent-400 flex-shrink-0"></div>
                <span className="text-xs font-medium text-foreground-400">{slot.label}</span>
              </div>
              <div className="space-y-3 pl-4">
                {slot.sessions.map((session) => {
                  const color = getSessionColor(session);
                  const barClass = getColorClass(color, 'bar');
                  const textClass = getColorClass(color, 'text');
                  const bgClass = getColorClass(color, 'bg');
                  const dotClass = getColorClass(color, 'dot');

                  return (
                    <button
                      key={session.id}
                      onClick={() => onSelectSession(session.id)}
                      className="w-full text-left bg-background-50 rounded-xl border border-background-200 overflow-hidden hover:border-accent-300 transition-all cursor-pointer group"
                    >
                      {/* Color accent top bar */}
                      <div className={`h-1 w-full ${barClass}`}></div>

                      <div className="p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            {/* Meta row */}
                            <div className="flex items-center gap-2 mb-1.5">
                              <span className={`text-xs font-medium ${textClass} ${bgClass} px-2 py-0.5 rounded-full whitespace-nowrap`}>
                                {session.time}
                              </span>
                              <span className="text-xs text-foreground-400">{session.duration}</span>
                              <div className="flex items-center gap-1">
                                <div className={`w-1 h-1 rounded-full ${dotClass}`}></div>
                                <span className="text-xs text-foreground-400">{session.keyPoints?.length ?? 0} 个重点</span>
                              </div>
                            </div>

                            {/* Title */}
                            <h5 className="text-sm font-semibold text-foreground-800 mb-1.5">{session.title}</h5>

                            {/* Description */}
                            <p className="text-xs text-foreground-400 mb-2">{session.description}</p>

                            {/* Summary */}
                            <div className={`${bgClass} rounded-lg p-3 mb-2.5`}>
                              <p className="text-xs font-medium text-foreground-500 mb-1 flex items-center gap-1">
                                <div className="w-4 h-4 flex items-center justify-center">
                                  <i className="ri-magic-line text-[10px]"></i>
                                </div>
                                AI摘要
                              </p>
                              <p className="text-xs leading-relaxed text-foreground-600 line-clamp-4">
                                {session.summary}
                              </p>
                            </div>

                            {/* Tags */}
                            <div className="flex flex-wrap gap-1">
                              {session.tags.map((tagId) => (
                                <span
                                  key={tagId}
                                  className={`px-1.5 py-0.5 rounded text-[10px] font-medium whitespace-nowrap ${bgClass} ${textClass}`}
                                >
                                  {tagLabels[tagId] ?? tagId}
                                </span>
                              ))}
                            </div>
                          </div>

                          <div className="w-6 h-6 flex items-center justify-center flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                            <i className="ri-arrow-right-line text-accent-500"></i>
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          {emptySlots.length > 0 && (
            <div className="pt-2 border-t border-background-100">
              <p className="text-xs text-foreground-300 mb-2">空闲时段</p>
              <div className="flex flex-wrap gap-2">
                {emptySlots.slice(0, 4).map((slot) => (
                  <button
                    key={slot.range}
                    onClick={onCreateSession}
                    className="px-3 py-1.5 bg-background-100 rounded-lg text-xs text-foreground-400 hover:bg-accent-50 hover:text-accent-600 transition-colors cursor-pointer whitespace-nowrap"
                  >
                    {slot.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}