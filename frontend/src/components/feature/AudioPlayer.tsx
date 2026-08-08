/**
 * 录音回放条。识别有错字时能立刻听原声核对,这是复习时最常用的动作。
 * forwardRef 暴露 seek(),转写里点句子/时间戳可跳到对应录音位置。
 * 进度条 max 优先用已知时长(durationHint),元数据没读到也能拖;播一段自动暂停其他段。
 */
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';

export interface AudioPlayerHandle {
  seek: (seconds: number, play?: boolean) => void;
}

interface AudioPlayerProps {
  src: string;
  onTime?: (t: number) => void;
  /** 已知时长(秒);元数据没读到时用它渲染进度条,保证可拖 */
  durationHint?: number;
  /** 传了就用内联样式(列表里),不传就用转写页顶部的 sticky 样式 */
  className?: string;
}

const SPEEDS = [0.75, 1, 1.25, 1.5, 2];

const fmt = (s: number) => {
  if (!Number.isFinite(s)) return '--:--';
  const x = Math.floor(s);
  const h = Math.floor(x / 3600);
  const m = Math.floor((x % 3600) / 60);
  const sec = x % 60;
  const p = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${p(h)}:${p(m)}:${p(sec)}` : `${p(m)}:${p(sec)}`;
};

const AudioPlayer = forwardRef<AudioPlayerHandle, AudioPlayerProps>(({ src, onTime, durationHint = 0, className }, ref) => {
  const el = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(durationHint || 0);
  const [speed, setSpeed] = useState(1);
  const [error, setError] = useState('');

  useImperativeHandle(ref, () => ({
    seek(seconds, play = true) {
      const a = el.current;
      if (!a) return;
      a.currentTime = Math.max(0, seconds);
      if (play) void a.play().catch(() => undefined);
    },
  }));

  useEffect(() => {
    const a = el.current;
    if (!a) return;
    a.playbackRate = speed;
  }, [speed]);

  const total = dur || durationHint || 0;

  const audio = (
    <audio
      ref={el}
      src={src}
      preload="metadata"
      onLoadedMetadata={(e) => { const d = e.currentTarget.duration; if (Number.isFinite(d) && d > 0) setDur(d); }}
      onDurationChange={(e) => { const d = e.currentTarget.duration; if (Number.isFinite(d) && d > 0) setDur(d); }}
      onTimeUpdate={(e) => { setCur(e.currentTarget.currentTime); onTime?.(e.currentTarget.currentTime); }}
      onPlay={() => {
        setPlaying(true);
        // 同一时刻只放一段:开始播放时暂停页面上其他所有 audio
        document.querySelectorAll('audio').forEach((a) => { if (a !== el.current) a.pause(); });
      }}
      onPause={() => setPlaying(false)}
      onEnded={() => { setPlaying(false); }}
      onError={() => setError('这节课的录音文件读不到')}
    />
  );

  const controls = error ? (
    <p className="text-xs text-foreground-400">{error}</p>
  ) : (
    <div className="flex items-center gap-3 w-full">
      <button
        onClick={() => {
          const a = el.current;
          if (!a) return;
          if (a.paused) void a.play().catch(() => undefined);
          else a.pause();
        }}
        className="w-9 h-9 flex items-center justify-center rounded-full bg-primary-500 text-background-50 hover:bg-primary-600 transition-colors cursor-pointer flex-shrink-0"
        title={playing ? '暂停' : '播放'}
      >
        <i className={`${playing ? 'ri-pause-fill' : 'ri-play-fill'} text-lg`}></i>
      </button>
      <span className="text-xs font-mono text-foreground-500 w-12 text-right flex-shrink-0">{fmt(cur)}</span>
      <input
        type="range"
        min={0}
        max={total || 0}
        step={0.1}
        value={Math.min(cur, total || cur)}
        onChange={(e) => { const a = el.current; if (a) { const t = Number(e.target.value); a.currentTime = t; setCur(t); } }}
        className="flex-1 h-1 accent-primary-500 cursor-pointer"
      />
      <span className="text-xs font-mono text-foreground-400 w-12 flex-shrink-0">{fmt(total)}</span>
      <select
        value={speed}
        onChange={(e) => setSpeed(Number(e.target.value))}
        className="text-xs px-2 py-1 rounded border border-background-200 bg-background-50 text-foreground-600 cursor-pointer flex-shrink-0"
        title="倍速"
      >
        {SPEEDS.map((s) => (<option key={s} value={s}>{s}x</option>))}
      </select>
    </div>
  );

  // 传了 className = 列表里的内联样式;否则 = 转写页顶部 sticky 播放条
  const wrap = className
    ? `flex items-center bg-background-100 rounded-full px-3 py-1.5 ${className}`
    : 'sticky top-14 z-20 -mx-6 px-6 py-2.5 bg-background-50/95 backdrop-blur-sm border-b border-background-200';

  return (
    <div className={wrap}>
      {audio}
      {controls}
    </div>
  );
});

AudioPlayer.displayName = 'AudioPlayer';
export default AudioPlayer;
