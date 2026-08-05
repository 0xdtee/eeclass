import { useState, useRef, useEffect, useCallback } from 'react';
import ShotButton from '@/pages/home/components/ShotButton';

type RecordingStatus = 'idle' | 'recording' | 'paused';

interface RecordingControlsProps {
  onStatusChange?: (status: RecordingStatus) => void;
  sid?: string;
}

export default function RecordingControls({ onStatusChange, sid }: RecordingControlsProps) {
  const [status, setStatus] = useState<RecordingStatus>('idle');
  const [elapsed, setElapsed] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTimer = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const startTimer = useCallback(() => {
    clearTimer();
    intervalRef.current = setInterval(() => {
      setElapsed((prev) => prev + 1);
    }, 1000);
  }, [clearTimer]);

  useEffect(() => {
    return clearTimer;
  }, [clearTimer]);

  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const handleStart = () => {
    setStatus('recording');
    startTimer();
    onStatusChange?.('recording');
  };

  const handlePause = () => {
    setStatus('paused');
    clearTimer();
    onStatusChange?.('paused');
  };

  const handleResume = () => {
    setStatus('recording');
    startTimer();
    onStatusChange?.('recording');
  };

  const handleStop = () => {
    setStatus('idle');
    clearTimer();
    setElapsed(0);
    onStatusChange?.('idle');
  };

  return (
    <div className="flex items-center gap-4 p-4 bg-background-50 rounded-xl border border-background-200">
      <div className="flex items-center gap-2">
        {status === 'idle' && (
          <button
            onClick={handleStart}
            className="flex items-center gap-2 px-5 py-2.5 bg-primary-500 text-background-50 rounded-full text-sm font-semibold hover:bg-primary-600 transition-colors cursor-pointer whitespace-nowrap"
          >
            <i className="ri-mic-line text-lg"></i>
            开始录音
          </button>
        )}

        {status === 'recording' && (
          <>
            <button
              onClick={handlePause}
              className="w-10 h-10 flex items-center justify-center bg-accent-100 text-accent-700 rounded-full hover:bg-accent-200 transition-colors cursor-pointer"
              title="暂停"
            >
              <i className="ri-pause-line text-lg"></i>
            </button>
            <button
              onClick={handleStop}
              className="w-10 h-10 flex items-center justify-center bg-red-100 text-red-600 rounded-full hover:bg-red-200 transition-colors cursor-pointer"
              title="停止"
            >
              <i className="ri-stop-fill text-lg"></i>
            </button>
          </>
        )}

        {status === 'paused' && (
          <>
            <button
              onClick={handleResume}
              className="w-10 h-10 flex items-center justify-center bg-primary-100 text-primary-700 rounded-full hover:bg-primary-200 transition-colors cursor-pointer"
              title="继续"
            >
              <i className="ri-play-fill text-lg"></i>
            </button>
            <button
              onClick={handleStop}
              className="w-10 h-10 flex items-center justify-center bg-red-100 text-red-600 rounded-full hover:bg-red-200 transition-colors cursor-pointer"
              title="停止"
            >
              <i className="ri-stop-fill text-lg"></i>
            </button>
          </>
        )}
      </div>

      {/* Shot button during recording */}
      {status === 'recording' && sid && (
        <ShotButton sid={sid} currentTime={elapsed} />
      )}

      <div className="flex items-center gap-3 ml-auto">
        {status === 'recording' && (
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>
            <span className="text-xs font-medium text-red-600">录制中</span>
          </span>
        )}
        {status === 'paused' && (
          <span className="text-xs font-medium text-accent-600">已暂停</span>
        )}
        {status !== 'idle' && (
          <span className="text-sm font-mono text-foreground-600 min-w-[64px] text-right">
            {formatTime(elapsed)}
          </span>
        )}
      </div>
    </div>
  );
}