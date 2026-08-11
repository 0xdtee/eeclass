import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  icon?: string;                 // leading remixicon class, e.g. 'ri-mic-line'
  title?: string;
  disabled?: boolean;
  variant?: 'pill' | 'block';    // 'pill' = compact toolbar control; 'block' = full-width form field
  className?: string;            // extra classes on the outer wrapper (e.g. 'flex-1' / 'w-full')
  menuAlign?: 'left' | 'right';
  maxTrigger?: string;           // pill only: tailwind max-w on the trigger label
}

interface MenuPos {
  top?: number; bottom?: number; left?: number; right?: number;
  width: number; maxHeight: number;
}

/**
 * Custom dropdown that replaces the native <select>. The native popup can't be styled and (on macOS) renders in the
 * system appearance opening over the trigger. This one matches the app and — crucially — renders its menu in a portal
 * on document.body with fixed positioning, so it is never clipped by an ancestor's `overflow: hidden` (settings cards,
 * modal panels) or hidden behind a sibling's stacking context. Theme tokens live on :root, so the portal inherits them.
 */
export default function Select({
  value, onChange, options, icon, title, disabled,
  variant = 'pill', className = '', menuAlign = 'left', maxTrigger = 'max-w-[180px]',
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<MenuPos | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const current = options.find((o) => o.value === value);
  const block = variant === 'block';

  const measure = () => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom;
    const spaceAbove = r.top;
    const up = spaceBelow < 240 && spaceAbove > spaceBelow;   // flip upward when there's little room below
    setPos({
      top: up ? undefined : r.bottom + 6,
      bottom: up ? window.innerHeight - r.top + 6 : undefined,
      left: menuAlign === 'right' ? undefined : r.left,
      right: menuAlign === 'right' ? window.innerWidth - r.right : undefined,
      width: r.width,
      maxHeight: Math.min(window.innerHeight * 0.6, (up ? spaceAbove : spaceBelow) - 12),
    });
  };

  useLayoutEffect(() => { if (open) measure(); }, [open]);   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const close = () => setOpen(false);   // scrolling/resizing would strand the fixed menu — just close it
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [open]);

  const triggerCls = block
    ? 'w-full inline-flex items-center gap-2 text-sm px-3 py-2.5 rounded-lg bg-background-100 border border-background-200 text-foreground-800 cursor-pointer hover:bg-background-200/60 transition-colors focus:outline-none focus:border-accent-400 focus:ring-2 focus:ring-accent-100 disabled:opacity-60 disabled:cursor-not-allowed'
    : 'inline-flex items-center gap-1.5 text-xs pl-3 pr-2.5 py-2 rounded-full bg-background-100 border border-background-200 text-foreground-700 cursor-pointer hover:bg-background-200 transition-colors focus:outline-none focus:ring-2 focus:ring-primary-100 disabled:opacity-60 disabled:cursor-not-allowed';

  return (
    <div className={`relative ${block ? 'flex' : 'inline-flex'} ${className}`}>
      <button ref={btnRef} type="button" disabled={disabled} onClick={() => setOpen((v) => !v)} title={title} className={triggerCls}>
        {icon && <i className={`${icon} text-foreground-400 text-sm flex-shrink-0`}></i>}
        <span className={`truncate ${block ? 'flex-1 text-left' : maxTrigger}`}>{current?.label ?? ''}</span>
        <i className={`ri-arrow-down-s-line text-foreground-400 text-sm flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}></i>
      </button>
      {open && !disabled && pos && createPortal(
        <>
          <div className="fixed inset-0" style={{ zIndex: 2000 }} onClick={() => setOpen(false)}></div>
          <div
            className="fixed overflow-y-auto bg-background-50 border border-background-200 rounded-xl shadow-lg p-1"
            style={{
              zIndex: 2001,
              top: pos.top, bottom: pos.bottom, left: pos.left, right: pos.right,
              minWidth: block ? pos.width : Math.max(pos.width, 120),
              width: block ? pos.width : undefined,
              maxWidth: 300,
              maxHeight: pos.maxHeight,
            }}
          >
            {options.map((o) => {
              const on = o.value === value;
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => { onChange(o.value); setOpen(false); }}
                  className={`w-full flex items-center gap-2 text-left ${block ? 'text-sm' : 'text-xs'} px-2.5 py-2 rounded-lg cursor-pointer transition-colors ${on ? 'bg-accent-50 text-accent-700 font-medium' : 'text-foreground-700 hover:bg-background-100'}`}
                >
                  <i className={`ri-check-line text-sm flex-shrink-0 ${on ? 'opacity-100' : 'opacity-0'}`}></i>
                  <span className="truncate">{o.label}</span>
                </button>
              );
            })}
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}
