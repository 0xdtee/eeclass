/**
 * 读服务端真实的课堂记录（records\ 目录），替代 mocks/courseData.ts 里的假数据。
 *
 * 每节课在服务端是一个目录：transcript.jsonl（逐句）、meta.json（时长/说话人/RTF）、
 * audio.wav、以及 edits.jsonl（改过哪些句子，用来做真实的编辑历史）。
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
  /** 已保存的 AI 摘要(有则说明这节课出过纪要) */
  summary?: string;
  key_points?: string[];
  has_summary?: boolean;
}

export interface ScheduleCourse {
  name: string;
  day: number;        // 1=周一 … 7=周日
  start: string;      // HH:MM
  end: string;
  location: string;
  room: string;
}

/** 带具体日期的课程事件(不按周重复,导入什么就是什么) */
export interface ScheduleEvent {
  name: string;
  date: string;       // YYYY-MM-DD
  start: string;
  end: string;
  location: string;
  room: string;
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
  /** 英文句的中文字幕(挂在下面显示) */
  translation?: string;
  /** 相对开课的秒数，点时间戳跳录音要用 */
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
  sid: string;            // 代表会话(试听用)
  idx: number;            // 代表会话里的说话人序号
  sample_start: number;   // 试听起点(秒)
  name: string;           // 当前显示名(老师/同学N)
  seconds: number;        // 这个人累计时长
  count: number;          // 合并了几段
  sessions: number;       // 出现在几节课
  embedding: number[];    // 合并后的声纹中心(打标签时入库)
}

export interface OfficialSchool {
  id: string;
  name: string;
  items: { course: string; title: string; source_page: string; note: string; kind: 'pdf' | 'page' }[];
}

/** 官方大纲 PDF 的直链(带 token,可直接喂给 iframe) */
export function officialPdfUrl(schoolId: string, course: string): string {
  return `${SERVICE_ORIGIN}/api/syllabus/official/${encodeURIComponent(schoolId)}/${encodeURIComponent(course)}?token=${encodeURIComponent(getToken())}`;
}

/** 网页版官方大纲的代理直链(注入 base 后的 HTML,可直接喂给 iframe) */
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

/** 课程名从目录名里取：2026-07-29_0936_高等数学 -> 高等数学 */
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

  /** 课堂笔记读写(每节课一份) */
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

  /** 手动标记某句为 重点(key)/定义(define)/取消(null),存 marks.json */
  const markLine = useCallback(
    (sid: string, lineId: number, kind: 'key' | 'define' | null) =>
      api<{ ok: boolean }>(`/api/transcript/${encodeURIComponent(sid)}/mark`, {
        method: 'POST',
        body: JSON.stringify({ line_id: lineId, kind }),
      }),
    []
  );

  /** 录制后改说话人名字:按 speaker_id 覆盖,这个人的每一句都改;并把声纹记进声纹库 */
  const renameSpeaker = useCallback(
    (sid: string, speakerId: number, name: string) =>
      api<{ ok: boolean; learned_voiceprint: boolean }>(`/api/transcript/${encodeURIComponent(sid)}/speaker`, {
        method: 'POST',
        body: JSON.stringify({ speaker_id: speakerId, name }),
      }),
    []
  );

  /** 声纹:列出过去录音里的声音——同一个人已聚成一条(首次会现算,可能十几秒) */
  const listVoices = useCallback(
    () => api<{
      clusters: VoiceCluster[];
      recognized: { name: string; count: number }[];
      library: { id: string; name: string }[];
    }>('/api/voices'),
    []
  );
  /** 给一个声音(聚类后的中心)打标签入库 */
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

  /** 课表截图 → 本地 OCR + DeepSeek 提取课程 + 这周周一真实日期(可能耗时十几秒) */
  const importTimetable = useCallback(
    (imageDataUrl: string) =>
      api<{ courses: ScheduleCourse[]; anchor_monday?: string; error?: string }>('/api/import/timetable', {
        method: 'POST',
        body: JSON.stringify({ image: imageDataUrl }),
      }),
    []
  );

  /** 参考资料:课程教学大纲 */
  const listSyllabus = useCallback(() => api<{ courses: { name: string; official: boolean }[] }>('/api/syllabus'), []);
  const getSyllabus = useCallback(
    (name: string) => api<Syllabus>(`/api/syllabus/${encodeURIComponent(name)}`),
    []
  );
  /** 参考资料:按学校的官方大纲 PDF 目录 */
  const listSchools = useCallback(() => api<{ schools: OfficialSchool[] }>('/api/syllabus/schools'), []);

  /** 上大教务系统自动登录 + 抓课表(耗时约 15-25 秒) */
  const importShu = useCallback(
    (username: string, password: string) =>
      api<{ events: ScheduleEvent[]; note?: string; error?: string }>('/api/import/shu', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      }),
    []
  );

  /** 保存/读取带日期的课程事件(持久化,刷新不丢;整表覆盖,累加去重由前端做好再传全量) */
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

  /** 课程级 AI 分析(同名多节课合集):总结 / 考点预测 / 模拟卷。带服务端缓存,refresh 强制重算。 */
  const courseSummary = useCallback(
    (name: string, refresh = false, aiOnly = false) =>
      api<CourseSummary>('/api/course/summary', { method: 'POST', body: JSON.stringify({ name, refresh, ai_only: aiOnly }) }),
    []
  );
  const courseExam = useCallback(
    (name: string, refresh = false, aiOnly = false) =>
      api<CourseExam>('/api/course/exam', { method: 'POST', body: JSON.stringify({ name, refresh, ai_only: aiOnly }) }),
    []
  );
  const courseMock = useCallback(
    (name: string, refresh = false, aiOnly = false) =>
      api<CourseMock>('/api/course/mock', { method: 'POST', body: JSON.stringify({ name, refresh, ai_only: aiOnly }) }),
    []
  );

  /** 个性化反哺:把用户纠对的术语学下来,之后开的课自动纠这个同音错 */
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

  return { sessions, loading, error, reload, loadTranscript, editLine, loadEdits, loadSummary, saveSummary, loadNote, saveNote, markLine, renameSpeaker, learnTerm, importTimetable, importShu, saveSchedule, loadSchedule, listSyllabus, getSyllabus, listSchools, listVoices, addVoiceprint, deleteVoiceprint, courseSummary, courseExam, courseMock, createShare, revokeShare };
}

/** 分享链接（给别人打开的，不需要令牌） */
export function shareUrl(key: string) {
  return `${SERVICE_ORIGIN}/app/shared/${key}`;
}
