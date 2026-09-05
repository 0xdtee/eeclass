/**
 * Per-account file library for the meeting translator: upload files/videos, list them, delete, and
 * double-click one to open it in the display box. Files are stored on the server under the account.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '@/lib/i18n';
import { SERVICE_ORIGIN, getToken } from '@/hooks/useLiveCaption';
import { type LibFile, fileKind } from './FileViewer';

async function api<T>(path: string, method: string, body?: BodyInit): Promise<T> {
  const res = await fetch(SERVICE_ORIGIN + path, { method, headers: { 'X-Token': getToken() }, body });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((j as { error?: string }).error || `HTTP ${res.status}`);
  return j as T;
}

const ICON: Record<string, string> = {
  doc: 'ri-slideshow-2-line', video: 'ri-film-line', image: 'ri-image-line', other: 'ri-file-3-line',
};

export default function FileLibrary({ onOpen, onClose }: { onOpen: (f: LibFile) => void; onClose: () => void }) {
  const t = useT();
  const [files, setFiles] = useState<LibFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState('');
  const [sel, setSel] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setFiles((await api<{ files: LibFile[] }>('/api/meeting/files', 'GET')).files || []); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const upload = useCallback(async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setErr('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      await api('/api/meeting/files', 'POST', fd);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  }, [load]);

  const del = useCallback(async (id: string) => {
    try {
      await api('/api/meeting/files/' + encodeURIComponent(id), 'DELETE');
      setFiles((p) => p.filter((f) => f.id !== id));
    } catch { /* ignore */ }
  }, []);

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-background-50 w-full sm:rounded-2xl rounded-t-2xl sm:max-w-2xl max-h-[75vh] flex flex-col shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-5 py-3.5 border-b border-background-200">
          <i className="ri-folder-3-line text-accent-500"></i>
          <h3 className="text-sm font-semibold text-foreground-900">{t('文件库')}</h3>
          <span className="hidden sm:inline text-xs text-foreground-400">{t('双击文件在下方播放')}</span>
          <div className="ml-auto flex items-center gap-2">
            <input ref={inputRef} type="file" className="hidden" onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ''; }} />
            <button
              onClick={() => inputRef.current?.click()}
              disabled={uploading}
              className="h-8 px-3 rounded-lg bg-accent-500 text-background-50 text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50 cursor-pointer hover:bg-accent-600"
            >
              <i className={uploading ? 'ri-loader-4-line animate-spin' : 'ri-add-line'}></i>{t('新增文件')}
            </button>
            <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-foreground-400 hover:bg-background-100 cursor-pointer">
              <i className="ri-close-line"></i>
            </button>
          </div>
        </div>
        {err && <div className="px-5 py-2 text-xs text-red-600">{err}</div>}
        <div className="flex-1 overflow-y-auto p-3">
          {loading ? (
            <div className="py-10 text-center text-foreground-300 text-sm"><i className="ri-loader-4-line animate-spin text-2xl"></i></div>
          ) : files.length === 0 ? (
            <div className="py-12 text-center text-foreground-300 text-sm"><i className="ri-inbox-line text-3xl block mb-2"></i>{t('还没有文件,点「新增文件」上传')}</div>
          ) : (
            <ul className="space-y-1">
              {files.map((f) => (
                <li
                  key={f.id}
                  onClick={() => setSel(f.id)}
                  onDoubleClick={() => onOpen(f)}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer group ${sel === f.id ? 'bg-accent-100' : 'hover:bg-background-100'}`}
                >
                  <i className={`${ICON[fileKind(f.ext)]} text-lg text-accent-500`}></i>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground-900 truncate">{f.name}</p>
                    {f.size ? <p className="text-xs text-foreground-400">{(f.size / 1024 / 1024).toFixed(1)} MB</p> : null}
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); onOpen(f); }} className="text-xs text-accent-600 font-medium px-2 opacity-0 group-hover:opacity-100 cursor-pointer">{t('打开')}</button>
                  <button onClick={(e) => { e.stopPropagation(); void del(f.id); }} className="w-7 h-7 flex-shrink-0 flex items-center justify-center rounded-lg text-foreground-300 hover:text-red-500 hover:bg-background-200 cursor-pointer opacity-0 group-hover:opacity-100">
                    <i className="ri-delete-bin-line"></i>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
