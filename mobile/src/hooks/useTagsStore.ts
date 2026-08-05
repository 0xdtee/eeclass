import { useState, useEffect } from 'react';
import { tags as defaultTags } from '@/mocks/courseData';

export interface Tag {
  id: string;
  label: string;
  color: string;
}

const STORAGE_KEY = 'app_tags_store';

function loadTags(): Tag[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {
    // ignore parse errors
  }
  return defaultTags;
}

export function useTagsStore() {
  const [tags, setTags] = useState<Tag[]>(loadTags);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tags));
    } catch {
      // ignore storage errors
    }
  }, [tags]);

  const addTag = (label: string, color: string): Tag => {
    const newTag: Tag = {
      id: `tag-${Date.now()}`,
      label: label.trim(),
      color,
    };
    setTags((prev) => [...prev, newTag]);
    return newTag;
  };

  const updateTag = (id: string, label: string, color: string) => {
    setTags((prev) =>
      prev.map((t) => (t.id === id ? { ...t, label: label.trim(), color } : t))
    );
  };

  const deleteTag = (id: string) => {
    setTags((prev) => prev.filter((t) => t.id !== id));
  };

  const reorderTag = (id: string, direction: 'up' | 'down') => {
    setTags((prev) => {
      const idx = prev.findIndex((t) => t.id === id);
      if (idx === -1) return prev;
      if (direction === 'up' && idx === 0) return prev;
      if (direction === 'down' && idx === prev.length - 1) return prev;
      const next = [...prev];
      const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
      [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
      return next;
    });
  };

  const reorderAll = (newTags: Tag[]) => {
    setTags(newTags);
  };

  return { tags, addTag, updateTag, deleteTag, reorderTag, reorderAll };
}