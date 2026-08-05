import { useState, useCallback } from 'react';
import { type ShotRecord } from '@/hooks/useRecords';
import { SERVICE_ORIGIN } from '@/lib/api';

interface ShotViewerProps {
  shots: ShotRecord[];
  sid: string;
  onDelete?: (shotId: string) => void;
  onNoteChange?: (shotId: string, note: string) => void;
}

export default function ShotViewer({ shots, sid, onDelete, onNoteChange }: ShotViewerProps) {
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const [noteEditing, setNoteEditing] = useState<string | null>(null);
  const [noteText, setNoteText] = useState('');

  const openLightbox = useCallback((idx: number) => {
    setLightboxIdx(idx);
  }, []);

  const closeLightbox = useCallback(() => {
    setLightboxIdx(null);
  }, []);

  const goPrev = useCallback(() => {
    setLightboxIdx((prev) => (prev !== null && prev > 0 ? prev - 1 : prev));
  }, []);

  const goNext = useCallback(() => {
    setLightboxIdx((prev) => (prev !== null && prev < shots.length - 1 ? prev + 1 : prev));
  }, [shots.length]);

  const startEditNote = (shotId: string, currentNote: string) => {
    setNoteEditing(shotId);
    setNoteText(currentNote || '');
  };

  const saveNote = (shotId: string) => {
    onNoteChange?.(shotId, noteText.trim());
    setNoteEditing(null);
    setNoteText('');
  };

  // Keyboard nav for lightbox
  if (lightboxIdx !== null) {
    const shot = shots[lightboxIdx];
    if (!shot) return null;
    const imgUrl = shot.url.startsWith('http') ? shot.url : `${SERVICE_ORIGIN}${shot.url}`;
    return (
      <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center" onClick={closeLightbox}>
        {/* Prev */}
        {lightboxIdx > 0 && (
          <button
            onClick={(e) => { e.stopPropagation(); goPrev(); }}
            className="absolute left-4 w-10 h-10 flex items-center justify-center rounded-full bg-background-50/20 text-background-50 hover:bg-background-50/40 transition-colors cursor-pointer z-10"
          >
            <i className="ri-arrow-left-s-line text-xl"></i>
          </button>
        )}
        {/* Next */}
        {lightboxIdx < shots.length - 1 && (
          <button
            onClick={(e) => { e.stopPropagation(); goNext(); }}
            className="absolute right-4 w-10 h-10 flex items-center justify-center rounded-full bg-background-50/20 text-background-50 hover:bg-background-50/40 transition-colors cursor-pointer z-10"
          >
            <i className="ri-arrow-right-s-line text-xl"></i>
          </button>
        )}

        <div className="relative max-w-[90vw] max-h-[85vh]" onClick={(e) => e.stopPropagation()}>
          <img src={imgUrl} alt={`板书 ${shot.ts}`} className="max-w-full max-h-[85vh] object-contain rounded-xl" />

          {/* Info bar */}
          <div className="absolute bottom-0 left-0 right-0 bg-black/60 rounded-b-xl px-4 py-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono text-background-50/80">{shot.ts}</span>
              <span className="text-xs text-background-50/60">{lightboxIdx + 1} / {shots.length}</span>
              {shot.note && <span className="text-xs text-background-50/70 ml-2">{shot.note}</span>}
            </div>
            <div className="flex items-center gap-2">
              {noteEditing === shot.id ? (
                <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="text"
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') saveNote(shot.id); if (e.key === 'Escape') setNoteEditing(null); }}
                    placeholder="备注..."
                    className="px-2 py-1 bg-background-50/20 text-background-50 text-xs rounded border border-background-50/30 outline-none w-40"
                    autoFocus
                  />
                  <button onClick={() => saveNote(shot.id)} className="w-6 h-6 flex items-center justify-center rounded text-background-50 hover:bg-background-50/20 cursor-pointer">
                    <i className="ri-check-line text-xs"></i>
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => startEditNote(shot.id, shot.note || '')}
                  className="w-7 h-7 flex items-center justify-center rounded text-background-50/70 hover:text-background-50 hover:bg-background-50/20 cursor-pointer"
                  title="加备注"
                >
                  <i className="ri-edit-line text-xs"></i>
                </button>
              )}
              {onDelete && (
                <button
                  onClick={(e) => { e.stopPropagation(); if (confirm('删除这张板书？')) onDelete(shot.id); }}
                  className="w-7 h-7 flex items-center justify-center rounded text-red-400 hover:text-red-300 hover:bg-red-500/20 cursor-pointer"
                  title="删除"
                >
                  <i className="ri-delete-bin-line text-xs"></i>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Close */}
        <button
          onClick={closeLightbox}
          className="absolute top-4 right-4 w-10 h-10 flex items-center justify-center rounded-full bg-background-50/20 text-background-50 hover:bg-background-50/40 transition-colors cursor-pointer z-10"
        >
          <i className="ri-close-line text-xl"></i>
        </button>
      </div>
    );
  }

  // Thumbnails inline
  if (shots.length === 0) return null;

  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {shots.map((shot, idx) => {
        const thumbUrl = shot.url.startsWith('http') ? shot.url : `${SERVICE_ORIGIN}${shot.url}`;
        return (
          <button
            key={shot.id}
            onClick={() => openLightbox(idx)}
            className="flex-shrink-0 relative group cursor-pointer"
          >
            <img
              src={thumbUrl}
              alt={`板书 ${shot.ts}`}
              className="h-[120px] w-auto rounded-lg object-cover border border-background-200 hover:border-accent-300 transition-colors"
            />
            <div className="absolute bottom-1 left-1 right-1 flex items-center justify-between">
              <span className="text-xs bg-black/60 text-background-50 px-1.5 py-0.5 rounded">{shot.ts}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}