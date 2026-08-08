import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { useGuide, nextGuide, prevGuide, endGuide } from '@/hooks/useGuide';

/**
 * Step-by-step guide layer: highlights the real button for the current step + arrow pointer + step text.
 * Advance by clicking the highlighted button (the real action still works as usual) or "Next" on the card.
 * When the target element can't be found (not yet rendered/in a different state), fall back to a bottom-centered hint that doesn't block interaction.
 */
export default function GuideOverlay() {
  const g = useGuide();
  const [rect, setRect] = useState<DOMRect | null>(null);

  const sel = g.active ? (g.targets[g.index] || '') : '';

  // Locate the target element and keep tracking it (it may not be rendered yet right after navigation, or its position may change)
  useEffect(() => {
    if (!g.active) { setRect(null); return; }
    const update = () => {
      const el = sel ? (document.querySelector(sel) as HTMLElement | null) : null;
      if (el) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) { setRect(null); return; }
        if (r.top < 70 || r.bottom > window.innerHeight - 150) {
          el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
        setRect(el.getBoundingClientRect());
      } else {
        setRect(null);
      }
    };
    update();
    const iv = window.setInterval(update, 250);
    const onMove = () => update();
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      window.clearInterval(iv);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [g.active, g.index, sel]);

  // Clicking the highlighted target → automatically advance to the next step after the real action takes effect
  useEffect(() => {
    if (!g.active || !sel) return;
    const onClick = (e: MouseEvent) => {
      const el = document.querySelector(sel);
      if (el && (e.target === el || el.contains(e.target as Node))) {
        window.setTimeout(() => nextGuide(), 60);
      }
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [g.active, g.index, sel]);

  if (!g.active || g.steps.length === 0) return null;

  const total = g.steps.length;
  const first = g.index <= 0;
  const last = g.index >= total - 1;
  const text = g.steps[g.index];
  const CARD_H = 148;

  // Card placement: hug the target if there is one (below preferred), otherwise bottom-centered
  let card: CSSProperties;
  let arrow: 'up' | 'down' | null = null;
  let arrowLeft = 0;
  if (rect) {
    const w = Math.min(360, window.innerWidth - 24);
    let left = rect.left + rect.width / 2 - w / 2;
    left = Math.max(12, Math.min(left, window.innerWidth - w - 12));
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    if (spaceBelow >= CARD_H + 20) {
      // Fits below the element: card below, arrow pointing up
      card = { position: 'fixed', top: rect.bottom + 14, left, width: w };
      arrow = 'up';
      arrowLeft = Math.max(16, Math.min(rect.left + rect.width / 2 - left - 6, w - 28));
    } else if (spaceAbove >= CARD_H + 20) {
      // Fits above: card above, arrow pointing down
      card = { position: 'fixed', top: rect.top - CARD_H - 14, left, width: w };
      arrow = 'down';
      arrowLeft = Math.max(16, Math.min(rect.left + rect.width / 2 - left - 6, w - 28));
    } else {
      // Element too tall, fits neither above nor below: pin to bottom-center, no arrow (the highlight ring indicates it), never overflow
      card = { position: 'fixed', bottom: 16, left: '50%', transform: 'translateX(-50%)', width: w };
    }
  } else {
    const w = Math.min(440, window.innerWidth - 24);
    card = { position: 'fixed', bottom: 18, left: '50%', transform: 'translateX(-50%)', width: w };
  }

  return (
    <>
      {/* Highlight ring (box-shadow cuts a hole and dims the surroundings); pointer-events:none lets clicks pass through to the real button */}
      {rect ? (
        <div
          style={{
            position: 'fixed', top: rect.top - 6, left: rect.left - 6,
            width: rect.width + 12, height: rect.height + 12, borderRadius: 10,
            boxShadow: '0 0 0 9999px rgba(15,23,42,0.55)', outline: '2px solid #818cf8',
            pointerEvents: 'none', zIndex: 9998, transition: 'all .15s ease',
          }}
        />
      ) : (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.42)', pointerEvents: 'none', zIndex: 9998 }} />
      )}

      {/* Hint card */}
      <div style={{ ...card, zIndex: 9999 }} className="bg-foreground-900 text-background-50 rounded-2xl shadow-2xl ring-1 ring-black/20 px-4 py-3">
        {/* Arrow */}
        {arrow === 'up' && (
          <div style={{ position: 'absolute', top: -7, left: arrowLeft, width: 14, height: 14, background: 'inherit' }}
            className="bg-foreground-900 rotate-45 rounded-sm" />
        )}
        {arrow === 'down' && (
          <div style={{ position: 'absolute', bottom: -7, left: arrowLeft, width: 14, height: 14 }}
            className="bg-foreground-900 rotate-45 rounded-sm" />
        )}

        <div className="flex items-center gap-2 mb-1.5">
          <i className="ri-cursor-line text-accent-300"></i>
          <span className="text-xs font-semibold truncate">{g.title}</span>
          <span className="ml-auto text-[11px] text-background-50/60 whitespace-nowrap">第 {g.index + 1}/{total} 步</span>
          <button onClick={endGuide} className="ml-1 w-6 h-6 flex items-center justify-center rounded-lg hover:bg-background-50/10 cursor-pointer" title="退出引导">
            <i className="ri-close-line text-background-50/70"></i>
          </button>
        </div>

        <p className="text-sm leading-relaxed text-background-50/95 mb-1">{text}</p>
        {rect && <p className="text-[11px] text-accent-300 mb-2.5">↑ 点上面高亮的按钮,或点「下一步」</p>}
        {!rect && <div className="mb-2.5" />}

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            {g.steps.map((_, i) => (
              <span key={i} className={`w-1.5 h-1.5 rounded-full ${i === g.index ? 'bg-accent-400' : 'bg-background-50/25'}`} />
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2">
            {!first && (
              <button onClick={prevGuide} className="px-3 py-1.5 rounded-full text-xs font-medium bg-background-50/10 text-background-50/90 hover:bg-background-50/20 cursor-pointer">
                上一步
              </button>
            )}
            <button onClick={nextGuide} className="px-4 py-1.5 rounded-full text-xs font-semibold bg-accent-500 text-white hover:bg-accent-600 cursor-pointer">
              {last ? '完成' : '下一步'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
