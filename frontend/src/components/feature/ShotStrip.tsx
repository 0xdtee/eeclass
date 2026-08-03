/**
 * 板书 / PPT 截图。这是课堂特有的需求——复习时想看到「老师说这句话的时候黑板上写的是什么」，
 * 会议类工具全都没有这个。截图按录音秒数插进转写流里。
 */
import { useState } from 'react';
import { shotUrl } from '@/hooks/useLibrary';
import type { Shot } from '@/hooks/useLibrary';

interface ShotStripProps {
  shots: Shot[];
  onSeek?: (seconds: number) => void;
  onDelete?: (shotId: string) => void;
  onNote?: (shotId: string, note: string) => void;
}

export default function ShotStrip({ shots, onSeek, onDelete, onNote }: ShotStripProps) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const [noteDraft, setNoteDraft] = useState('');

  if (shots.length === 0) return null;
  const cur = openIdx !== null ? shots[openIdx] : null;

  return (
    <>
      <div className="flex gap-2 overflow-x-auto py-1">
        {shots.map((s, i) => (
          <button
            key={s.id}
            onClick={() => {
              setOpenIdx(i);
              setNoteDraft(s.note || '');
            }}
            className="flex-shrink-0 group cursor-pointer"
            title={s.note || s.ts}
          >
            <img
              src={shotUrl(s.url)}
              alt={s.note || '板书'}
              className="h-28 rounded-lg border border-background-200 object-cover group-hover:border-accent-400 transition-colors"
            />
            <span className="block text-xs text-foreground-400 font-mono mt-1">{s.ts}</span>
          </button>
        ))}
      </div>

      {cur && (
        <div
          className="fixed inset-0 z-50 bg-foreground-900/80 flex items-center justify-center p-4"
          onClick={() => setOpenIdx(null)}
        >
          <div className="max-w-4xl w-full" onClick={(e) => e.stopPropagation()}>
            <img
              src={shotUrl(cur.url)}
              alt={cur.note || '板书'}
              className="w-full max-h-[70vh] object-contain rounded-lg bg-background-900"
            />
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              <span className="text-xs text-background-50 font-mono">{cur.ts}</span>
              {onSeek && (
                <button
                  onClick={() => {
                    onSeek(cur.at);
                    setOpenIdx(null);
                  }}
                  className="px-3 py-1.5 bg-background-50/20 text-background-50 rounded-full text-xs cursor-pointer hover:bg-background-50/30"
                >
                  <i className="ri-volume-up-line mr-1"></i>听这一刻
                </button>
              )}
              <input
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                onBlur={() => onNote?.(cur.id, noteDraft)}
                placeholder="加一句备注…"
                className="flex-1 min-w-[140px] text-xs px-3 py-1.5 rounded-full bg-background-50/20 text-background-50 placeholder:text-background-50/60 border-0"
              />
              <button
                onClick={() => setOpenIdx((i) => (i === null ? null : Math.max(0, i - 1)))}
                disabled={openIdx === 0}
                className="px-3 py-1.5 bg-background-50/20 text-background-50 rounded-full text-xs cursor-pointer disabled:opacity-30"
              >
                上一张
              </button>
              <button
                onClick={() => setOpenIdx((i) => (i === null ? null : Math.min(shots.length - 1, i + 1)))}
                disabled={openIdx === shots.length - 1}
                className="px-3 py-1.5 bg-background-50/20 text-background-50 rounded-full text-xs cursor-pointer disabled:opacity-30"
              >
                下一张
              </button>
              {onDelete && (
                <button
                  onClick={() => {
                    onDelete(cur.id);
                    setOpenIdx(null);
                  }}
                  className="px-3 py-1.5 bg-red-500/80 text-background-50 rounded-full text-xs cursor-pointer"
                >
                  删除
                </button>
              )}
              <button
                onClick={() => setOpenIdx(null)}
                className="px-3 py-1.5 bg-background-50/20 text-background-50 rounded-full text-xs cursor-pointer"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
