import { useState, useRef, useCallback } from 'react';
import Modal from '@/components/base/Modal';
import type { ScheduleCourse } from '@/hooks/useRecords';
import { useT } from '@/lib/i18n';

interface ImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Document (docx/pdf) import: create a session */
  onConfirm: (data: { title: string; date: string; time: string; duration: string; tags: string[]; description: string }) => void;
  /** Timetable screenshot -> recognize courses */
  onImportImage: (dataUrl: string) => Promise<{ courses: ScheduleCourse[]; anchor_monday?: string; error?: string }>;
  /** Confirm adding the recognized courses to the calendar (anchorMonday = the real date of this week's Monday) */
  onConfirmCourses: (courses: ScheduleCourse[], anchorMonday?: string) => void;
}

type Stage = 'upload' | 'parsing' | 'courses' | 'review' | 'error';
const DAY = ['一', '二', '三', '四', '五', '六', '日'];

export default function ImportModal({ isOpen, onClose, onConfirm, onImportImage, onConfirmCourses }: ImportModalProps) {
  const t = useT();
  const [stage, setStage] = useState<Stage>('upload');
  const [errorMsg, setErrorMsg] = useState('');
  const [fileName, setFileName] = useState('');
  const [parsedContent, setParsedContent] = useState('');
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [courses, setCourses] = useState<ScheduleCourse[]>([]);
  const [picked, setPicked] = useState<boolean[]>([]);
  const [anchorMonday, setAnchorMonday] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const reset = () => {
    setStage('upload'); setErrorMsg(''); setFileName(''); setParsedContent('');
    setTitle(''); setDate(''); setCourses([]); setPicked([]); setAnchorMonday(''); setDragOver(false);
  };
  const handleClose = () => { reset(); onClose(); };

  const parseDocx = async (buffer: ArrayBuffer) =>
    (await (await import('mammoth')).default.extractRawText({ arrayBuffer: buffer })).value.trim();

  const parsePdf = async (buffer: ArrayBuffer) => {
    const pdfjsLib = await import('pdfjs-dist');
    // Bundle the worker locally, don't use a CDN
    pdfjsLib.GlobalWorkerOptions.workerSrc = (
      await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
    ).default;
    const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
    const pages: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const content = await (await pdf.getPage(i)).getTextContent();
      pages.push(content.items.map((it) => ('str' in it ? it.str : '')).join(' '));
    }
    return pages.join('\n\n').trim();
  };

  const handleImage = useCallback(async (file: File) => {
    setFileName(file.name);
    setStage('parsing');
    setErrorMsg('');
    try {
      const dataUrl: string = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result as string);
        r.onerror = () => rej(new Error(t('读图失败')));
        r.readAsDataURL(file);
      });
      const out = await onImportImage(dataUrl);
      if (out.error) { setErrorMsg(out.error); setStage('error'); return; }
      const cs = out.courses ?? [];
      if (cs.length === 0) { setErrorMsg(t('没在图里识别到课程,换张更清晰的课表截图试试')); setStage('error'); return; }
      setCourses(cs);
      setPicked(cs.map(() => true));
      setAnchorMonday(out.anchor_monday || '');
      setStage('courses');
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : t('识别失败'));
      setStage('error');
    }
  }, [onImportImage]);

  const handleDoc = useCallback(async (file: File, ext: string) => {
    setFileName(file.name);
    setStage('parsing');
    setErrorMsg('');
    try {
      const buffer = await file.arrayBuffer();
      const text = ext === 'docx' ? await parseDocx(buffer) : await parsePdf(buffer);
      if (!text.trim()) { setErrorMsg(t('未能从文件中提取到文字')); setStage('error'); return; }
      setParsedContent(text);
      setTitle(file.name.replace(/\.(docx|pdf)$/i, ''));
      const t = new Date();
      setDate(`${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`);
      setStage('review');
    } catch {
      setErrorMsg(t('文件解析失败')); setStage('error');
    }
  }, []);

  const handleFile = useCallback((file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    if (file.type.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
      void handleImage(file);
    } else if (ext === 'docx' || ext === 'pdf') {
      void handleDoc(file, ext);
    } else {
      setErrorMsg(t('支持课表截图(png/jpg)、或 .docx / .pdf 文档')); setStage('error');
    }
  }, [handleImage, handleDoc]);

  const submitDoc = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !date) return;
    onConfirm({ title: title.trim(), date, time: '08:30', duration: '1小时30分', tags: [], description: parsedContent.substring(0, 200) });
    handleClose();
  };

  const confirmCourses = () => {
    const chosen = courses.filter((_, i) => picked[i]);
    if (chosen.length === 0) return;
    onConfirmCourses(chosen, anchorMonday);
    handleClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={t('导入课表 / 文档')} width="max-w-xl">
      {stage === 'upload' && (
        <div
          onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all ${
            dragOver ? 'border-accent-400 bg-accent-50' : 'border-background-200 hover:border-accent-300 hover:bg-background-100'
          }`}
        >
          <input ref={fileInputRef} type="file" accept="image/*,.docx,.pdf" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} className="hidden" />
          <div className="w-16 h-16 mx-auto flex items-center justify-center bg-accent-100 rounded-2xl mb-4">
            <i className="ri-calendar-schedule-line text-accent-600 text-2xl"></i>
          </div>
          <p className="text-sm font-semibold text-foreground-700 mb-1">{dragOver ? t('松开以上传') : t('上传课表截图,自动识别课程加进日历')}</p>
          <p className="text-xs text-foreground-400">{t('支持课表截图(png/jpg),也支持 .docx / .pdf 文档')}</p>
        </div>
      )}

      {stage === 'parsing' && (
        <div className="py-12 text-center">
          <div className="w-14 h-14 mx-auto flex items-center justify-center bg-accent-100 rounded-2xl mb-4">
            <div className="w-7 h-7 border-2 border-accent-500 border-t-transparent rounded-full animate-spin"></div>
          </div>
          <p className="text-sm font-medium text-foreground-700 mb-1">{t('正在识别…(截图识别需十几秒)')}</p>
          <p className="text-xs text-foreground-400 truncate max-w-[220px] mx-auto">{fileName}</p>
        </div>
      )}

      {stage === 'error' && (
        <div className="py-8 text-center">
          <div className="w-14 h-14 mx-auto flex items-center justify-center bg-red-100 rounded-2xl mb-4">
            <i className="ri-error-warning-line text-red-500 text-2xl"></i>
          </div>
          <p className="text-sm font-medium text-red-600 mb-3">{errorMsg}</p>
          <div className="flex items-center gap-3 justify-center">
            <button onClick={() => { setStage('upload'); setErrorMsg(''); }} className="px-4 py-2 bg-background-100 text-foreground-600 rounded-lg text-xs font-medium hover:bg-background-200 cursor-pointer">{t('重新上传')}</button>
            <button onClick={handleClose} className="px-4 py-2 bg-accent-500 text-background-50 rounded-lg text-xs font-semibold hover:bg-accent-600 cursor-pointer">{t('取消')}</button>
          </div>
        </div>
      )}

      {stage === 'courses' && (
        <div className="space-y-3">
          <p className="text-xs text-foreground-500">{t('识别到')} <b className="text-accent-600">{courses.length}</b> {t('门课,勾选要加进日历的(每周重复):')}</p>
          <div className="max-h-[46vh] overflow-y-auto space-y-1.5 -mx-1 px-1">
            {courses.map((c, i) => (
              <label key={i} className={`flex items-center gap-2.5 p-2.5 rounded-lg border cursor-pointer transition-colors ${picked[i] ? 'bg-accent-50 border-accent-200' : 'bg-background-100 border-background-200 opacity-60'}`}>
                <input type="checkbox" checked={picked[i]} onChange={() => setPicked((p) => p.map((v, j) => (j === i ? !v : v)))} className="accent-accent-500 w-4 h-4 flex-shrink-0" />
                <span className="text-xs font-mono text-accent-600 flex-shrink-0 w-10 text-center">{t('周' + (DAY[c.day - 1] ?? c.day))}</span>
                <span className="text-xs font-mono text-foreground-400 flex-shrink-0 w-24">{c.start}-{c.end}</span>
                <span className="text-sm text-foreground-800 font-medium truncate flex-1">{c.name}</span>
                <span className="text-xs text-foreground-400 flex-shrink-0">{c.room}</span>
              </label>
            ))}
          </div>
          <div className="flex items-center gap-3 pt-1">
            <button onClick={handleClose} className="flex-1 py-2.5 bg-background-100 text-foreground-600 rounded-lg text-sm font-medium hover:bg-background-200 cursor-pointer">{t('取消')}</button>
            <button onClick={confirmCourses} className="flex-1 py-2.5 bg-accent-500 text-background-50 rounded-lg text-sm font-semibold hover:bg-accent-600 cursor-pointer">
              {t('加入日历（{n}）', { n: picked.filter(Boolean).length })}
            </button>
          </div>
        </div>
      )}

      {stage === 'review' && (
        <form onSubmit={submitDoc} className="space-y-4">
          <div className="flex items-center gap-2 p-3 bg-accent-50 rounded-lg">
            <i className="ri-file-text-line text-accent-600 text-sm"></i>
            <span className="text-xs font-medium text-accent-700 truncate">{fileName}</span>
          </div>
          <div>
            <label className="block text-xs font-medium text-foreground-600 mb-1.5">{t('课时标题')}</label>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} className="w-full px-3 py-2.5 bg-background-100 border border-background-200 rounded-lg text-sm focus:outline-none focus:border-accent-400" required autoFocus />
          </div>
          <div>
            <label className="block text-xs font-medium text-foreground-600 mb-1.5">{t('日期')}</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full px-3 py-2.5 bg-background-100 border border-background-200 rounded-lg text-sm focus:outline-none focus:border-accent-400" required />
          </div>
          <div className="flex items-center gap-3 pt-2">
            <button type="button" onClick={handleClose} className="flex-1 py-2.5 bg-background-100 text-foreground-600 rounded-lg text-sm font-medium hover:bg-background-200 cursor-pointer">{t('取消')}</button>
            <button type="submit" className="flex-1 py-2.5 bg-accent-500 text-background-50 rounded-lg text-sm font-semibold hover:bg-accent-600 cursor-pointer">{t('导入并创建')}</button>
          </div>
        </form>
      )}
    </Modal>
  );
}
