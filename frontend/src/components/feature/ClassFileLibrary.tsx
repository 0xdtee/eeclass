/**
 * Class file library: per-account course material (syllabus, slides, handouts, notes...).
 *
 * Two modes:
 *   'manage' — plain library management (upload / open / delete), opened from the dashboard or the recording page.
 *   'pick'   — shown right after a recording ends (manual material mode): tick the files the AI should combine
 *              with this lesson before writing the summary, or skip.
 *
 * Uploading offers a "同步到会议文件库" checkbox (off by default), which also copies the file to the meeting
 * translator's library. Text-bearing files are indexed server-side into a knowledge base that stays invisible here.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '@/lib/i18n';
import { SERVICE_ORIGIN, getToken } from '@/hooks/useLiveCaption';

export interface ClassFile {
  id: string;
  name: string;
  ext: string;
  size?: number;
  created?: number;
}

async function api<T>(path: string, method: string, body?: BodyInit): Promise<T> {
  const res = await fetch(SERVICE_ORIGIN + path, { method, headers: { 'X-Token': getToken() }, body });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((j as { error?: string }).error || `HTTP ${res.status}`);
  return j as T;
}

const iconFor = (ext: string) => {
  const e = (ext || '').toLowerCase();
  if (['.pdf'].includes(e)) return 'ri-file-pdf-2-line';
  if (['.doc', '.docx'].includes(e)) return 'ri-file-word-2-line';
  if (['.ppt', '.pptx', '.key', '.odp'].includes(e)) return 'ri-slideshow-2-line';
  if (['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(e)) return 'ri-image-line';
  if (['.mp4', '.mov', '.mkv', '.avi'].includes(e)) return 'ri-film-line';
  return 'ri-file-text-line';
};
/** Only these carry text the AI can read into the knowledge base (mirrors class_files.INDEXABLE). */
const READABLE = ['.txt', '.md', '.markdown', '.csv', '.log', '.json', '.pdf', '.docx', '.pptx'];

interface Props {
  mode?: 'manage' | 'pick';
  onClose: () => void;
  /** pick mode: continue with the ticked files (empty array = skip and summarize without material) */
  onConfirm?: (fileIds: string[]) => void;
}

export default function ClassFileLibrary({ mode = 'manage', onClose, onConfirm }: Props) {
  const t = useT();
  const picking = mode === 'pick';
  const [files, setFiles] = useState<ClassFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState('');
  const [sync, setSync] = useState(false);
  const [checked, setChecked] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setFiles((await api<{ files: ClassFile[] }>('/api/class/files', 'GET')).files || []); }
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
      if (sync) fd.append('sync', '1');
      fd.append('file', file);
      await api('/api/class/files', 'POST', fd);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  }, [load, sync]);

  const del = useCallback(async (id: string) => {
    try {
      await api('/api/class/files/' + encodeURIComponent(id), 'DELETE');
      setFiles((p) => p.filter((f) => f.id !== id));
      setChecked((p) => p.filter((x) => x !== id));
    } catch { /* ignore */ }
  }, []);

  const openFile = (f: ClassFile) => {
    window.open(`${SERVICE_ORIGIN}/api/class/files/${encodeURIComponent(f.id)}?token=${encodeURIComponent(getToken())}`, '_blank');
  };
  const toggle = (id: string) => setChecked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-background-50 w-full sm:rounded-2xl rounded-t-2xl sm:max-w-2xl max-h-[80vh] flex flex-col shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-3.5 border-b border-background-200">
          <div className="flex items-center gap-2">
            <i className="ri-folder-3-line text-accent-500"></i>
            <h3 className="text-sm font-semibold text-foreground-900">
              {picking ? t('这节课要结合资料整理吗?') : t('课堂文件库')}
            </h3>
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
          <p className="text-[11px] text-foreground-400 mt-1.5">
            {picking
              ? t('勾选与这节课相关的资料,AI 会结合资料和转写内容整理摘要;也可以直接跳过。')
              : t('上传课件、讲义、大纲等资料。AI 会读取其中的文字,整理摘要时用来校正术语、补全知识点。')}
          </p>
          <label className="mt-2 inline-flex items-center gap-2 text-[11px] text-foreground-500 cursor-pointer">
            <input type="checkbox" checked={sync} onChange={(e) => setSync(e.target.checked)} className="accent-accent-500 w-3.5 h-3.5" />
            {t('新增时同步到会议文件库(默认不同步)')}
          </label>
        </div>

        {err && <div className="px-5 py-2 text-xs text-red-600">{err}</div>}

        <div className="flex-1 overflow-y-auto p-3">
          {loading ? (
            <div className="py-10 text-center text-foreground-300 text-sm"><i className="ri-loader-4-line animate-spin text-2xl"></i></div>
          ) : files.length === 0 ? (
            <div className="py-12 text-center text-foreground-300 text-sm"><i className="ri-inbox-line text-3xl block mb-2"></i>{t('还没有资料,点「新增文件」上传')}</div>
          ) : (
            <ul className="space-y-1">
              {files.map((f) => {
                const readable = READABLE.includes((f.ext || '').toLowerCase());
                return (
                  <li
                    key={f.id}
                    onClick={() => (picking && readable ? toggle(f.id) : undefined)}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg group ${
                      picking && readable ? 'cursor-pointer' : ''
                    } ${picking && checked.includes(f.id) ? 'bg-accent-100' : 'hover:bg-background-100'}`}
                  >
                    {picking && (
                      <input
                        type="checkbox"
                        checked={checked.includes(f.id)}
                        disabled={!readable}
                        onChange={() => toggle(f.id)}
                        onClick={(e) => e.stopPropagation()}
                        className="accent-accent-500 w-4 h-4 flex-shrink-0 disabled:opacity-30"
                      />
                    )}
                    <i className={`${iconFor(f.ext)} text-lg text-accent-500`}></i>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground-900 truncate">{f.name}</p>
                      <p className="text-xs text-foreground-400">
                        {f.size ? `${(f.size / 1024 / 1024).toFixed(2)} MB` : ''}
                        {!readable && <span className="ml-1.5 text-foreground-300">{t('（无文字,AI 读不了）')}</span>}
                      </p>
                    </div>
                    <button onClick={(e) => { e.stopPropagation(); openFile(f); }} className="text-xs text-accent-600 font-medium px-2 opacity-0 group-hover:opacity-100 cursor-pointer">{t('打开')}</button>
                    <button onClick={(e) => { e.stopPropagation(); void del(f.id); }} className="w-7 h-7 flex-shrink-0 flex items-center justify-center rounded-lg text-foreground-300 hover:text-red-500 hover:bg-background-200 cursor-pointer opacity-0 group-hover:opacity-100">
                      <i className="ri-delete-bin-line"></i>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {picking && (
          <div className="px-5 py-3 border-t border-background-200 flex items-center gap-3">
            <button
              onClick={() => onConfirm?.([])}
              className="flex-1 py-2.5 bg-background-100 text-foreground-600 rounded-lg text-sm font-medium hover:bg-background-200 cursor-pointer"
            >
              {t('跳过,直接生成摘要')}
            </button>
            <button
              onClick={() => onConfirm?.(checked)}
              disabled={checked.length === 0}
              className="flex-1 py-2.5 bg-accent-500 text-background-50 rounded-lg text-sm font-semibold hover:bg-accent-600 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {t('结合选中的 {n} 份资料', { n: checked.length })}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
