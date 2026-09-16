/**
 * Displays one library file: documents page through like PowerPoint via SlideViewer (PDFs directly,
 * decks and Word files converted server-side first); videos play in a <video>; images show in an <img>.
 * Anything else offers a download. The X closes it.
 *
 * `base` selects which library the file comes from, so the same viewer serves the meeting box and the
 * class file library on the recording page.
 */
import { useEffect, useState } from 'react';
import { useT } from '@/lib/i18n';
import { SERVICE_ORIGIN, getToken } from '@/hooks/useLiveCaption';
import SlideViewer from './SlideViewer';

export interface LibFile { id: string; name: string; ext: string; size?: number; created?: number }

const DOC_EXT = ['.pdf', '.ppt', '.pptx', '.odp', '.key', '.doc', '.docx', '.odt', '.rtf'];
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

export default function FileViewer(
  { file, onClose, base = '/api/meeting/files' }: { file: LibFile; onClose: () => void; base?: string }
) {
  const t = useT();
  const kind = fileKind(file.ext);
  const url = `${SERVICE_ORIGIN}${base}/${file.id}?token=${encodeURIComponent(getToken())}`;
  const [pdfData, setPdfData] = useState<ArrayBuffer | null>(null);
  const [err, setErr] = useState('');

  const isPdf = (file.ext || '').toLowerCase() === '.pdf';

  // A PDF is handed to pdf.js as a URL so it streams; anything else has to be fetched and converted first.
  useEffect(() => {
    if (kind !== 'doc' || isPdf) return;
    let cancelled = false;
    setPdfData(null);
    setErr('');
    (async () => {
      try {
        const res = await fetch(`${SERVICE_ORIGIN}${base}/${file.id}`, { headers: { 'X-Token': getToken() } });
        if (!res.ok) {
          let m = `HTTP ${res.status}`;
          try { m = (await res.json()).error || m; } catch { /* keep */ }
          throw new Error(m);
        }
        let buf = await res.arrayBuffer();
        // pdf.js only reads PDFs; a deck or a Word handout goes through the server's converter first.
        if ((file.ext || '').toLowerCase() !== '.pdf') {
          const fd = new FormData();
          fd.append('file', new Blob([buf]), file.name);
          const conv = await fetch(`${SERVICE_ORIGIN}/api/meeting/slides`, {
            method: 'POST', headers: { 'X-Token': getToken() }, body: fd,
          });
          if (!conv.ok) {
            let m = `HTTP ${conv.status}`;
            try { m = (await conv.json()).error || m; } catch { /* keep */ }
            throw new Error(m);
          }
          buf = await conv.arrayBuffer();
        }
        if (!cancelled) setPdfData(buf);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [file.id, file.ext, file.name, kind, base, isPdf]);

  if (kind === 'doc') {
    if (err) return <Shell onClose={onClose}><div className="text-red-300 text-sm p-6 text-center">{err}</div></Shell>;
    if (isPdf) return <SlideViewer url={url} onClose={onClose} />;
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
