import { useState, useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
import { SERVICE_ORIGIN } from '@/lib/api';

export interface AudioPlayerHandle {
  seekTo: (time: number) => void;
  getCurrentTime: () => number;
}

interface AudioPlayerProps {
  sid: string;
  onTimeUpdate?: (currentTime: number) => void;
}

const SPEEDS = [0.75, 1, 1.25, 1.5, 2];

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

const AudioPlayer = forwardRef<AudioPlayerHandle, AudioPlayerProps>(
  function AudioPlayer({ sid, onTimeUpdate }, ref) {
    const audioRef = useRef<HTMLAudioElement>(null);
    const [playing, setPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [speed, setSpeed] = useState(1);
    const [speedOpen, setSpeedOpen] = useState(false);
    const [error, setError] = useState('');

    const audioUrl = `${SERVICE_ORIGIN}/api/audio/${sid}`;

    useImperativeHandle(ref, () => ({
      seekTo: (time: number) => {
        const audio = audioRef.current;
        if (audio) {
          audio.currentTime = time;
          audio.play().catch(() => {});
          setPlaying(true);
        }
      },
      getCurrentTime: () => audioRef.current?.currentTime || 0,
    }));

    const onPlay = useCallback(() => setPlaying(true), []);
    const onPause = useCallback(() => setPlaying(false), []);
    const onEnded = useCallback(() => setPlaying(false), []);

    const onTimeUpdateHandler = useCallback(() => {
      const audio = audioRef.current;
      if (!audio) return;
      const t = audio.currentTime;
      setCurrentTime(t);
      onTimeUpdate?.(t);
    }, [onTimeUpdate]);

    const onLoadedMetadata = useCallback(() => {
      const audio = audioRef.current;
      if (!audio) return;
      setDuration(audio.duration);
    }, []);

    const onAudioError = useCallback(() => {
      setError('音频加载失败');
    }, []);

    const togglePlay = useCallback(() => {
      const audio = audioRef.current;
      if (!audio) return;
      if (audio.paused) {
        audio.play().catch(() => {});
      } else {
        audio.pause();
      }
    }, []);

    const handleSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
      const audio = audioRef.current;
      if (!audio) return;
      const t = parseFloat(e.target.value);
      audio.currentTime = t;
      setCurrentTime(t);
    }, []);

    const setPlaybackSpeed = useCallback((s: number) => {
      const audio = audioRef.current;
      if (!audio) return;
      audio.playbackRate = s;
      setSpeed(s);
      setSpeedOpen(false);
    }, []);

    // Keyboard: Space to toggle play
    useEffect(() => {
      const handler = (e: KeyboardEvent) => {
        if (e.key === ' ' && e.target === document.body) {
          e.preventDefault();
          togglePlay();
        }
      };
      document.addEventListener('keydown', handler);
      return () => document.removeEventListener('keydown', handler);
    }, [togglePlay]);

    return (
      <div className="sticky top-14 z-20 bg-background-50 border-b border-background-200 px-4 py-3">
        {error && (
          <p className="text-xs text-red-500 mb-2">{error}</p>
        )}
        <div className="flex items-center gap-3">
          {/* Play/Pause */}
          <button
            onClick={togglePlay}
            className="w-9 h-9 flex items-center justify-center rounded-full bg-accent-500 text-background-50 hover:bg-accent-600 transition-colors cursor-pointer flex-shrink-0"
          >
            <i className={`${playing ? 'ri-pause-fill' : 'ri-play-fill'} text-lg`}></i>
          </button>

          {/* Time */}
          <span className="text-xs font-mono text-foreground-500 flex-shrink-0 w-[72px] text-right">
            {formatTime(currentTime)}
          </span>

          {/* Progress */}
          <div className="flex-1 relative">
            <input
              type="range"
              min={0}
              max={duration || 0}
              step={0.1}
              value={currentTime}
              onChange={handleSeek}
              className="w-full h-1.5 bg-background-200 rounded-full appearance-none cursor-pointer accent-accent-500"
              style={{
                background: duration > 0
                  ? `linear-gradient(to right, oklch(var(--accent-500)) ${(currentTime / duration) * 100}%, oklch(var(--background-200)) ${(currentTime / duration) * 100}%)`
                  : undefined,
              }}
            />
          </div>

          {/* Duration */}
          <span className="text-xs font-mono text-foreground-400 flex-shrink-0 w-[72px]">
            {formatTime(duration)}
          </span>

          {/* Speed */}
          <div className="relative flex-shrink-0">
            <button
              onClick={() => setSpeedOpen(!speedOpen)}
              className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-foreground-500 hover:bg-background-100 transition-colors cursor-pointer whitespace-nowrap"
            >
              {speed}x
              <i className={`ri-arrow-down-s-line text-xs transition-transform ${speedOpen ? 'rotate-180' : ''}`}></i>
            </button>
            {speedOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setSpeedOpen(false)}></div>
                <div className="absolute right-0 top-full mt-1 z-20 bg-background-50 rounded-lg border border-background-200 py-1 min-w-[80px]">
                  {SPEEDS.map((s) => (
                    <button
                      key={s}
                      onClick={() => setPlaybackSpeed(s)}
                      className={`w-full text-left px-3 py-1.5 text-xs transition-colors cursor-pointer whitespace-nowrap ${
                        speed === s ? 'text-accent-600 font-semibold bg-accent-50' : 'text-foreground-600 hover:bg-background-100'
                      }`}
                    >
                      {s}x
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        <audio
          ref={audioRef}
          src={audioUrl}
          preload="metadata"
          onPlay={onPlay}
          onPause={onPause}
          onEnded={onEnded}
          onTimeUpdate={onTimeUpdateHandler}
          onLoadedMetadata={onLoadedMetadata}
          onError={onAudioError}
          className="hidden"
        />
      </div>
    );
  }
);

export default AudioPlayer;