import { useState, useEffect } from 'react';

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

/**
 * Custom dropdown that replaces the native <select>. The native popup can't be styled and (on macOS) renders in the
 * system appearance opening over the trigger; this one matches the app — a themed trigger and a menu that always
 * opens downward, scrolls when long, and never covers the content above it.
 */
export default function Select({
  value, onChange, options, icon, title, disabled,
  variant = 'pill', className = '', menuAlign = 'left', maxTrigger = 'max-w-[180px]',
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const block = variant === 'block';
  const triggerCls = block
    ? 'w-full inline-flex items-center gap-2 text-sm px-3 py-2.5 rounded-lg bg-background-100 border border-background-200 text-foreground-800 cursor-pointer hover:bg-background-200/60 transition-colors focus:outline-none focus:border-accent-400 focus:ring-2 focus:ring-accent-100 disabled:opacity-60 disabled:cursor-not-allowed'
    : 'inline-flex items-center gap-1.5 text-xs pl-3 pr-2.5 py-2 rounded-full bg-background-100 border border-background-200 text-foreground-700 cursor-pointer hover:bg-background-200 transition-colors focus:outline-none focus:ring-2 focus:ring-primary-100 disabled:opacity-60 disabled:cursor-not-allowed';

  return (
    <div className={`relative ${block ? 'flex' : 'inline-flex'} ${className}`}>
      <button type="button" disabled={disabled} onClick={() => setOpen((v) => !v)} title={title} className={triggerCls}>
        {icon && <i className={`${icon} text-foreground-400 text-sm flex-shrink-0`}></i>}
        <span className={`truncate ${block ? 'flex-1 text-left' : maxTrigger}`}>{current?.label ?? ''}</span>
        <i className={`ri-arrow-down-s-line text-foreground-400 text-sm flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}></i>
      </button>
      {open && !disabled && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)}></div>
          <div className={`absolute z-50 top-full mt-1.5 ${menuAlign === 'right' ? 'right-0' : 'left-0'} ${block ? 'w-full' : 'min-w-full w-max max-w-[280px]'} max-h-[60vh] overflow-y-auto bg-background-50 border border-background-200 rounded-xl shadow-lg p-1`}>
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
        </>
      )}
    </div>
  );
}
