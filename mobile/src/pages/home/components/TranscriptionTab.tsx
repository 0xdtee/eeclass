import { useState, useRef, useCallback, useEffect } from 'react';
import RecordingControls from '@/pages/home/components/RecordingControls';
import AudioPlayer, { type AudioPlayerHandle } from '@/pages/home/components/AudioPlayer';
import { type CaptionLine } from '@/hooks/useLiveCaption';

type RecordingStatus = 'idle' | 'recording' | 'paused';

interface TranscriptionTabProps {
  transcription: string;
  lines?: CaptionLine[];
  sessionTitle: string;
  sessionId?: string;
  isHistory: boolean;
  onGenerateSummary: () => void;
  isGenerating: boolean;
  onTimeSeek?: (time: number) => void;
}

export default function TranscriptionTab({
  transcription,
  lines,
  sessionTitle,
  sessionId,
  isHistory,
  onGenerateSummary,
  isGenerating,
  onTimeSeek,
}: TranscriptionTabProps) {
  const [recordingStatus, setRecordingStatus] = useState<RecordingStatus>('idle');
  const [currentTime, setCurrentTime] = useState(0);
  const audioRef = useRef<AudioPlayerHandle>(null);
  const [shotsOnly, setShotsOnly] = useState(false);

  const displayLines: CaptionLine[] = lines && lines.length > 0
    ? lines
    : parseLegacyTranscription(transcription);

  const handleTimeClick = useCallback((start: number) => {
    if (audioRef.current) {
      audioRef.current.seekTo(start);
    }
    onTimeSeek?.(start);
  }, [onTimeSeek]);

  const handleTimeUpdate = useCallback((t: number) => {
    setCurrentTime(t);
  }, []);

  // Auto-scroll to current line
  const activeLineRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (activeLineRef.current) {
      activeLineRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [currentTime]);

  return (
    <div className="space-y-0">
      <RecordingControls onStatusChange={setRecordingStatus} />

      {isHistory && sessionId && (
        <AudioPlayer
          ref={audioRef}
          sid={sessionId}
          onTimeUpdate={handleTimeUpdate}
        />
      )}

      {recordingStatus === 'recording' && (
        <div className="bg-accent-50 border border-accent-200 rounded-xl p-4 flex items-start gap-3 mt-5">
          <div className="w-8 h-8 flex items-center justify-center flex-shrink-0 mt-0.5">
            <i className="ri-sound-module-line text-accent-500 text-xl"></i>
          </div>
          <div>
            <p className="text-sm font-medium text-accent-800">实时转写中...</p>
            <p className="text-xs text-accent-600 mt-1">
              当前正在录制「{sessionTitle}」，语音内容将自动转换为文字显示在下方。
            </p>
          </div>
        </div>
      )}

      <div className="bg-background-50 border border-background-200 rounded-xl overflow-hidden mt-5">
        <div className="flex items-center justify-between px-6 py-4 border-b border-background-100">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 flex items-center justify-center">
              <i className="ri-file-text-line text-foreground-500 text-lg"></i>
            </div>
            <h3 className="text-sm font-semibold text-foreground-800">课堂转写内容</h3>
          </div>
          <div className="flex items-center gap-2">
            {isHistory && (
              <label className="flex items-center gap-1.5 cursor-pointer">
                <span className="text-xs text-foreground-400">只看板书</span>
                <button
                  onClick={() => setShotsOnly(!shotsOnly)}
                  className={`relative w-8 h-4 rounded-full transition-colors cursor-pointer ${
                    shotsOnly ? 'bg-accent-500' : 'bg-background-300'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 w-3 h-3 rounded-full bg-background-50 transition-transform ${
                      shotsOnly ? 'left-[17px]' : 'left-0.5'
                    }`}
                  ></span>
                </button>
              </label>
            )}
            <button
              onClick={onGenerateSummary}
              disabled={isGenerating || (!transcription && displayLines.length === 0)}
              className="flex items-center gap-1.5 px-4 py-2 bg-accent-500 text-background-50 rounded-full text-xs font-semibold hover:bg-accent-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap"
            >
              <i className={`${isGenerating ? 'ri-loader-4-line animate-spin' : 'ri-magic-line'} text-sm`}></i>
              {isGenerating ? '生成中...' : '生成AI摘要'}
            </button>
          </div>
        </div>

        <div className="p-6 min-h-[360px]">
          {displayLines.length === 0 ? (
            <p className="text-foreground-400 italic text-sm">
              {recordingStatus === 'recording'
                ? '正在等待语音输入...'
                : '暂无转写内容，请点击上方「开始录音」录制课堂内容。'}
            </p>
          ) : (
            <div className="space-y-1">
              {displayLines.map((line, idx) => {
                const isActive = isHistory && currentTime >= line.start && currentTime < line.end;
                return (
                  <div
                    key={line.line_id || idx}
                    ref={isActive ? activeLineRef : undefined}
                    className={`flex gap-3 py-1.5 px-2 -mx-2 rounded-lg transition-colors duration-200 text-sm ${
                      isActive ? 'bg-accent-100/70' : ''
                    }`}
                  >
                    <button
                      onClick={() => isHistory && handleTimeClick(line.start)}
                      className={`text-xs font-mono flex-shrink-0 pt-0.5 w-[70px] text-right ${
                        isHistory
                          ? 'text-accent-600 hover:text-accent-800 cursor-pointer hover:underline'
                          : 'text-foreground-400'
                      }`}
                      disabled={!isHistory}
                    >
                      {line.ts}
                    </button>
                    <span className="text-xs font-medium text-foreground-500 flex-shrink-0 pt-0.5 w-[50px]">{line.speaker}</span>
                    <span className="text-foreground-700 leading-relaxed">{line.text}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Fallback: parse legacy plain text transcription into lines
function parseLegacyTranscription(text: string): CaptionLine[] {
  if (!text) return [];
  const lines: CaptionLine[] = [];
  let lineIdx = 0;
  let currentSpeaker = '';
  const segments = text.split('\n').filter(Boolean);

  for (const seg of segments) {
    const speakerMatch = seg.match(/^【(.+?)】/);
    if (speakerMatch) {
      currentSpeaker = speakerMatch[1];
    }
    const content = seg.replace(/^【.+?】/, '').trim();
    if (content) {
      lines.push({
        line_id: lineIdx++,
        ts: '',
        start: 0,
        end: 0,
        speaker: currentSpeaker || '',
        text: content,
      });
    }
  }
  return lines;
}