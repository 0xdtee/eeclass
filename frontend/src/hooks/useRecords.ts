/**
 * Reads real class records from the server (records\ directory), replacing the mock data in mocks/courseData.ts.
 *
 * Each class is a directory on the server: transcript.jsonl (per sentence), meta.json (duration/speakers/RTF),
 * audio.wav, and edits.jsonl (which sentences were edited, used to build the real edit history).
 */
import { useCallback, useEffect, useState } from 'react';
import { SERVICE_ORIGIN, getToken, authFailed } from '@/hooks/useLiveCaption';
import type { Syllabus } from '@/lib/exportSyllabus';

export interface SessionMeta {
  id: string;
  dir: string;
  title?: string | null;
  duration_s?: number;
  lines?: number;
  rtf?: number;
  backend?: string;
  streaming?: boolean;
  speakers?: { id: number; name: string; seconds: number; utterances: number }[];
  /** Saved AI summary (if present, this class already has notes) */
  summary?: string;
  key_points?: string[];
  has_summary?: boolean;
  /** Tags on this class (tag-name strings, from the backend) */
  tags?: string[];
}

export interface ScheduleCourse {
  name: string;
  day: number;        // 1=Monday … 7=Sunday
  start: string;      // HH:MM
  end: string;
  location: string;
  room: string;
}

/** Course events with concrete dates (not weekly-recurring, just whatever was imported) */
export interface ScheduleEvent {
  name: string;
  date: string;       // YYYY-MM-DD
  start: string;
  end: string;
  location: string;
  room: string;
  tag?: string;       // This course's tag (stored as label); on image import, auto-matched to an existing one by course name / created if none
}

export interface CourseSummary {
  summary: string;
  key_points: string[];
  chapters: { title: string; points: string[] }[];
  sessions?: number;
  at?: string;
  error?: string;
  no_transcript?: boolean;
  ai_only?: boolean;
}
export interface ExamRef {
  sid: string;
  ts: string;
  start: number;
  text: string;
}
export interface ExamPoint {
  name: string;
  probability: number;
  reason: string;
  detail: string;
  refs?: ExamRef[];
}
export interface CourseExam {
  points: ExamPoint[];
  sessions?: number;
  at?: string;
  error?: string;
  no_transcript?: boolean;
  ai_only?: boolean;
}
export interface MockQuestion {
  type: string;
  question: string;
  answer: string;
  point?: string;
}
export interface CourseMock {
  questions: MockQuestion[];
  sessions?: number;
  at?: string;
  error?: string;
  no_transcript?: boolean;
  ai_only?: boolean;
}

export interface SavedSummary {
  summary?: string;
  key_points?: string[];
  corrections?: string[];
  applied?: string[];
  at?: string;
}

export interface TranscriptLine {
  id: number;
  ts: string;
  speaker: string;
  speaker_id: number;
  text: string;
  kind: 'key' | 'define' | null;
  new_para: boolean;
  edited?: boolean;
  /** Chinese subtitle for an English sentence (shown underneath) */
  translation?: string;
  /** Seconds relative to class start, used to jump the audio when a timestamp is clicked */
  start?: number;
  end?: number;
}

export interface EditRecord {
  at: string;
  line_id: number;
  before: string;
  after: string;
  by: string;
  ts: string;
}

export interface ShareInfo {
  id: string;
  sid: string;
  created: string;
  allow_download: boolean;
  revoked: boolean;
}

export interface VoiceCluster {
  sid: string;            // Representative session (for preview)
  idx: number;            // Speaker index within the representative session
  sample_start: number;   // Preview start point (seconds)
  name: string;           // Current display name (teacher/student N)
  seconds: number;        // This person's cumulative duration
  count: number;          // How many segments were merged
  sessions: number;       // In how many classes they appear
  embedding: number[];    // Merged voiceprint center (stored on tagging)
}

export interface OfficialSchool {
  id: string;
  name: string;
  items: { course: string; title: string; source_page: string; note: string; kind: 'pdf' | 'page' }[];
}

/** Direct link to the official syllabus PDF (with token, can be fed straight to an iframe) */
export function officialPdfUrl(schoolId: string, course: string): string {
  return `${SERVICE_ORIGIN}/api/syllabus/official/${encodeURIComponent(schoolId)}/${encodeURIComponent(course)}?token=${encodeURIComponent(getToken())}`;
}

/** Proxied direct link to the web version of the official syllabus (HTML with base injected, can be fed straight to an iframe) */
export function officialPageUrl(schoolId: string, course: string): string {
  return `${SERVICE_ORIGIN}/api/syllabus/page/${encodeURIComponent(schoolId)}/${encodeURIComponent(course)}?token=${encodeURIComponent(getToken())}`;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(SERVICE_ORIGIN + path, {
    ...init,
    headers: { 'Content-Type': 'application/json', 'X-Token': getToken(), ...(init?.headers ?? {}) },
  });
  if (r.status === 401 || r.status === 403) authFailed();
  const j = await r.json();
  if (!r.ok) throw new Error((j as { error?: string }).error || `HTTP ${r.status}`);
  return j as T;
}

/** Course name is taken from the directory name: 2026-07-29_0936_高等数学 -> 高等数学 */
export function sessionTitle(s: SessionMeta) {
  if (s.title) return s.title;
  const m = s.id.match(/^\d{4}-\d{2}-\d{2}_\d{4}_(.+)$/);
  return m ? m[1] : '未命名课程';
}

export function sessionDate(s: SessionMeta) {
  const m = s.id.match(/^(\d{4}-\d{2}-\d{2})_(\d{2})(\d{2})/);
  return m ? `${m[1]} ${m[2]}:${m[3]}` : s.id;
}

export function fmtDuration(sec?: number) {
  const s = Math.round(sec ?? 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}小时${m}分`;
  return m > 0 ? `${m}分${s % 60}秒` : `${s}秒`;
}

export function useRecords() {
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const j = await api<{ sessions: SessionMeta[] }>('/api/sessions');
      setSessions(j.sessions);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const loadTranscript = useCallback(
    (sid: string) => api<{ dir: string; lines: TranscriptLine[] }>(`/api/transcript/${encodeURIComponent(sid)}`),
    []
  );

  const editLine = useCallback(
    (sid: string, lineId: number, text: string) =>
      api<{ ok: boolean; edit?: EditRecord }>(`/api/transcript/${encodeURIComponent(sid)}/edit`, {
        method: 'POST',
        body: JSON.stringify({ line_id: lineId, text }),
      }),
    []
  );

  const loadEdits = useCallback(
    (sid: string) => api<{ edits: EditRecord[] }>(`/api/transcript/${encodeURIComponent(sid)}/edits`),
    []
  );

  const loadSummary = useCallback(
    (sid: string) => api<SavedSummary>(`/api/transcript/${encodeURIComponent(sid)}/summary`),
    []
  );

  const saveSummary = useCallback(
    (sid: string, data: SavedSummary) =>
      api<{ ok: boolean } & SavedSummary>(`/api/transcript/${encodeURIComponent(sid)}/summary`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    []
  );

  /** Read/write class notes (one per class) */
  const loadNote = useCallback(
    (sid: string) => api<{ note: string }>(`/api/transcript/${encodeURIComponent(sid)}/note`),
    []
  );
  const saveNote = useCallback(
    (sid: string, note: string) =>
      api<{ ok: boolean }>(`/api/transcript/${encodeURIComponent(sid)}/note`, {
        method: 'POST',
        body: JSON.stringify({ note }),
      }),
    []
  );

  /** Manually mark a sentence as key point (key)/definition (define)/clear (null), stored in marks.json */
  const markLine = useCallback(
    (sid: string, lineId: number, kind: 'key' | 'define' | null) =>
      api<{ ok: boolean }>(`/api/transcript/${encodeURIComponent(sid)}/mark`, {
        method: 'POST',
        body: JSON.stringify({ line_id: lineId, kind }),
      }),
    []
  );

  /** Rename a speaker after recording: override by speaker_id, changing every sentence of that person; also records the voiceprint into the voiceprint library */
  const renameSpeaker = useCallback(
    (sid: string, speakerId: number, name: string) =>
      api<{ ok: boolean; learned_voiceprint: boolean }>(`/api/transcript/${encodeURIComponent(sid)}/speaker`, {
        method: 'POST',
        body: JSON.stringify({ speaker_id: speakerId, name }),
      }),
    []
  );

  /** Voiceprints: list voices from past recordings — the same person is already clustered into one entry (computed on first call, may take ten-plus seconds) */
  const listVoices = useCallback(
    () => api<{
      clusters: VoiceCluster[];
      recognized: { name: string; count: number }[];
      library: { id: string; name: string }[];
    }>('/api/voices'),
    []
  );
  /** Tag a voice (a cluster center) and store it in the library */
  const addVoiceprint = useCallback(
    (body: { name: string; embedding?: number[]; sid?: string; idx?: number }) =>
      api<{ ok: boolean; id: string; name: string }>('/api/voiceprints', {
        method: 'POST', body: JSON.stringify(body),
      }),
    []
  );
  const deleteVoiceprint = useCallback(
    (id: string) => api<{ ok: boolean }>(`/api/voiceprints/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    []
  );

  /** Timetable screenshot → local OCR + DeepSeek course extraction + this week's real Monday date (may take ten-plus seconds) */
  const importTimetable = useCallback(
    (imageDataUrl: string) =>
      api<{ courses: ScheduleCourse[]; anchor_monday?: string; error?: string }>('/api/import/timetable', {
        method: 'POST',
        body: JSON.stringify({ image: imageDataUrl }),
      }),
    []
  );

  /** Reference material: course syllabus */
  const listSyllabus = useCallback(() => api<{ courses: { name: string; official: boolean }[] }>('/api/syllabus'), []);
  const getSyllabus = useCallback(
    (name: string) => api<Syllabus>(`/api/syllabus/${encodeURIComponent(name)}`),
    []
  );
  /** Reference material: official syllabus PDF catalog by school */
  const listSchools = useCallback(() => api<{ schools: OfficialSchool[] }>('/api/syllabus/schools'), []);

  /** SHU academic-affairs system auto-login + timetable fetch (takes about 15-25 seconds) */
  const importShu = useCallback(
    (username: string, password: string) =>
      api<{ events: ScheduleEvent[]; note?: string; error?: string }>('/api/import/shu', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      }),
    []
  );

  /** Save/read dated course events (persisted, survives refresh; whole-table overwrite, with the frontend doing the merge/dedup before sending the full set) */
  const saveSchedule = useCallback(
    (events: ScheduleEvent[]) =>
      api<{ ok: boolean; count: number }>('/api/schedule', {
        method: 'POST',
        body: JSON.stringify({ events }),
      }),
    []
  );
  const loadSchedule = useCallback(
    () => api<{ events: ScheduleEvent[] }>('/api/schedule'),
    []
  );

  /**
   * Course-level AI analysis. Two aggregation modes:
   *  - By course name (collection of same-named classes): pass tag empty, uses { name } (original behavior, unchanged).
   *  - By tag (all recordings with that tag): pass tag, uses { tag }.
   * Server-side cached; refresh forces recomputation.
   */
  const courseBody = (name: string, refresh: boolean, aiOnly: boolean, tag?: string) =>
    JSON.stringify(tag ? { tag, refresh, ai_only: aiOnly } : { name, refresh, ai_only: aiOnly });
  const courseSummary = useCallback(
    (name: string, refresh = false, aiOnly = false, tag?: string) =>
      api<CourseSummary>('/api/course/summary', { method: 'POST', body: courseBody(name, refresh, aiOnly, tag) }),
    []
  );
  const courseExam = useCallback(
    (name: string, refresh = false, aiOnly = false, tag?: string) =>
      api<CourseExam>('/api/course/exam', { method: 'POST', body: courseBody(name, refresh, aiOnly, tag) }),
    []
  );
  const courseMock = useCallback(
    (name: string, refresh = false, aiOnly = false, tag?: string) =>
      api<CourseMock>('/api/course/mock', { method: 'POST', body: courseBody(name, refresh, aiOnly, tag) }),
    []
  );

  /** Set/replace tags on a recording (whole-table overwrite, pass the full array of tag names) */
  const setSessionTags = useCallback(
    (sid: string, sessionTags: string[]) =>
      api<{ ok: boolean; tags: string[] }>(`/api/sessions/${encodeURIComponent(sid)}/tags`, {
        method: 'POST',
        body: JSON.stringify({ tags: sessionTags }),
      }),
    []
  );

  /** Personalized feedback loop: learn the terms the user corrected, so later classes auto-correct this homophone error */
  const learnTerm = useCallback(
    (term: string) =>
      api<{ ok: boolean; added: boolean; count: number }>('/api/terms/learn', {
        method: 'POST',
        body: JSON.stringify({ term }),
      }),
    []
  );

  const createShare = useCallback(
    (sid: string, allowDownload = true) =>
      api<ShareInfo>('/api/share', {
        method: 'POST',
        body: JSON.stringify({ sid, allow_download: allowDownload }),
      }),
    []
  );

  const revokeShare = useCallback(
    (key: string) => api<{ ok: boolean }>(`/api/share/${encodeURIComponent(key)}/revoke`, { method: 'POST' }),
    []
  );

  return { sessions, loading, error, reload, loadTranscript, editLine, loadEdits, loadSummary, saveSummary, loadNote, saveNote, markLine, renameSpeaker, learnTerm, importTimetable, importShu, saveSchedule, loadSchedule, listSyllabus, getSyllabus, listSchools, listVoices, addVoiceprint, deleteVoiceprint, courseSummary, courseExam, courseMock, setSessionTags, createShare, revokeShare };
}

/** Share link (for others to open, no token required) */
export function shareUrl(key: string) {
  return `${SERVICE_ORIGIN}/app/shared/${key}`;
}
