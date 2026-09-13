import { useState, useMemo, useCallback, useEffect } from 'react';
import { useT } from '@/lib/i18n';
import { loadSettings } from '@/lib/settings';

interface SessionRef {
  id: string;
  title: string;
  date: string;
  time: string;
  /** Timetable extras (course events only): end time, place and teacher */
  endTime?: string;
  place?: string;
  teacher?: string;
  credits?: string;
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
  /** Undo/redo the last schedule change (e.g. an import with the wrong start date); buttons show only when available */
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  /** When changed, the calendar jumps to the month containing this date (e.g. jump to the course's month after importing a schedule) */
  focusDate?: string;
}

type CalendarView = 'year' | 'month' | 'week' | 'day';

// Course block color: hashed from the course name (with "Lesson N" stripped), so the same course always gets the same color
const BLOCK_COLORS = [
  'bg-red-100 text-red-700 border-red-200',
  'bg-blue-100 text-blue-700 border-blue-200',
  'bg-purple-100 text-purple-700 border-purple-200',
  'bg-green-100 text-green-700 border-green-200',
  'bg-orange-100 text-orange-700 border-orange-200',
  'bg-teal-100 text-teal-700 border-teal-200',
  'bg-pink-100 text-pink-700 border-pink-200',
  'bg-indigo-100 text-indigo-700 border-indigo-200',
];
function courseBaseName(t: string): string {
  return (t || '').replace(/\s*第\s*\d+\s*[课讲节]\s*$/, '').trim();
}
function blockColor(name: string): string {
  return BLOCK_COLORS[nameHash(name) % BLOCK_COLORS.length];
}

// Credit-weighted palette: the credit value picks how deep/warm the block is, and within that band the
// course name picks one of a few tones -- so the same course is always the same color, while two different
// courses worth the same credits stay distinguishable.
const CREDIT_BANDS: { max: number; tones: string[] }[] = [
  // One hue per credit band, three shades within it: same credits always read as the same colour family,
  // while two courses of equal weight still differ by depth.
  { max: 1, tones: [
    'bg-sky-50 text-sky-800 border-sky-200',
    'bg-sky-100 text-sky-800 border-sky-300',
    'bg-sky-200 text-sky-900 border-sky-400',
  ] },
  { max: 2, tones: [
    'bg-teal-50 text-teal-800 border-teal-200',
    'bg-teal-100 text-teal-800 border-teal-300',
    'bg-teal-200 text-teal-900 border-teal-400',
  ] },
  { max: 3, tones: [
    'bg-amber-50 text-amber-800 border-amber-200',
    'bg-amber-100 text-amber-800 border-amber-300',
    'bg-amber-200 text-amber-900 border-amber-400',
  ] },
  { max: 4, tones: [
    'bg-orange-100 text-orange-800 border-orange-300',
    'bg-orange-200 text-orange-900 border-orange-400',
    'bg-orange-300 text-orange-900 border-orange-500',
  ] },
  { max: 99, tones: [
    'bg-rose-100 text-rose-800 border-rose-300',
    'bg-rose-200 text-rose-900 border-rose-400',
    'bg-rose-300 text-rose-900 border-rose-500',
  ] },
];
const NO_CREDIT = 'bg-background-100 text-foreground-600 border-background-300';

/** Stable hash of a course name with its "第N课" numbering stripped, so every session of one course agrees. */
function nameHash(name: string): number {
  const b = courseBaseName(name);
  let h = 0;
  for (let i = 0; i < b.length; i++) h = (h * 31 + b.charCodeAt(i)) >>> 0;
  return h;
}

function creditColor(credits: string | undefined, name: string): string {
  const v = parseFloat((credits || '').replace(/[^\d.]/g, ''));
  if (!Number.isFinite(v) || v <= 0) return NO_CREDIT;
  const band = CREDIT_BANDS.find((c) => v <= c.max) ?? CREDIT_BANDS[CREDIT_BANDS.length - 1];
  return band.tones[nameHash(name) % band.tones.length];
}

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

export default function Calendar({ sessions, tagLabels, tagColorMap, onSelectSession, onCreateSession, onImport, onUndo, onRedo, canUndo, canRedo, focusDate }: CalendarProps) {
  const t = useT();
  // Course block coloring follows the user's setting: per course, or shaded by credits
  const colorMode = loadSettings().calendarColor;
  const colorOf = useCallback(
    (s: SessionRef) => (colorMode === 'credits' ? creditColor(s.credits, s.title) : blockColor(s.title)),
    [colorMode]
  );
  const today = new Date();
  const [viewMode, setViewMode] = useState<CalendarView>('week');
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [viewDay, setViewDay] = useState(today.getDate());
  const [hoveredDate, setHoveredDate] = useState<string | null>(null);
  // A 7-column week grid can't fit a phone; below this width we show the day view instead.
  const [narrow, setNarrow] = useState(() => (typeof window !== 'undefined' ? window.innerWidth < 760 : false));
  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < 760);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // After importing a schedule, jump to the course's month, otherwise courses in other months aren't visible
  useEffect(() => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(focusDate || '');
    if (m) {
      setViewMode('week');
      setViewYear(Number(m[1]));
      setViewMonth(Number(m[2]) - 1);
      setViewDay(Number(m[3]));
    }
  }, [focusDate]);

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

  // The 7 days (Monday–Sunday) of the current week
  const weekDates = useMemo(() => {
    const base = new Date(viewYear, viewMonth, viewDay);
    const dow = (base.getDay() + 6) % 7; // Monday=0
    const mon = new Date(base);
    mon.setDate(base.getDate() - dow);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(mon);
      d.setDate(mon.getDate() + i);
      return d;
    });
  }, [viewYear, viewMonth, viewDay]);

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
      const step = viewMode === 'week' ? 7 : 1;   // Week view pages a whole week, day view pages one day
      const prev = new Date(viewYear, viewMonth, viewDay - step);
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
      const step = viewMode === 'week' ? 7 : 1;
      const next = new Date(viewYear, viewMonth, viewDay + step);
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
    if (viewMode === 'year') return t('{y}年', { y: viewYear });
    if (viewMode === 'month') return t('{y}年 {m}', { y: viewYear, m: t(MONTHS[viewMonth]) });
    if (viewMode === 'week') {
      const a = weekDates[0], b = weekDates[6];
      return t('{am}月{ad}日 - {bm}月{bd}日', { am: a.getMonth() + 1, ad: a.getDate(), bm: b.getMonth() + 1, bd: b.getDate() });
    }
    const d = new Date(viewYear, viewMonth, viewDay);
    const weekDay = WEEKDAYS[d.getDay()];
    return t('{y}年{m}月{d}日 星期{w}', { y: viewYear, m: viewMonth + 1, d: viewDay, w: t(weekDay) });
  }, [viewMode, viewYear, viewMonth, viewDay, weekDates, t]);

  const viewCount = useMemo(() => {
    if (viewMode === 'year') {
      return Object.entries(sessionsByMonth).reduce((n, [k, v]) => (k.startsWith(`${viewYear}-`) ? n + v : n), 0);
    }
    if (viewMode === 'month') {
      const key = `${viewYear}-${viewMonth}`;
      return sessionsByMonth[key] || 0;
    }
    if (viewMode === 'week') {
      return weekDates.reduce((n, d) => n + (sessionsByDate[formatDate(d.getFullYear(), d.getMonth(), d.getDate())]?.length ?? 0), 0);
    }
    return currentSessions.length;
  }, [viewMode, sessions, sessionsByMonth, sessionsByDate, viewYear, viewMonth, currentSessions, weekDates]);

  const handleDateClick = (year: number, month: number, day: number) => {
    // Drill down one level per click: year → month → week → day. At the day level, open the session or create one.
    if (viewMode === 'year') {
      setViewYear(year); setViewMonth(month); setViewMode('month');
      return;
    }
    if (viewMode === 'month') {
      setViewYear(year); setViewMonth(month); setViewDay(day); setViewMode('week');
      return;
    }
    if (viewMode === 'week') {
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
    if (mode === 'day' || mode === 'week') {
      if (viewMode === 'year') {
        // entering week/day from the year overview: land on today
        setViewYear(today.getFullYear());
        setViewMonth(today.getMonth());
        setViewDay(today.getDate());
      } else {
        // clamp the day to the current month's length, or a stale viewDay (e.g. 31) would build an
        // invalid date when the month has fewer days: "2026-02-31" / a week that overflows into March.
        const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
        if (viewDay > daysInMonth) setViewDay(daysInMonth);
      }
    }
  };

  return (
    <div className="bg-background-50 rounded-2xl border border-background-200 overflow-hidden">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 sm:px-5 py-3 sm:py-4 border-b border-background-100">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 flex items-center justify-center">
            <i className="ri-calendar-line text-accent-500 text-lg"></i>
          </div>
          <h3 className="text-sm font-semibold text-foreground-800">{t('课程日历')}</h3>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => onCreateSession('')}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-accent-500 text-background-50 rounded-lg text-xs font-semibold hover:bg-accent-600 transition-colors cursor-pointer whitespace-nowrap"
            >
              <i className="ri-add-line"></i>
              {t('新建课时')}
            </button>
            {onImport && (
              <button
                onClick={onImport}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-background-100 text-foreground-600 rounded-lg text-xs font-medium hover:bg-background-200 hover:text-foreground-800 transition-colors cursor-pointer whitespace-nowrap border border-background-200"
              >
                <i className="ri-file-upload-line"></i>
                {t('导入文档')}
              </button>
            )}
            {(canUndo || canRedo) && (
              <div className="flex items-center gap-1">
                {onUndo && (
                  <button
                    onClick={onUndo}
                    disabled={!canUndo}
                    title={t('撤回上一次课表改动(如导入时选错时间)')}
                    className="flex items-center gap-1 px-2.5 py-1.5 bg-background-100 text-foreground-600 rounded-lg text-xs font-medium hover:bg-background-200 hover:text-foreground-800 transition-colors cursor-pointer whitespace-nowrap border border-background-200 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <i className="ri-arrow-go-back-line"></i>{t('撤回')}
                  </button>
                )}
                {onRedo && (
                  <button
                    onClick={onRedo}
                    disabled={!canRedo}
                    title={t('恢复刚撤回的课表改动')}
                    className="flex items-center gap-1 px-2.5 py-1.5 bg-background-100 text-foreground-600 rounded-lg text-xs font-medium hover:bg-background-200 hover:text-foreground-800 transition-colors cursor-pointer whitespace-nowrap border border-background-200 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <i className="ri-arrow-go-forward-line"></i>{t('恢复')}
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <div className="flex items-center bg-background-100 rounded-full px-1 py-1">
              {(['year', 'month', 'week', 'day'] as CalendarView[]).map((mode) => (
                <button
                  key={mode}
                  onClick={() => switchToView(mode)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-full transition-all cursor-pointer whitespace-nowrap ${
                    viewMode === mode
                      ? 'bg-accent-500 text-background-50'
                      : 'text-foreground-400 hover:text-foreground-600'
                  }`}
                >
                  {mode === 'year' ? t('年') : mode === 'month' ? t('月') : mode === 'week' ? t('周') : t('日', undefined, 'view')}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1">
              <button
                onClick={goToday}
                className="px-3 py-1.5 text-xs font-medium text-accent-600 hover:bg-accent-50 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
              >
                {t('今天')}
              </button>
              <button
                onClick={navigatePrev}
                className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-background-100 text-foreground-500 transition-colors cursor-pointer"
              >
                <i className="ri-arrow-left-s-line"></i>
              </button>
              <span className="text-sm font-semibold text-foreground-800 w-[200px] flex-shrink-0 text-center whitespace-nowrap">
                {headerLabel}
              </span>
              <button
                onClick={navigateNext}
                className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-background-100 text-foreground-500 transition-colors cursor-pointer"
              >
                <i className="ri-arrow-right-s-line"></i>
              </button>
            </div>

            {/* fixed-width slot so a changing/absent count never shifts the nav arrows (the header is justify-between) */}
            <div className="w-[72px] flex justify-end flex-shrink-0">
              {viewCount > 0 && (
                <span className="px-2.5 py-1 bg-accent-50 text-accent-700 text-xs font-semibold rounded-full whitespace-nowrap">
                  {t('{n} 课时', { n: viewCount })}
                </span>
              )}
            </div>
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

      {viewMode === 'week' && (narrow ? (
        <DayView
          colorOf={colorOf}
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
        ) : (
        <WeekView
          colorOf={colorOf}
          weekDates={weekDates}
          today={today}
          sessionsByDate={sessionsByDate}
          tagLabels={tagLabels}
          tagColorMap={tagColorMap}
          onDateClick={handleDateClick}
        />
      ))}

      {viewMode === 'day' && (
        <DayView
          colorOf={colorOf}
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

/* ============ WEEK VIEW (schedule grid) ============ */

interface WeekViewProps {
  colorOf: (s: SessionRef) => string;
  weekDates: Date[];
  today: Date;
  sessionsByDate: Record<string, SessionRef[]>;
  tagLabels: Record<string, string>;
  tagColorMap: Record<string, string>;
  onDateClick: (year: number, month: number, day: number) => void;   // drill down into that day's view
}

const WEEK_HEAD = ['一', '二', '三', '四', '五', '六', '日'];

/** HH:MM -> minutes since midnight (null when missing/invalid). */
function toMin(x?: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((x || '').trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** Rows of the week grid are derived from the lessons themselves, not from a fixed bell schedule:
 *  every distinct start-end pair this week becomes one equal-height row, ordered by time. Breaks between
 *  slots take no height, and a lesson spanning several slots merges into one block. */
const ROW_H = 138;        // one time-slot row: two-line title + time/place/teacher/credits
const CHIP_H = 40;        // a two-line fragment chip


interface Slot { s: string; e: string; from: number; to: number }

const SHORT_MIN = 30;   // anything shorter than this is a fragment (e.g. a few minutes of recording)

/** Time range of one item; a missing end time is treated as a 45-minute lesson. */
function rangeOf(x: { time?: string; endTime?: string }): { from: number; to: number } | null {
  const st = toMin(x.time);
  if (st == null) return null;
  const en = toMin(x.endTime);
  return { from: st, to: en != null && en > st ? en : st + 45 };
}

/** Build the week's rows. Full-length lessons define the grid; a short fragment only earns its own row
 *  when no lesson's slot already covers it, so a five-minute recording never claims a whole row. */
function buildSlots(items: { time?: string; endTime?: string }[]): Slot[] {
  const withRange = items.map((x) => ({ x, r: rangeOf(x) })).filter((v): v is { x: typeof items[0]; r: { from: number; to: number } } => v.r != null);
  const add = (out: Slot[], x: { time?: string; endTime?: string }, r: { from: number; to: number }) => {
    if (out.some((o) => r.from >= o.from && r.to <= o.to)) return;   // already covered by an existing row
    out.push({ s: x.time as string, e: x.endTime || '', from: r.from, to: r.to });
  };
  const out: Slot[] = [];
  // long lessons first, longest first, so they establish the rows
  withRange.filter(({ r }) => r.to - r.from >= SHORT_MIN)
    .sort((a, b) => (b.r.to - b.r.from) - (a.r.to - a.r.from))
    .forEach(({ x, r }) => add(out, x, r));
  // then fragments that fall outside every existing row
  withRange.filter(({ r }) => r.to - r.from < SHORT_MIN)
    .forEach(({ x, r }) => { if (!out.some((o) => r.from < o.to && r.to > o.from)) add(out, x, r); });
  return out.sort((a, b) => a.from - b.from || a.to - b.to);
}

function WeekView({ weekDates, today, sessionsByDate, tagLabels, tagColorMap, onDateClick, colorOf }: WeekViewProps) {
  const t = useT();
  const drill = (d: Date) => onDateClick(d.getFullYear(), d.getMonth(), d.getDate());   // week → that day's view
  const cols = weekDates.map((d) => {
    const key = formatDate(d.getFullYear(), d.getMonth(), d.getDate());
    return { d, key, list: sessionsByDate[key] ?? [] };
  });
  const isToday = (d: Date) =>
    d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();

  // Rows come from the lessons actually scheduled this week
  const used = cols.flatMap((c) => c.list);
  const rows = buildSlots(used);
  /** Which rows a lesson covers: any slot overlapping its real time range. */
  const rowSpan = (x: { time?: string; endTime?: string }) => {
    const r = rangeOf(x);
    if (!r) return null;
    const idx = rows.map((row, i) => ({ row, i })).filter(({ row }) => row.from < r.to && row.to > r.from).map(({ i }) => i);
    return idx.length ? { first: idx[0], last: idx[idx.length - 1] } : null;
  };
  /** Lay out one day's items. Full lessons sharing a row split the width; a short fragment never squeezes
   *  them -- it rides along the bottom of the row as a compact chip (or fills the row when it is alone).
   *  Rows hosting chips grow taller instead of squashing the lesson card. */
  const placeDay = (list: SessionRef[]) => {
    const withSpan = list
      .map((s) => {
        const span = rowSpan(s);
        const r = rangeOf(s);
        return span && r ? { s, span, short: r.to - r.from < SHORT_MIN } : null;
      })
      .filter((v): v is { s: SessionRef; span: { first: number; last: number }; short: boolean } => v != null);

    const longByRow = new Map<number, number>();
    withSpan.filter((v) => !v.short).forEach((v) => longByRow.set(v.span.first, (longByRow.get(v.span.first) ?? 0) + 1));
    const seenLong = new Map<number, number>();
    const fragByRow = new Map<number, number>();
    withSpan.filter((v) => v.short).forEach((v) => fragByRow.set(v.span.first, (fragByRow.get(v.span.first) ?? 0) + 1));
    const seenFrag = new Map<number, number>();

    return withSpan.map((v) => {
      if (!v.short) {
        const n = longByRow.get(v.span.first) ?? 1;
        const i = seenLong.get(v.span.first) ?? 0;
        seenLong.set(v.span.first, i + 1);
        return { ...v, lane: i, lanes: n, chip: false };
      }
      const alone = (longByRow.get(v.span.first) ?? 0) === 0;
      const n = fragByRow.get(v.span.first) ?? 1;
      const i = seenFrag.get(v.span.first) ?? 0;
      seenFrag.set(v.span.first, i + 1);
      return { ...v, lane: i, lanes: n, chip: !alone };
    });
  };

  // How many chips each row must host (worst day), so every column keeps the same row geometry
  const chipsPerRow = new Map<number, number>();
  cols.forEach((c) => {
    const per = new Map<number, number>();
    placeDay(c.list).filter((x) => x.chip).forEach((x) => per.set(x.span.first, (per.get(x.span.first) ?? 0) + 1));
    per.forEach((n, row) => chipsPerRow.set(row, Math.max(chipsPerRow.get(row) ?? 0, n)));
  });
  const rowH = rows.map((_, i) => ROW_H + (chipsPerRow.get(i) ?? 0) * (CHIP_H + 2));
  const rowTop = rowH.reduce<number[]>((acc, h, i) => [...acc, (acc[i - 1] ?? 0) + (rowH[i - 1] ?? 0)], []);
  const totalH = rowH.reduce((a, b) => a + b, 0);
  /** Pixel span of rows [first..last]. */
  const boxOf = (first: number, last: number) => ({
    top: rowTop[first] ?? 0,
    height: rowH.slice(first, last + 1).reduce((a, b) => a + b, 0),
  });

  return (
    <div className="p-4 overflow-x-auto">
      <div className="min-w-[780px]">
        {/* Header: weekday + date, today emphasized */}
        <div className="grid" style={{ gridTemplateColumns: '62px repeat(7, 1fr)' }}>
          <div></div>
          {cols.map((c, i) => (
            <button key={c.key} type="button" onClick={() => drill(c.d)} className="p-0 pb-2 text-center cursor-pointer group bg-transparent" title={t('查看这一天')}>
              <div className={`text-[13px] ${isToday(c.d) ? 'text-foreground-700 font-semibold' : 'text-foreground-400'}`}>
                {t('周{w}', { w: t(WEEK_HEAD[i]) })}
              </div>
              <div className={`text-[15px] font-bold mt-1 mx-auto w-8 h-8 flex items-center justify-center rounded-full transition-colors ${
                isToday(c.d) ? 'bg-accent-500 text-background-50' : 'text-foreground-500 group-hover:bg-background-100'
              }`}>
                {c.d.getDate()}
              </div>
            </button>
          ))}
        </div>

        {used.length === 0 ? (
          <div className="py-16 text-center text-sm text-foreground-400">{t('本周暂无课程。请切换到有课程的周,或导入课表。')}</div>
        ) : (
          <div className="grid" style={{ gridTemplateColumns: '62px repeat(7, 1fr)' }}>
            {/* Period ruler: number on top, start/end time under it */}
            <div>
              {rows.map((p, i) => (
                <div key={`${p.s}-${p.e}-${i}`} className="flex flex-col items-center justify-center border-t border-background-100"
                     style={{ height: rowH[i] }}>
                  {/* Times only -- not every timetable is organised into numbered periods */}
                  <span className="text-[13px] font-mono font-semibold text-foreground-600 leading-none tabular-nums">{p.s}</span>
                  {p.e && <><span className="text-[10px] text-foreground-300 leading-none my-[3px]">|</span>
                  <span className="text-[13px] font-mono text-foreground-400 leading-none tabular-nums">{p.e}</span></>}
                </div>
              ))}
            </div>
            {/* One column per day: lessons are integer rectangles over the period grid */}
            {cols.map((c) => (
              <div key={c.key} className="relative border-l border-background-100" style={{ height: totalH }}>
                {rows.map((p, i) => (
                  <div key={`${p.s}-${p.e}-${i}`} className="absolute left-0 right-0 border-t border-background-100"
                       style={{ top: rowTop[i] }}></div>
                ))}
                <button onClick={() => drill(c.d)} className="absolute inset-0 w-full h-full hover:bg-background-100/40 cursor-pointer" aria-label={t('查看这一天')} />
                {(() => { const placed = placeDay(c.list);
                  return placed.map(({ s, span, lane, lanes, short, chip }) => {
                  const box = boxOf(span.first, span.last);
                  const top = box.top;
                  const h = box.height;
                  const chipRoom = (chipsPerRow.get(span.first) ?? 0) * (CHIP_H + 2);
                  const w = 100 / lanes;
                  const info = [s.title, s.endTime ? `${s.time}-${s.endTime}` : s.time, s.duration, s.place || '未填', s.teacher, s.credits ? `${s.credits} 学分` : ''].filter(Boolean).join(' · ');
                  // A few-minute recording alongside a lesson: show it as a slim chip pinned to the row's foot
                  if (chip) {
                    return (
                      <button
                        key={s.id}
                        onClick={() => drill(c.d)}
                        style={{ top: top + h - chipRoom + 2 + lane * (CHIP_H + 2), height: CHIP_H }}
                        className={`absolute z-10 left-1.5 right-1.5 px-2 py-1 rounded-md border shadow-sm cursor-pointer hover:brightness-95 text-left ${colorOf(s)}`}
                        title={info}
                      >
                        <div className="text-[11.5px] font-medium leading-tight truncate">
                          <i className="ri-mic-line mr-1"></i>{s.title}
                        </div>
                        <div className="text-[11px] font-mono leading-tight opacity-80 truncate">
                          {s.endTime ? `${s.time}-${s.endTime}` : s.time}
                          {s.duration && <span className="opacity-75"> · {s.duration}</span>}
                        </div>
                      </button>
                    );
                  }
                  return (
                    <button
                      key={s.id}
                      onClick={() => drill(c.d)}
                      style={{ top: top + 5, height: h - 10 - chipRoom, left: `calc(${lane * w}% + 6px)`, width: `calc(${w}% - 12px)` }}
                      className={`absolute overflow-hidden text-left px-2 py-1.5 rounded-lg border shadow-sm cursor-pointer hover:brightness-95 flex flex-col justify-center gap-0.5 ${colorOf(s)}`}
                      title={info}
                    >
                      <div className="text-[14px] font-semibold leading-snug line-clamp-2">
                        {s.id.startsWith('mtg-') && <i className="ri-translate-2 mr-0.5"></i>}{s.title}
                      </div>
                      <div className="text-[12.5px] opacity-90 leading-snug truncate">
                        <span className="opacity-70">{t('时间：')}</span>
                        <span className="font-mono">{s.endTime ? `${s.time}-${s.endTime}` : s.time}</span>
                        {short && s.duration && <span className="ml-1 opacity-75">({s.duration})</span>}
                      </div>
                      <div className="text-[12.5px] opacity-90 leading-snug truncate">
                        <span className="opacity-70">{t('地点：')}</span>
                        {s.place || <span className="opacity-50">{t('未填')}</span>}
                      </div>
                      {s.teacher && (
                        <div className="text-[12.5px] opacity-90 leading-snug truncate">
                          <span className="opacity-70">{t('老师：')}</span>{s.teacher}
                        </div>
                      )}
                      {s.credits && (
                        <div className="text-[12.5px] opacity-90 leading-snug truncate">
                          <span className="opacity-70">{t('学分：')}</span>{s.credits}
                        </div>
                      )}
                    </button>
                  );
                }); })()}
              </div>
            ))}
          </div>
        )}
      </div>
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
  const t = useT();
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
                <span className="text-xs font-semibold text-foreground-700">{t(monthLabel)}</span>
                {count > 0 && (
                  <span className="px-1.5 py-0.5 bg-accent-100 text-accent-700 text-[10px] font-semibold rounded-full">
                    {count}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-7 gap-px">
                {['日','一','二','三','四','五','六'].map((w) => (
                  <span key={w} className="text-center text-[9px] text-foreground-300 leading-4">{t(w)}</span>
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
                {t('还有 {n} 节课...', { n: sessionsByDate[hoveredDate].length - 3 })}
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
  const t = useT();
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
          <div key={wd} className="text-center text-xs font-medium text-foreground-400 py-1.5">{t(wd)}</div>
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
              className={`relative flex flex-col items-start p-1 sm:p-1.5 h-[96px] sm:h-[150px] rounded-lg transition-all cursor-pointer group border text-left overflow-hidden ${
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
                {daySessions.slice(0, 3).map((session) => {
                  const displayTitle = session.title
                    .replace(/^第\d+讲：/, '')
                    .replace(/^补课：/, '')
                    .replace(/^虚拟实验室：/, '');

                  return (
                    <div key={session.id} className="space-y-0.5">
                      <div
                        title={[session.title,
                                session.endTime ? `${session.time}-${session.endTime}` : session.time,
                                session.place, session.teacher,
                                session.credits ? `${session.credits} 学分` : ''].filter(Boolean).join(' · ')}
                        className={`px-1 py-0.5 rounded text-[10px] leading-tight ${bgClass} bg-background-50/60`}>
                        <div className="flex items-center gap-1">
                          <span className={`w-1 h-1 rounded-full ${dotClass} flex-shrink-0`}></span>
                          <span className={`truncate font-medium ${textClass}`}>
                            {session.id.startsWith('mtg-') && <i className="ri-translate-2 mr-0.5"></i>}{displayTitle}
                          </span>
                        </div>
                        {(session.time || session.teacher) && (
                          <div className="flex items-center gap-1.5 pl-2 text-[9px] text-foreground-400 truncate">
                            {session.time && (
                              <span className="font-mono">{session.endTime ? `${session.time}-${session.endTime}` : session.time}</span>
                            )}
                            {session.teacher && <span className="truncate">{session.teacher}</span>}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
                {daySessions.length > 3 && (
                  <span className={`text-[9px] font-medium px-1 ${textClass}`}>
                    {t('+{n} 更多', { n: daySessions.length - 3 })}
                  </span>
                )}
              </div>

              {!hasSessions && (
                <span className="absolute opacity-0 group-hover:opacity-100 text-[10px] text-foreground-300 transition-opacity bottom-1.5 right-1.5">
                  {t('+ 新建')}
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
  /** Same coloring rule as the week grid, so the 课表配色 setting applies here too */
  colorOf: (s: SessionRef) => string;
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
  currentSessions, tagLabels, tagColorMap, onSelectSession, onCreateSession, colorOf,
}: DayViewProps) {
  const t = useT();
  const isToday = viewYear === today.getFullYear() && viewMonth === today.getMonth() && viewDay === today.getDate();
  const weekDay = WEEKDAYS[new Date(viewYear, viewMonth, viewDay).getDay()];

  const timeSlots = [
    { label: '上午 08:00 - 10:00', range: '08' },
    { label: '上午 10:00 - 12:00', range: '10' },
    { label: '下午 13:00 - 15:00', range: '13' },
    { label: '下午 15:00 - 17:00', range: '15' },
    { label: '晚间 18:00 - 21:00', range: '18' },
  ];

  // Assign each session to the last slot whose start hour <= the session's hour, so sessions at any time are shown (none dropped);
  // sessions before the first slot go to the first slot, those after the last slot's start go to the last slot (evening covers 18:00 and later).
  const slotHours = timeSlots.map((s) => parseInt(s.range, 10));
  const slotIndexOf = (hour: number) => {
    let idx = 0;
    for (let i = 0; i < slotHours.length; i++) if (hour >= slotHours[i]) idx = i;
    return idx;
  };
  const sessionTimeSlots = timeSlots
    .map((slot, i) => ({
      ...slot,
      sessions: currentSessions.filter((s) => slotIndexOf(parseInt(s.time.split(':')[0], 10)) === i),
    }))
    .filter((slot) => slot.sessions.length > 0);

  const filledIdx = new Set(
    currentSessions.map((s) => slotIndexOf(parseInt(s.time.split(':')[0], 10)))
  );
  const emptySlots = timeSlots.filter((_, i) => !filledIdx.has(i));

  const getSessionColor = (session: SessionRef): string => {
    const firstTag = session.tags[0];
    return tagColorMap[firstTag] ?? 'accent';
  };

  return (
    <div className="p-5 max-h-[600px] overflow-y-auto">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h4 className="text-base font-bold text-foreground-800">
            {t('{y}年{m}月{d}日', { y: viewYear, m: viewMonth + 1, d: viewDay })} <span className="text-sm font-normal text-foreground-400">{t('星期{w}', { w: t(weekDay) })}</span>
          </h4>
          {isToday && (
            <span className="inline-block mt-1 px-2 py-0.5 bg-primary-100 text-primary-700 text-[10px] font-semibold rounded-full">{t('今天')}</span>
          )}
        </div>
        <button
          onClick={onCreateSession}
          className="flex items-center gap-1.5 px-4 py-2 bg-accent-500 text-background-50 rounded-xl text-xs font-semibold hover:bg-accent-600 transition-colors cursor-pointer whitespace-nowrap"
        >
          <i className="ri-add-line"></i>
          {t('新建课时')}
        </button>
      </div>

      {currentSessions.length === 0 ? (
        <div className="text-center py-12">
          <div className="w-16 h-16 mx-auto flex items-center justify-center bg-background-100 rounded-2xl mb-3">
            <i className="ri-calendar-check-line text-foreground-300 text-2xl"></i>
          </div>
          <p className="text-sm text-foreground-400 mb-3">{t('当天暂无课程记录')}</p>
          <button
            onClick={onCreateSession}
            className="px-4 py-2 bg-accent-500 text-background-50 rounded-xl text-xs font-semibold hover:bg-accent-600 transition-colors cursor-pointer whitespace-nowrap"
          >
            {t('创建课时')}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {sessionTimeSlots.map((slot) => (
            <div key={slot.range}>
              <div className="flex items-center gap-2 mb-2">
                <div className="w-2 h-2 rounded-full bg-accent-400 flex-shrink-0"></div>
                <span className="text-xs font-medium text-foreground-400">{t(slot.label)}</span>
              </div>
              <div className="space-y-3 pl-4">
                {slot.sessions.map((session) => {
                  const color = getSessionColor(session);
                  const palette = colorOf(session);   // 课表配色: per course, or shaded by credits
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
                      {/* Color accent top bar -- follows the 课表配色 setting */}
                      <div className={`h-1.5 w-full ${palette.split(' ').find((c) => c.startsWith('bg-')) ?? barClass}`}></div>

                      <div className="p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            {/* Meta row */}
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-1.5">
                              <span className={`text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap border ${palette}`}>
                                {session.endTime ? `${session.time}-${session.endTime}` : session.time}
                              </span>
                              <span className="text-xs text-foreground-400">{session.duration}</span>
                              {session.place && (
                                <span className="flex items-center gap-1 text-xs text-foreground-400 whitespace-nowrap">
                                  <i className="ri-map-pin-line"></i>{session.place}
                                </span>
                              )}
                              {session.teacher && (
                                <span className="flex items-center gap-1 text-xs text-foreground-400 whitespace-nowrap">
                                  <i className="ri-user-line"></i>{session.teacher}
                                </span>
                              )}
                              {session.credits && (
                                <span className="flex items-center gap-1 text-xs text-foreground-400 whitespace-nowrap">
                                  <i className="ri-award-line"></i>{t('{n} 学分', { n: session.credits })}
                                </span>
                              )}
                              {(session.keyPoints?.length ?? 0) > 0 && (
                                <span className="flex items-center gap-1 whitespace-nowrap">
                                  <span className={`w-1 h-1 rounded-full ${dotClass}`}></span>
                                  <span className="text-xs text-foreground-400">{t('{n} 个重点', { n: session.keyPoints?.length ?? 0 })}</span>
                                </span>
                              )}
                            </div>

                            {/* Title */}
                            <h5 className="text-sm font-semibold text-foreground-800 mb-1.5">
                              {session.id.startsWith('mtg-') && <i className="ri-translate-2 mr-1 text-accent-500"></i>}{session.title}
                            </h5>

                            {/* Tag chip (label carried by imported courses) */}
                            {session.tags[0] && tagLabels[session.tags[0]] && (
                              <span className={`inline-flex items-center gap-1 mb-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium ${textClass} ${bgClass}`}>
                                <span className={`w-1.5 h-1.5 rounded-full ${dotClass}`}></span>
                                {tagLabels[session.tags[0]]}
                              </span>
                            )}

                            {/* Description */}
                            <p className="text-xs text-foreground-400 mb-2">{session.description}</p>

                            {/* Summary */}
                            <div className={`${bgClass} rounded-lg p-3 mb-2.5`}>
                              <p className="text-xs font-medium text-foreground-500 mb-1 flex items-center gap-1">
                                <div className="w-4 h-4 flex items-center justify-center">
                                  <i className="ri-magic-line text-[10px]"></i>
                                </div>
                                {t('AI摘要')}
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
              <p className="text-xs text-foreground-300 mb-2">{t('空闲时段')}</p>
              <div className="flex flex-wrap gap-2">
                {emptySlots.slice(0, 4).map((slot) => (
                  <button
                    key={slot.range}
                    onClick={onCreateSession}
                    className="px-3 py-1.5 bg-background-100 rounded-lg text-xs text-foreground-400 hover:bg-accent-50 hover:text-accent-600 transition-colors cursor-pointer whitespace-nowrap"
                  >
                    {t(slot.label)}
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