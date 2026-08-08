import { useSyncExternalStore } from 'react';
import { tags as defaultTags } from '@/mocks/courseData';
import { SERVICE_ORIGIN, getToken } from '@/hooks/useLiveCaption';

export interface Tag {
  id: string;
  label: string;
  color: string;
}

// Tags are tied to the account and stored on the server (/api/tags); localStorage is only a local cache (cleared on account switch to avoid crossover).
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
  persistLocal();   // Local cache
  pushToServer();   // Sync to the server (per account)
  emit();
}

/** On login/account switch: first clear the previous account's local cache, then fetch this account's tags from the server. */
export async function hydrateTagsFromServer() {
  const t = getToken();
  if (!t || t === lastToken) return;
  lastToken = t;
  // Immediately clear the previous account's tags (localStorage is shared across accounts; not clearing causes crossover)
  state = [...defaultTags];
  persistLocal();
  emit();
  try {
    const r = await fetch(SERVICE_ORIGIN + '/api/tags', { headers: { 'X-Token': t } });
    if (!r.ok) return;
    const j = await r.json();
    if (Array.isArray(j.tags) && j.tags.length > 0) {
      state = j.tags;      // This account's tags on the server
    } else {
      pushToServer();      // This account has none yet → use defaults (already set to default) and store a baseline
    }
    persistLocal();
    emit();
  } catch {
    // Network issue: keep defaults (already cleared)
  }
}

/** On logout: clear the local cache and reset, ensuring the next account won't see the previous account's tags. */
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
