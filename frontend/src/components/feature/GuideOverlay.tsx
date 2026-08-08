import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { useGuide, nextGuide, prevGuide, endGuide } from '@/hooks/useGuide';

/**
 * 逐步引导层:高亮当前步要点的真实按钮 + 箭头指向 + 步骤文字。
 * 点高亮的按钮(真实操作照常生效)或卡片上的「下一步」即前进。
 * 找不到目标元素(还没渲染/在别的状态里)时退回底部居中提示,不挡操作。
 */
export default function GuideOverlay() {
  const g = useGuide();
  const [rect, setRect] = useState<DOMRect | null>(null);

  const sel = g.active ? (g.targets[g.index] || '') : '';

  // 定位目标元素并持续跟踪(元素可能刚导航过来还没渲染,或位置会变)
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

  // 点中高亮的目标 → 真实操作生效后自动进入下一步
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

  // 卡片定位:有目标就贴着它(下方优先),没目标就底部居中
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
      // 元素下方放得下:卡片在下,箭头朝上
      card = { position: 'fixed', top: rect.bottom + 14, left, width: w };
      arrow = 'up';
      arrowLeft = Math.max(16, Math.min(rect.left + rect.width / 2 - left - 6, w - 28));
    } else if (spaceAbove >= CARD_H + 20) {
      // 上方放得下:卡片在上,箭头朝下
      card = { position: 'fixed', top: rect.top - CARD_H - 14, left, width: w };
      arrow = 'down';
      arrowLeft = Math.max(16, Math.min(rect.left + rect.width / 2 - left - 6, w - 28));
    } else {
      // 元素太高、上下都放不下:固定到底部居中,不画箭头(靠高亮圈指示),绝不越界
      card = { position: 'fixed', bottom: 16, left: '50%', transform: 'translateX(-50%)', width: w };
    }
  } else {
    const w = Math.min(440, window.innerWidth - 24);
    card = { position: 'fixed', bottom: 18, left: '50%', transform: 'translateX(-50%)', width: w };
  }

  return (
    <>
      {/* 高亮圈(box-shadow 挖洞把周围压暗);pointer-events:none 让点击穿透到真实按钮 */}
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

      {/* 提示卡 */}
      <div style={{ ...card, zIndex: 9999 }} className="bg-foreground-900 text-background-50 rounded-2xl shadow-2xl ring-1 ring-black/20 px-4 py-3">
        {/* 箭头 */}
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
