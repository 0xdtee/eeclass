import { useSyncExternalStore } from 'react';
import { tags as defaultTags } from '@/mocks/courseData';
import { SERVICE_ORIGIN, getToken } from '@/hooks/useLiveCaption';

export interface Tag {
  id: string;
  label: string;
  color: string;
}

// 标签跟账号走、存服务器(/api/tags),localStorage 只作本地缓存(会随账号切换清掉,避免串号)。
const STORAGE_KEY = 'app_tags_store_v3';

function loadTags(): Tag[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {
    // ignore
  }
  return defaultTags;
}

let state: Tag[] = loadTags();
const listeners = new Set<() => void>();
let lastToken = '';
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function persistLocal() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

function emit() {
  listeners.forEach((l) => l());
}

function pushToServer() {
  const t = getToken();
  if (!t) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fetch(SERVICE_ORIGIN + '/api/tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Token': t },
      body: JSON.stringify({ tags: state }),
    }).catch(() => {});
  }, 400);
}

function setState(next: Tag[]) {
  state = next;
  persistLocal();   // 本地缓存
  pushToServer();   // 同步到服务器(按账号)
  emit();
}

/** 登录/切账号时:先清掉上一个账号的本地缓存,再从服务器拉这个账号的标签。 */
export async function hydrateTagsFromServer() {
  const t = getToken();
  if (!t || t === lastToken) return;
  lastToken = t;
  // 立即清掉上一个账号的标签(localStorage 是跨账号共享的,不清会串号)
  state = [...defaultTags];
  persistLocal();
  emit();
  try {
    const r = await fetch(SERVICE_ORIGIN + '/api/tags', { headers: { 'X-Token': t } });
    if (!r.ok) return;
    const j = await r.json();
    if (Array.isArray(j.tags) && j.tags.length > 0) {
      state = j.tags;      // 该账号在服务器上的标签
    } else {
      pushToServer();      // 该账号还没有 → 用默认(已置为默认)并存下基线
    }
    persistLocal();
    emit();
  } catch {
    // 网络问题:保持默认(已清)
  }
}

/** 登出:清空本地缓存并复位,确保下个账号不会看到上个账号的标签。 */
export function clearTagsForLogout() {
  lastToken = '';
  state = [...defaultTags];
  persistLocal();
  emit();
}

let seq = 0;
function newId(): string {
  seq += 1;
  return `tag-${Date.now()}-${seq}`;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function addTag(label: string, color: string): Tag {
  const newTag: Tag = { id: newId(), label: label.trim(), color };
  setState([...state, newTag]);
  return newTag;
}

export function updateTag(id: string, label: string, color: string) {
  setState(state.map((t) => (t.id === id ? { ...t, label: label.trim(), color } : t)));
}

export function deleteTag(id: string) {
  setState(state.filter((t) => t.id !== id));
}

export function reorderTag(id: string, direction: 'up' | 'down') {
  const idx = state.findIndex((t) => t.id === id);
  if (idx === -1) return;
  if (direction === 'up' && idx === 0) return;
  if (direction === 'down' && idx === state.length - 1) return;
  const next = [...state];
  const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
  [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
  setState(next);
}

export function reorderAll(newTags: Tag[]) {
  setState(newTags);
}

export function useTagsStore() {
  const tags = useSyncExternalStore(subscribe, () => state, () => state);
  return { tags, addTag, updateTag, deleteTag, reorderTag, reorderAll };
}
