/**
 * Meeting-history storage for the meeting translator.
 *
 * Not logged in: history lives in this browser's localStorage only ("local history").
 * Logged in: history is also saved on the server under the account, so it follows you across devices.
 * On login the local (anonymous) history is inherited — uploaded and merged into the account.
 */
import { SERVICE_ORIGIN, getToken } from '@/hooks/useLiveCaption';

export interface MeetingTurn {
  id: number;
  original: string;
  src: string;
  translations?: Record<string, string>;   // lang code -> translated text (multi-language)
  // Legacy pre-multilingual fields, still read when showing old saved history:
  translation?: string;
  tgt?: string;
}

export interface MeetingMinutes {
  title: string;
  summary: string;
  points: string[];
  decisions: string[];
  todos: { task: string; owner?: string }[];
}

export interface MeetingSession {
  id: string;
  created: number;          // epoch ms
  title: string;
  turns: MeetingTurn[];
  minutes: MeetingMinutes | null;
}

const LS_KEY = 'meeting_history';
const CAP = 300;

/* ---------- local (browser) ---------- */
export function loadLocal(): MeetingSession[] {
  try {
    const a = JSON.parse(localStorage.getItem(LS_KEY) || '[]');
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
}

function writeLocal(sessions: MeetingSession[]) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(sessions.slice(0, CAP)));
  } catch {
    /* ignore quota errors */
  }
}

function mergeById(...lists: MeetingSession[][]): MeetingSession[] {
  const byId = new Map<string, MeetingSession>();
  for (const list of lists) for (const s of list) if (s && s.id && !byId.has(s.id)) byId.set(s.id, s);
  return [...byId.values()].sort((a, b) => (b.created || 0) - (a.created || 0));
}

/** Insert/replace one session (earlier lists win on id), persist, return the new list. */
export function upsertLocal(session: MeetingSession): MeetingSession[] {
  const merged = mergeById([session], loadLocal());
  writeLocal(merged);
  return merged;
}

export function removeLocal(id: string): MeetingSession[] {
  const merged = loadLocal().filter((s) => s.id !== id);
  writeLocal(merged);
  return merged;
}

export function replaceLocal(sessions: MeetingSession[]) {
  writeLocal(sessions);
}

/* ---------- server (per-account) ---------- */
async function api<T>(path: string, method: string, body?: unknown): Promise<T> {
  const r = await fetch(SERVICE_ORIGIN + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Token': getToken() },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error || `HTTP ${r.status}`);
  return j as T;
}

export function fetchServer(): Promise<MeetingSession[]> {
  return api<{ sessions: MeetingSession[] }>('/api/meeting/history', 'GET').then((j) => j.sessions || []);
}

export function saveServer(sessions: MeetingSession[]): Promise<MeetingSession[]> {
  return api<{ sessions: MeetingSession[] }>('/api/meeting/history', 'POST', { sessions }).then((j) => j.sessions || []);
}

export function deleteServer(id: string): Promise<void> {
  return api('/api/meeting/history/' + encodeURIComponent(id), 'DELETE').then(() => undefined);
}

/**
 * Reconcile on load. When logged in: pull the account's history and inherit any local-only sessions
 * (upload + merge into the account), then show the account's history. When not logged in: just the
 * local history. Note we deliberately do NOT overwrite localStorage with the account's history —
 * otherwise the account's meetings (possibly from other devices) would linger on this machine after
 * logout. Local history stays as this device's own sessions.
 */
export async function syncOnLoad(loggedIn: boolean): Promise<MeetingSession[]> {
  const local = loadLocal();
  if (!loggedIn) return local;
  const server = await fetchServer();
  const serverIds = new Set(server.map((s) => s.id));
  const localOnly = local.filter((s) => !serverIds.has(s.id));
  return localOnly.length ? await saveServer(localOnly) : server;
}
