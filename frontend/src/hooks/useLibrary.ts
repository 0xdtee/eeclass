/**
 * Course library: course grouping, glossary, correction table, cross-course search, blackboard screenshots, review (flashcards/self-test/follow-up).
 * Everything goes through the local service, with no mocks at all.
 */
import { useCallback, useEffect, useState } from 'react';
import { SERVICE_ORIGIN, getToken, authFailed } from '@/hooks/useLiveCaption';

export interface Correction {
  from: string;
  to: string;
  enabled: boolean;
}

export interface Course {
  id: string;
  name: string;
  created?: string;
  hotwords: string;
  corrections: Correction[];
  session_ids: string[];
}

export interface SearchHit {
  sid: string;
  title: string;
  date: string;
  line_id: number;
  ts: string;
  start: number;
  speaker: string;
  text: string;
  kind: 'key' | 'define' | null;
}

export interface Shot {
  id: string;
  file: string;
  url: string;
  at: number;
  ts: string;
  note: string;
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

export interface AskCite {
  line_id: number;
  ts: string;
  start: number;
  text: string;
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

export const audioUrl = (sid: string) =>
  `${SERVICE_ORIGIN}/api/audio/${encodeURIComponent(sid)}?token=${encodeURIComponent(getToken())}`;

/** Download the original recording: with download=filename, the server/OSS returns it as an attachment (so it downloads under the given name even cross-origin). */
export const audioDownloadUrl = (sid: string, filename: string) =>
  `${audioUrl(sid)}&download=${encodeURIComponent(filename)}`;

export const shotUrl = (url: string) => SERVICE_ORIGIN + url;

/**
 * Compress before upload: phone originals are easily several MB — slow to upload and wasteful to store.
 * Longest edge scaled down to 1600, JPEG quality 0.8; a blackboard shot is usually under 200KB.
 */
export function compressImage(file: File, maxSide = 1600, quality = 0.8): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      const ctx = c.getContext('2d');
      if (!ctx) return reject(new Error('浏览器不支持图片压缩'));
      ctx.drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('图片读取失败'));
    };
    img.src = url;
  });
}

export function useLibrary() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [assign, setAssign] = useState<Record<string, string>>({});
  const [error, setError] = useState('');

  const reloadCourses = useCallback(async () => {
    try {
      const j = await api<{ courses: Course[]; assign: Record<string, string> }>('/api/courses');
      setCourses(j.courses);
      setAssign(j.assign);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void reloadCourses();
  }, [reloadCourses]);

  const createCourse = useCallback(
    async (name: string) => {
      const c = await api<Course>('/api/courses', { method: 'POST', body: JSON.stringify({ name }) });
      await reloadCourses();
      return c;
    },
    [reloadCourses]
  );

  const updateCourse = useCallback(
    async (id: string, patch: Partial<Pick<Course, 'name' | 'hotwords' | 'corrections'>>) => {
      const c = await api<Course>(`/api/courses/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
      await reloadCourses();
      return c;
    },
    [reloadCourses]
  );

  const deleteCourse = useCallback(
    async (id: string) => {
      await api(`/api/courses/${id}`, { method: 'DELETE' });
      await reloadCourses();
    },
    [reloadCourses]
  );

  const assignSession = useCallback(
    async (sid: string, courseId: string | null) => {
      await api(`/api/sessions/${encodeURIComponent(sid)}/course`, {
        method: 'POST',
        body: JSON.stringify({ course_id: courseId }),
      });
      await reloadCourses();
    },
    [reloadCourses]
  );

  const search = useCallback(
    (q: string, limit = 50) =>
      api<{ results: SearchHit[]; total: number }>(
        `/api/search?q=${encodeURIComponent(q)}&limit=${limit}`
      ),
    []
  );

  const loadShots = useCallback(
    (sid: string) => api<{ shots: Shot[] }>(`/api/shots/${encodeURIComponent(sid)}`),
    []
  );

  const addShot = useCallback(
    (sid: string, at: number, dataUrl: string, note = '') =>
      api<Shot>(`/api/shot/${encodeURIComponent(sid)}`, {
        method: 'POST',
        body: JSON.stringify({ at, image: dataUrl, note }),
      }),
    []
  );

  const deleteShot = useCallback(
    (sid: string, shotId: string) =>
      api<{ ok: boolean }>(`/api/shot/${encodeURIComponent(sid)}/${shotId}`, { method: 'DELETE' }),
    []
  );

  const noteShot = useCallback(
    (sid: string, shotId: string, note: string) =>
      api<Shot>(`/api/shot/${encodeURIComponent(sid)}/${shotId}/note`, {
        method: 'POST',
        body: JSON.stringify({ note }),
      }),
    []
  );

  const study = useCallback(
    (sid: string, mode: 'flashcards' | 'quiz', title?: string) =>
      api<{ flashcards?: Flashcard[]; quiz?: QuizItem[] }>('/api/study', {
        method: 'POST',
        body: JSON.stringify({ sid, mode, title }),
      }),
    []
  );

  const ask = useCallback(
    (sid: string, question: string, history: { role: string; content: string }[], title?: string) =>
      api<{ answer: string; cites: AskCite[] }>('/api/ask', {
        method: 'POST',
        body: JSON.stringify({ sid, question, history, title }),
      }),
    []
  );

  return {
    courses, assign, error, reloadCourses,
    createCourse, updateCourse, deleteCourse, assignSession,
    search, loadShots, addShot, deleteShot, noteShot, study, ask,
  };
}
