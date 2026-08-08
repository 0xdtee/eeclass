import { useState, useCallback, useEffect } from 'react';
import { apiFetch } from '@/lib/api';

// The fields returned by the backend don't exactly match this app's types, so adapt them here.
function fmtDuration(sec?: number): string {
  const s = Math.floor(sec || 0);
  if (s < 60) return `${s}秒`;
  const m = Math.floor(s / 60);
  return s % 60 ? `${m}分${s % 60}秒` : `${m}分钟`;
}
function titleOf(sid: string, title?: string): string {
  return (title && title.trim()) || sid.replace(/^\d{4}-\d{2}-\d{2}_\d{4}_?/, '') || sid;
}
// Each backend /api/sessions entry: { id, title, duration_s, owner, lines, summary?, key_points?, ... }
function adaptSession(s: Record<string, unknown>): SessionRecord {
  const sid = (s.id ?? s.sid) as string;
  return {
    sid,
    title: titleOf(sid, s.title as string | undefined),
    date: sid.slice(0, 10),
    duration: fmtDuration(s.duration_s as number),
    course_id: s.course_id as string | undefined,
    tags: (s.tags as string[]) || [],
    summary: s.summary as string | undefined,
    key_points: s.key_points as string[] | undefined,
  };
}

// ── types ──
export interface SessionRecord {
  sid: string;
  title: string;
  date: string;
  duration: string;
  course_id?: string;
  tags: string[];
  summary?: string;
  key_points?: string[];
}

export interface TranscriptionLine {
  line_id: number;
  ts: string;
  start: number;
  end: number;
  speaker: string;
  text: string;
}

export interface SessionDetail {
  sid: string;
  title: string;
  date: string;
  duration: string;
  course_id?: string;
  tags: string[];
  transcription: TranscriptionLine[];
  summary?: string;
  key_points?: string[];
  shots?: ShotRecord[];
}

export interface Course {
  id: string;
  name: string;
  color: string;
  session_ids: string[];
  hotwords: string;
  corrections: CorrectionRule[];
}

export interface CorrectionRule {
  from: string;
  to: string;
  enabled: boolean;
}

export interface SearchResult {
  sid: string;
  title: string;
  date: string;
  line_id: number;
  ts: string;
  start: number;
  speaker: string;
  text: string;
  kind: string;
}

export interface SearchResponse {
  results: SearchResult[];
  total: number;
}

export interface StudyResponse {
  flashcards: Flashcard[];
  quiz: QuizItem[];
}

export interface Flashcard {
  front: string;
  back: string;
  ts: string;
  start: number;
}

export interface QuizItem {
  question: string;
  options: string[];
  answer: number;
  why: string;
  ts: string;
  start: number;
}

export interface AskResponse {
  answer: string;
  cites: Cite[];
  corrections?: CorrectionSuggestion[];
}

export interface Cite {
  line_id: number;
  ts: string;
  start: number;
  text: string;
}

export interface CorrectionSuggestion {
  from: string;
  to: string;
  line_id: number;
}

export interface ShotRecord {
  id: string;
  url: string;
  at: number;
  ts: string;
  note?: string;
}

export interface ShotsResponse {
  shots: ShotRecord[];
}

// ── hooks ──

// List all sessions
export function useSessions() {
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await apiFetch<{ sessions: Record<string, unknown>[] }>('/api/sessions');
      setSessions((data.sessions || []).map(adaptSession));
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  return { sessions, loading, error, refresh: fetchAll };
}

// Single session detail (with transcription lines)
export function useSessionDetail(sid: string | null) {
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fetch = useCallback(async () => {
    if (!sid) return;
    setLoading(true);
    setError('');
    try {
      const enc = encodeURIComponent(sid);
      // Transcript body
      const t = await apiFetch<{ dir: string; lines: Record<string, unknown>[] }>(`/api/transcript/${enc}`);
      // Summary (may not exist, ignore errors)
      let summary: string | undefined;
      let key_points: string[] | undefined;
      try {
        const s = await apiFetch<{ summary?: string; key_points?: string[] }>(`/api/transcript/${enc}/summary`);
        summary = s.summary; key_points = s.key_points;
      } catch { /* no summary was ever saved */ }
      // Whiteboard shots (may not exist)
      let shots: ShotRecord[] | undefined;
      try {
        const sh = await apiFetch<ShotsResponse>(`/api/shots/${enc}`);
        shots = sh.shots;
      } catch { /* ignore */ }
      setDetail({
        sid,
        title: titleOf(sid),
        date: sid.slice(0, 10),
        duration: '',
        tags: [],
        transcription: (t.lines || []).map((l) => ({
          line_id: l.id as number,
          ts: (l.ts as string) || '',
          start: (l.start as number) || 0,
          end: (l.end as number) || 0,
          speaker: (l.speaker as string) || '',
          text: (l.text as string) || '',
        })),
        summary, key_points, shots,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [sid]);

  useEffect(() => { fetch(); }, [fetch]);

  return { detail, loading, error, refresh: fetch };
}

// Search across courses
export function useSearch() {
  const [results, setResults] = useState<SearchResult[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const search = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      setTotal(0);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const data = await apiFetch<SearchResponse>(`/api/search?q=${encodeURIComponent(q)}&limit=50`);
      setResults(data.results || []);
      setTotal(data.total || 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : '搜索失败');
    } finally {
      setLoading(false);
    }
  }, []);

  return { results, total, loading, error, search };
}

// Study - flashcards / quiz
export function useStudy() {
  const [data, setData] = useState<StudyResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const generate = useCallback(async (sid: string, mode: 'flashcards' | 'quiz') => {
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch<StudyResponse>('/api/study', {
        method: 'POST',
        body: JSON.stringify({ sid, mode }),
      });
      setData(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : '生成失败');
    } finally {
      setLoading(false);
    }
  }, []);

  return { data, loading, error, generate, clear: () => setData(null) };
}

// Ask (chat with context)
export function useAskStream() {
  const [answer, setAnswer] = useState('');
  const [cites, setCites] = useState<Cite[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const ask = useCallback(async (sid: string, question: string, history: { role: string; content: string }[]) => {
    setLoading(true);
    setError('');
    setAnswer('');
    setCites([]);
    try {
      const res = await apiFetch<AskResponse>('/api/ask', {
        method: 'POST',
        body: JSON.stringify({ sid, question, history }),
      });
      setAnswer(res.answer || '');
      setCites(res.cites || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : '追问失败');
    } finally {
      setLoading(false);
    }
  }, []);

  return { answer, cites, loading, error, ask, clear: () => { setAnswer(''); setCites([]); } };
}

// Courses CRUD
export function useCourses() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await apiFetch<{ courses: Course[] }>('/api/courses');
      setCourses(data.courses || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载课程失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const create = useCallback(async (name: string): Promise<Course | null> => {
    try {
      const c = await apiFetch<Course>('/api/courses', {
        method: 'POST',
        body: JSON.stringify({ name }),
      });
      setCourses((prev) => [...prev, c]);
      return c;
    } catch (e) {
      setError(e instanceof Error ? e.message : '创建课程失败');
      return null;
    }
  }, []);

  const update = useCallback(async (id: string, patch: Partial<Pick<Course, 'name' | 'hotwords' | 'corrections'>>) => {
    try {
      await apiFetch(`/api/courses/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      setCourses((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    } catch (e) {
      setError(e instanceof Error ? e.message : '更新课程失败');
    }
  }, []);

  const remove = useCallback(async (id: string) => {
    try {
      await apiFetch(`/api/courses/${id}`, { method: 'DELETE' });
      setCourses((prev) => prev.filter((c) => c.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除课程失败');
    }
  }, []);

  return { courses, loading, error, refresh: fetchAll, create, update, remove };
}

// Assign session to course
export async function assignSessionToCourse(sid: string, courseId: string | null) {
  return apiFetch(`/api/sessions/${sid}/course`, {
    method: 'POST',
    body: JSON.stringify({ course_id: courseId }),
  });
}

// Shots
export async function uploadShot(sid: string, at: number, imageBase64: string) {
  return apiFetch<ShotRecord>(`/api/shot/${sid}`, {
    method: 'POST',
    body: JSON.stringify({ at, image: imageBase64 }),
  });
}

export async function fetchShots(sid: string) {
  return apiFetch<ShotsResponse>(`/api/shots/${sid}`);
}

export async function deleteShot(sid: string, shotId: string) {
  return apiFetch(`/api/shot/${sid}/${shotId}`, { method: 'DELETE' });
}