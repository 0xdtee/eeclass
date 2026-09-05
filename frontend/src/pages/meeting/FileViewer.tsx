/**
 * Displays one library file inside the meeting "box": documents (PDF, or PPT/PPTX converted to PDF on
 * the server) page through like PowerPoint via SlideViewer; videos play in a <video>; images show in an
 * <img>. Anything else offers a download. The X closes it and restores the full subtitle view.
 */
import { useEffect, useState } from 'react';
import { useT } from '@/lib/i18n';
import { SERVICE_ORIGIN, getToken } from '@/hooks/useLiveCaption';
import SlideViewer from './SlideViewer';

export interface LibFile { id: string; name: string; ext: string; size?: number; created?: number }

const DOC_EXT = ['.pdf', '.ppt', '.pptx', '.odp', '.key'];
const VIDEO_EXT = ['.mp4', '.webm', '.mov', '.m4v', '.mkv', '.ogv'];
const IMG_EXT = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.avif'];

export function fileKind(ext: string): 'doc' | 'video' | 'image' | 'other' {
  const e = (ext || '').toLowerCase();
  if (DOC_EXT.includes(e)) return 'doc';
  if (VIDEO_EXT.includes(e)) return 'video';
  if (IMG_EXT.includes(e)) return 'image';
  return 'other';
}

function Shell({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  const t = useT();
  return (
    <div className="relative w-full h-full bg-neutral-900 flex items-start justify-center overflow-hidden">
      {children}
      <button
        onClick={onClose}
        className="absolute top-3 right-3 w-9 h-9 bg-black/55 text-white rounded-lg flex items-center justify-center hover:bg-black/75 cursor-pointer z-10"
        title={t('关闭')}
      >
        <i className="ri-close-line text-lg"></i>
      </button>
    </div>
  );
}

export default function FileViewer({ file, onClose }: { file: LibFile; onClose: () => void }) {
  const t = useT();
  const kind = fileKind(file.ext);
  const url = `${SERVICE_ORIGIN}/api/meeting/files/${file.id}?token=${encodeURIComponent(getToken())}`;
  const [pdfData, setPdfData] = useState<ArrayBuffer | null>(null);
  const [err, setErr] = useState('');

  // Documents are fetched as bytes (with the auth header) and rendered by pdf.js.
  useEffect(() => {
    if (kind !== 'doc') return;
    let cancelled = false;
    setPdfData(null);
    setErr('');
    (async () => {
      try {
        const res = await fetch(`${SERVICE_ORIGIN}/api/meeting/files/${file.id}`, { headers: { 'X-Token': getToken() } });
        if (!res.ok) {
          let m = `HTTP ${res.status}`;
          try { m = (await res.json()).error || m; } catch { /* keep */ }
          throw new Error(m);
        }
        const buf = await res.arrayBuffer();
        if (!cancelled) setPdfData(buf);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [file.id, kind]);

  if (kind === 'doc') {
    if (err) return <Shell onClose={onClose}><div className="text-red-300 text-sm p-6 text-center">{err}</div></Shell>;
    if (!pdfData) return <Shell onClose={onClose}><div className="text-neutral-400 text-sm flex items-center gap-2"><i className="ri-loader-4-line animate-spin"></i>{t('正在打开…')}</div></Shell>;
    return <SlideViewer data={pdfData} onClose={onClose} />;
  }
  if (kind === 'video') {
    // eslint-disable-next-line jsx-a11y/media-has-caption
    return <Shell onClose={onClose}><video src={url} controls autoPlay className="max-w-full max-h-full" /></Shell>;
  }
  if (kind === 'image') {
    return <Shell onClose={onClose}><img src={url} alt={file.name} className="max-w-full max-h-full object-contain" /></Shell>;
  }
  return (
    <Shell onClose={onClose}>
      <a href={url} download={file.name} className="text-accent-300 underline text-sm">{t('下载')} · {file.name}</a>
    </Shell>
  );
}
