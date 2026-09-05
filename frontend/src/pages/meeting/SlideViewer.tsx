/**
 * Slide viewer for the meeting translator: renders an imported deck (a PDF -- PPT/PPTX are converted to
 * PDF on the server) with pdf.js and lets you page through it like PowerPoint (arrow keys / click / the
 * on-screen arrows). The X in the corner closes it.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '@/lib/i18n';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PdfDocProxy = any;

export default function SlideViewer({ data, onClose }: { data: ArrayBuffer; onClose: () => void }) {
  const t = useT();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const docRef = useRef<PdfDocProxy>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const renderTaskRef = useRef<any>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [err, setErr] = useState('');

  // Load the PDF once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const pdfjsLib = await import('pdfjs-dist');
        pdfjsLib.GlobalWorkerOptions.workerSrc = (
          await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
        ).default;
        const pdf = await pdfjsLib.getDocument({ data: data.slice(0) }).promise;
        if (cancelled) { try { pdf.destroy(); } catch { /* ignore */ } return; }
        docRef.current = pdf;
        setTotal(pdf.numPages);
        setPage(1);
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        // A stale chunk after a redeploy (page kept open) shows up as a MIME / dynamic-import failure.
        if (/MIME type|dynamically imported|Failed to fetch|Importing a module/i.test(msg)) {
          setErr(t('页面有更新,请刷新页面后重试'));
        } else {
          setErr(msg);
        }
      }
    })();
    return () => { cancelled = true; try { docRef.current?.destroy?.(); } catch { /* ignore */ } docRef.current = null; };
  }, [data]);

  const renderPage = useCallback(async () => {
    const pdf = docRef.current;
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!pdf || !canvas || !container) return;
    try {
      const pg = await pdf.getPage(page);
      const base = pg.getViewport({ scale: 1 });
      const cw = container.clientWidth - 8;
      const ch = container.clientHeight - 8;
      const scale = Math.max(0.2, Math.min(cw / base.width, ch / base.height));
      const viewport = pg.getViewport({ scale });
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      try { renderTaskRef.current?.cancel(); } catch { /* ignore */ }
      const task = pg.render({ canvasContext: ctx, viewport });
      renderTaskRef.current = task;
      await task.promise;
    } catch { /* cancelled or failed */ }
  }, [page]);

  useEffect(() => { void renderPage(); }, [renderPage, total]);

  useEffect(() => {
    const onResize = () => void renderPage();
    window.addEventListener('resize', onResize);
    // Re-fit when the container itself changes size (e.g. dragging the split divider), not just the window.
    let ro: ResizeObserver | undefined;
    if (containerRef.current && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => onResize());
      ro.observe(containerRef.current);
    }
    return () => { window.removeEventListener('resize', onResize); ro?.disconnect(); };
  }, [renderPage]);

  const next = useCallback(() => setPage((p) => Math.min(total || 1, p + 1)), [total]);
  const prev = useCallback(() => setPage((p) => Math.max(1, p - 1)), []);

  // PowerPoint-style keyboard control.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); next(); }
      else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) { e.preventDefault(); prev(); }
      else if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, prev, onClose]);

  return (
    <div ref={containerRef} className="relative w-full h-full bg-neutral-900 flex items-start justify-center overflow-hidden">
      {err ? (
        <div className="text-red-300 text-sm p-6 text-center">{t('无法打开幻灯片')}：{err}</div>
      ) : total === 0 ? (
        <div className="text-neutral-400 text-sm flex items-center gap-2"><i className="ri-loader-4-line animate-spin"></i>{t('正在加载幻灯片…')}</div>
      ) : (
        <canvas ref={canvasRef} onClick={next} className="cursor-pointer shadow-lg" />
      )}

      {/* click zones / arrows */}
      {total > 0 && (
        <>
          <button
            onClick={prev}
            disabled={page <= 1}
            className="absolute left-0 top-0 h-full w-14 flex items-center justify-center text-white/70 hover:text-white hover:bg-white/5 disabled:opacity-0 cursor-pointer"
          >
            <i className="ri-arrow-left-s-line text-3xl"></i>
          </button>
          <button
            onClick={next}
            disabled={page >= total}
            className="absolute right-0 top-0 h-full w-14 flex items-center justify-center text-white/70 hover:text-white hover:bg-white/5 disabled:opacity-0 cursor-pointer"
          >
            <i className="ri-arrow-right-s-line text-3xl"></i>
          </button>
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-black/55 text-white text-xs px-3 py-1 rounded-full tabular-nums">
            {page} / {total}
          </div>
        </>
      )}

      <button
        onClick={onClose}
        className="absolute top-3 right-3 w-9 h-9 bg-black/55 text-white rounded-lg flex items-center justify-center hover:bg-black/75 cursor-pointer"
        title={t('关闭幻灯片')}
      >
        <i className="ri-close-line text-lg"></i>
      </button>
    </div>
  );
}
