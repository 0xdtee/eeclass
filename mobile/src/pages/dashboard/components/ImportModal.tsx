import { useState, useRef, useCallback } from 'react';
import Modal from '@/components/base/Modal';
import { tags as allTags } from '@/mocks/courseData';
import TagBadge from '@/components/base/TagBadge';

interface ImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (data: { title: string; date: string; time: string; duration: string; tags: string[]; description: string }) => void;
}

type ImportStage = 'upload' | 'parsing' | 'review' | 'error';

export default function ImportModal({ isOpen, onClose, onConfirm }: ImportModalProps) {
  const [stage, setStage] = useState<ImportStage>('upload');
  const [errorMsg, setErrorMsg] = useState('');
  const [fileName, setFileName] = useState('');
  const [parsedContent, setParsedContent] = useState('');
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [timeHour, setTimeHour] = useState('08');
  const [timeMinute, setTimeMinute] = useState('30');
  const [durationHours, setDurationHours] = useState('1');
  const [durationMinutes, setDurationMinutes] = useState('30');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const reset = () => {
    setStage('upload');
    setErrorMsg('');
    setFileName('');
    setParsedContent('');
    setTitle('');
    setDate('');
    setTimeHour('08');
    setTimeMinute('30');
    setDurationHours('1');
    setDurationMinutes('30');
    setSelectedTags([]);
    setDragOver(false);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const toggleTag = (tagId: string) => {
    if (selectedTags.includes(tagId)) {
      setSelectedTags(selectedTags.filter((t) => t !== tagId));
    } else {
      setSelectedTags([...selectedTags, tagId]);
    }
  };

  const parseDocx = async (buffer: ArrayBuffer): Promise<string> => {
    const mammoth = (await import('mammoth')).default;
    const result = await mammoth.extractRawText({ arrayBuffer: buffer });
    return result.value.trim();
  };

  const parsePdf = async (buffer: ArrayBuffer): Promise<string> => {
    const pdfjsLib = await import('pdfjs-dist');
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.8.69/pdf.worker.min.mjs';

    const loadingTask = pdfjsLib.getDocument({ data: buffer });
    const pdf = await loadingTask.promise;
    const pages: string[] = [];

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const text = content.items
        .map((item: { str?: string }) => (item as { str: string }).str || '')
        .join(' ');
      pages.push(text);
    }

    return pages.join('\n\n').trim();
  };

  const handleFile = useCallback(async (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext !== 'docx' && ext !== 'pdf') {
      setErrorMsg('仅支持 .docx 和 .pdf 格式的文件');
      setStage('error');
      return;
    }

    setFileName(file.name);
    setStage('parsing');
    setErrorMsg('');

    try {
      const buffer = await file.arrayBuffer();
      let text = '';

      if (ext === 'docx') {
        text = await parseDocx(buffer);
      } else {
        text = await parsePdf(buffer);
      }

      if (!text.trim()) {
        setErrorMsg('未能从文件中提取到文字内容，请确认文件包含可读文字');
        setStage('error');
        return;
      }

      setParsedContent(text);

      // Auto-detect title from filename
      const nameWithoutExt = file.name.replace(/\.(docx|pdf)$/i, '');
      setTitle(nameWithoutExt);

      // Auto-detect date from filename or use today
      const today = new Date();
      const dateStr = `${today.getFullYear()}-${(today.getMonth() + 1).toString().padStart(2, '0')}-${today.getDate().toString().padStart(2, '0')}`;
      setDate(dateStr);

      setStage('review');
    } catch (err) {
      console.error('Parse error:', err);
      setErrorMsg('文件解析失败，请确认文件未损坏且格式正确');
      setStage('error');
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = () => {
    setDragOver(false);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !date) return;
    const time = `${timeHour}:${timeMinute}`;
    const duration = `${durationHours}小时${durationMinutes}分`;
    onConfirm({ title: title.trim(), date, time, duration, tags: selectedTags, description: parsedContent.substring(0, 200) });
    reset();
    onClose();
  };

  const handleRetry = () => {
    setStage('upload');
    setErrorMsg('');
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="导入文档" width="max-w-xl">
      {stage === 'upload' && (
        <div
          ref={dropRef}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all ${
            dragOver
              ? 'border-accent-400 bg-accent-50'
              : 'border-background-200 hover:border-accent-300 hover:bg-background-100'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".docx,.pdf"
            onChange={handleInputChange}
            className="hidden"
          />
          <div className="w-16 h-16 mx-auto flex items-center justify-center bg-accent-100 rounded-2xl mb-4">
            <i className="ri-file-upload-line text-accent-600 text-2xl"></i>
          </div>
          <p className="text-sm font-semibold text-foreground-700 mb-1">
            {dragOver ? '松开以上传文件' : '拖拽文件到此处或点击上传'}
          </p>
          <p className="text-xs text-foreground-400">
            支持 .docx（Word 文档）和 .pdf 格式
          </p>
        </div>
      )}

      {stage === 'parsing' && (
        <div className="py-12 text-center">
          <div className="w-14 h-14 mx-auto flex items-center justify-center bg-accent-100 rounded-2xl mb-4">
            <div className="w-7 h-7 border-2 border-accent-500 border-t-transparent rounded-full animate-spin"></div>
          </div>
          <p className="text-sm font-medium text-foreground-700 mb-1">正在解析文档...</p>
          <p className="text-xs text-foreground-400 truncate max-w-[200px] mx-auto">{fileName}</p>
        </div>
      )}

      {stage === 'error' && (
        <div className="py-8 text-center">
          <div className="w-14 h-14 mx-auto flex items-center justify-center bg-red-100 rounded-2xl mb-4">
            <i className="ri-error-warning-line text-red-500 text-2xl"></i>
          </div>
          <p className="text-sm font-medium text-red-600 mb-3">{errorMsg}</p>
          <div className="flex items-center gap-3 justify-center">
            <button
              onClick={handleRetry}
              className="px-4 py-2 bg-background-100 text-foreground-600 rounded-lg text-xs font-medium hover:bg-background-200 transition-colors cursor-pointer whitespace-nowrap"
            >
              重新上传
            </button>
            <button
              onClick={handleClose}
              className="px-4 py-2 bg-accent-500 text-background-50 rounded-lg text-xs font-semibold hover:bg-accent-600 transition-colors cursor-pointer whitespace-nowrap"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {stage === 'review' && (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex items-center gap-2 p-3 bg-accent-50 rounded-lg mb-1">
            <div className="w-5 h-5 flex items-center justify-center flex-shrink-0">
              <i className="ri-file-text-line text-accent-600 text-sm"></i>
            </div>
            <span className="text-xs font-medium text-accent-700 truncate">{fileName}</span>
            <span className="text-xs text-accent-400 flex-shrink-0">· {parsedContent.length} 字符</span>
          </div>

          <div>
            <label className="block text-xs font-medium text-foreground-600 mb-1.5">课时标题</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2.5 bg-background-100 border border-background-200 rounded-lg text-sm text-foreground-800 placeholder:text-foreground-300 focus:outline-none focus:border-accent-400 focus:ring-2 focus:ring-accent-100 transition-all"
              required
              autoFocus
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-foreground-600 mb-1.5">日期</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full px-3 py-2.5 bg-background-100 border border-background-200 rounded-lg text-sm text-foreground-800 focus:outline-none focus:border-accent-400 focus:ring-2 focus:ring-accent-100 transition-all"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-foreground-600 mb-1.5">上课时间</label>
              <div className="flex items-center gap-1.5">
                <select
                  value={timeHour}
                  onChange={(e) => setTimeHour(e.target.value)}
                  className="flex-1 px-2 py-2.5 bg-background-100 border border-background-200 rounded-lg text-sm text-foreground-800 focus:outline-none focus:border-accent-400 transition-all cursor-pointer"
                >
                  {['08', '09', '10', '13', '14', '15', '16', '18', '19'].map((h) => (
                    <option key={h} value={h}>{h}:00</option>
                  ))}
                </select>
                <span className="text-foreground-400 text-xs">:</span>
                <select
                  value={timeMinute}
                  onChange={(e) => setTimeMinute(e.target.value)}
                  className="flex-1 px-2 py-2.5 bg-background-100 border border-background-200 rounded-lg text-sm text-foreground-800 focus:outline-none focus:border-accent-400 transition-all cursor-pointer"
                >
                  {['00', '15', '30', '45'].map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-foreground-600 mb-1.5">预计时长</label>
              <div className="flex items-center gap-1.5">
                <select
                  value={durationHours}
                  onChange={(e) => setDurationHours(e.target.value)}
                  className="flex-1 px-2 py-2.5 bg-background-100 border border-background-200 rounded-lg text-sm text-foreground-800 focus:outline-none focus:border-accent-400 transition-all cursor-pointer"
                >
                  {['0', '1', '2', '3'].map((h) => (
                    <option key={h} value={h}>{h}h</option>
                  ))}
                </select>
                <select
                  value={durationMinutes}
                  onChange={(e) => setDurationMinutes(e.target.value)}
                  className="flex-1 px-2 py-2.5 bg-background-100 border border-background-200 rounded-lg text-sm text-foreground-800 focus:outline-none focus:border-accent-400 transition-all cursor-pointer"
                >
                  {['00', '15', '30', '45'].map((m) => (
                    <option key={m} value={m}>{m}min</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-foreground-600 mb-1.5">内容预览</label>
            <div className="w-full px-3 py-2.5 bg-background-100 border border-background-200 rounded-lg text-xs text-foreground-600 leading-relaxed max-h-32 overflow-y-auto whitespace-pre-wrap">
              {parsedContent.substring(0, 500)}
              {parsedContent.length > 500 && <span className="text-foreground-300"> ...（共{parsedContent.length}字符）</span>}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-foreground-600 mb-2">章节标签</label>
            <div className="flex flex-wrap gap-2">
              {allTags.map((tag) => (
                <TagBadge
                  key={tag.id}
                  label={tag.label}
                  active={selectedTags.includes(tag.id)}
                  onClick={() => toggleTag(tag.id)}
                  color="accent"
                  size="sm"
                />
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              type="button"
              onClick={handleClose}
              className="flex-1 py-2.5 bg-background-100 text-foreground-600 rounded-lg text-sm font-medium hover:bg-background-200 transition-colors cursor-pointer whitespace-nowrap"
            >
              取消
            </button>
            <button
              type="submit"
              className="flex-1 py-2.5 bg-accent-500 text-background-50 rounded-lg text-sm font-semibold hover:bg-accent-600 transition-colors cursor-pointer whitespace-nowrap"
            >
              导入并创建
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}