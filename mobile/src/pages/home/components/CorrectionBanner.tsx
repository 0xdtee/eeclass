import { useState } from 'react';

interface CorrectionBannerProps {
  from: string;
  to: string;
  onConfirm: () => void;
  onDismiss: () => void;
}

export default function CorrectionBanner({ from, to, onConfirm, onDismiss }: CorrectionBannerProps) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-background-50 border border-background-200 rounded-xl px-5 py-3 flex items-center gap-4 shadow-lg">
      <div className="flex items-center gap-2">
        <div className="w-5 h-5 flex items-center justify-center">
          <i className="ri-magic-line text-accent-500"></i>
        </div>
        <p className="text-sm text-foreground-700">
          以后自动把「<strong className="text-accent-600">{from}</strong>」改成「<strong className="text-accent-600">{to}</strong>」？
        </p>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => { onConfirm(); setDismissed(true); }}
          className="px-4 py-1.5 bg-accent-500 text-background-50 rounded-full text-xs font-semibold hover:bg-accent-600 transition-colors cursor-pointer whitespace-nowrap"
        >
          确认
        </button>
        <button
          onClick={() => { onDismiss(); setDismissed(true); }}
          className="px-3 py-1.5 text-xs text-foreground-400 hover:text-foreground-600 cursor-pointer whitespace-nowrap"
        >
          忽略
        </button>
      </div>
    </div>
  );
}