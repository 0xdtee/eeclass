/**
 * A library file shown inside the page instead of a new tab: title bar + FileViewer, with a drag bar along
 * the bottom edge to resize it, like the divider between subtitles and the file box on the meeting page.
 * The height is remembered per `storageKey`, so each page reopens at the size it was last left at.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '@/lib/i18n';
import FileViewer, { type LibFile } from '@/pages/meeting/FileViewer';

const MIN_PX = 180;

function readHeight(key: string): number {
  try {
    const v = Number(localStorage.getItem(key));
    if (v >= MIN_PX) return v;
  } catch { /* ignore */ }
  return Math.round(window.innerHeight * 0.46);
}

interface Props {
  file: LibFile;
  onClose: () => void;
  /** which file library the file lives in */
  base?: string;
  /** localStorage key for the remembered height */
  storageKey?: string;
  className?: string;
}

export default function DocPanel({ file, onClose, base = '/api/class/files', storageKey = 'doc_panel_h', className = '' }: Props) {
  const t = useT();
  const [height, setHeight] = useState(() => readHeight(storageKey));
  const boxRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ startY: number; startH: number } | null>(null);

  const clamp = (h: number) => Math.max(MIN_PX, Math.min(h, Math.round(window.innerHeight * 0.92)));

  const onDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = { startY: e.clientY, startH: boxRef.current?.offsetHeight || height };
  }, [height]);

  const onMove = useCallback((e: React.PointerEvent) => {
    if (!drag.current) return;
    setHeight(clamp(drag.current.startH + e.clientY - drag.current.startY));
  }, []);

  const onUp = useCallback(() => { drag.current = null; }, []);

  // remember the size once a drag settles (not on every pointer move)
  useEffect(() => {
    const id = setTimeout(() => { try { localStorage.setItem(storageKey, String(height)); } catch { /* ignore */ } }, 300);
    return () => clearTimeout(id);
  }, [height, storageKey]);

  const step = (dir: 1 | -1) => setHeight((h) => clamp(h + dir * Math.round(window.innerHeight * 0.15)));

  return (
    <div className={`bg-background-50 border border-background-200 rounded-xl overflow-hidden ${className}`}>
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-background-200">
        <i className="ri-slideshow-2-line text-accent-500"></i>
        <span className="text-sm font-medium text-foreground-800 truncate">{file.name}</span>
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => step(-1)}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-foreground-500 hover:bg-background-100 cursor-pointer"
            title={t('缩小')}
          >
            <i className="ri-subtract-line"></i>
          </button>
          <button
            onClick={() => step(1)}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-foreground-500 hover:bg-background-100 cursor-pointer"
            title={t('放大')}
          >
            <i className="ri-add-line"></i>
          </button>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-foreground-400 hover:bg-background-100 cursor-pointer"
            title={t('关闭课件')}
          >
            <i className="ri-close-line"></i>
          </button>
        </div>
      </div>
      <div ref={boxRef} style={{ height }}>
        <FileViewer file={file} base={base} onClose={onClose} />
      </div>
      {/* drag to resize: pointer capture keeps the drag alive even when the cursor runs over the PDF canvas */}
      <div
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        className="h-3 bg-background-100 hover:bg-accent-100 cursor-row-resize flex items-center justify-center group touch-none select-none"
        title={t('拖动调整大小')}
      >
        <div className="w-12 h-1 rounded-full bg-foreground-300 group-hover:bg-accent-500"></div>
      </div>
    </div>
  );
}
