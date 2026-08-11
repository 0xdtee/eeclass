import { useEffect, useMemo, useRef, useState } from 'react';
import RecordingControls from '@/pages/home/components/RecordingControls';
import AudioPlayer from '@/components/feature/AudioPlayer';
import type { AudioPlayerHandle } from '@/components/feature/AudioPlayer';
import ShotStrip from '@/components/feature/ShotStrip';
import type { useLiveCaption } from '@/hooks/useLiveCaption';
import type { TranscriptLine } from '@/hooks/useRecords';
import type { Course, Shot } from '@/hooks/useLibrary';
import { audioUrl } from '@/hooks/useLibrary';
import { useT } from '@/lib/i18n';

type RecordingStatus = 'idle' | 'recording' | 'paused';

interface TranscriptionTabProps {
  sid: string;
  sessionTitle: string;
  onGenerateSummary: () => void;
  /** End recording: stop + auto-generate the AI summary (implemented at the home layer) */
  onEndRecording?: () => void;
  /** Start recording: clear the previously selected archived session before recording (implemented at the home layer); if not passed, just call live.start */
  onStartRecording?: (o: Parameters<ReturnType<typeof useLiveCaption>['start']>[0]) => void;
  /** Subject tags (syllabus names), checkable in the recording row, used as context for correction */
  subjectTags?: string[];
  /** When arriving via the main 「开始录音」: auto-open the naming box */
  autoStartNaming?: boolean;
  /** Course name prefilled when arriving from the timetable */
  initialCourseName?: string;
  /** Class notes */
  note?: string;
  noteStatus?: '' | 'saving' | 'saved';
  canNote?: boolean;
  onNoteChange?: (text: string) => void;
  isGenerating: boolean;
  /** The connection is held by the page layer: switching tabs unmounts this component, and the connection must not drop with it, or the captions already shown would be lost */
  live: ReturnType<typeof useLiveCaption>;
  historyLines: TranscriptLine[];
  shots: Shot[];
  courses: Course[];
  onEditLine: (lineId: number, text: string) => Promise<void>;
  /** Manually mark/unmark a line as a highlight (marked line-by-line in history, persisted) */
  onMarkLine?: (lineId: number, kind: 'key' | 'define' | null) => void;
  /** Rename a speaker after recording (by speaker_id, changing every line from that person) */
  onRenameSpeaker?: (speakerId: number, name: string) => void | Promise<void>;
  onProposeCorrection?: (from: string, to: string) => void;
  onShoot?: (file: File) => Promise<void>;
  onDeleteShot?: (shotId: string) => void;
  onNoteShot?: (shotId: string, note: string) => void;
  canEdit: boolean;
  /** Expose the seek capability to the page; flashcards/search results need it too */
  playerRef: React.RefObject<AudioPlayerHandle | null>;
  /** The line to scroll to and highlight when arriving from a search jump */
  focusLineId?: number | null;
}

/** Highlight = yellow, definition = light green, matching the colors written into Word */
// Use a 「马克笔」 gradient highlight: cover only the lower edge of the text, avoiding the whitespace above PingFang's em box,
// otherwise a solid fill over the whole line box makes the background look "too high" and misaligned with the text. box-decoration-clone makes each wrapped line highlight on its own.
const KIND_STYLE: Record<string, string> = {
  key: 'bg-[linear-gradient(transparent_20%,#fef08a_20%)] box-decoration-clone px-0.5',
  define: 'bg-[linear-gradient(transparent_20%,#bbf7d0_20%)] box-decoration-clone px-0.5',
};

/** Determine whether this edit changed just a single word -- if so, we can suggest adding it to the correction table */
function singleWordDiff(before: string, after: string): [string, string] | null {
  if (!before || !after || before === after) return null;
  let i = 0;
  while (i < before.length && i < after.length && before[i] === after[i]) i++;
  let j = 0;
  while (j < before.length - i && j < after.length - i
         && before[before.length - 1 - j] === after[after.length - 1 - j]) j++;
  const from = before.slice(i, before.length - j);
  const to = after.slice(i, after.length - j);
  if (!from || !to || from.length > 12 || to.length > 12) return null;
  return [from, to];
}

export default function TranscriptionTab({
  sid, sessionTitle, onGenerateSummary, onEndRecording, onStartRecording, autoStartNaming, initialCourseName, isGenerating, live, historyLines, shots, courses, subjectTags,
  note, noteStatus, canNote, onNoteChange,
  onEditLine, onMarkLine, onRenameSpeaker, onProposeCorrection, onShoot, onDeleteShot, onNoteShot, canEdit,
  playerRef, focusLineId,
}: TranscriptionTabProps) {
  const t = useT();
  const [recordingStatus, setRecordingStatus] = useState<RecordingStatus>('idle');
  const boxRef = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const [saveError, setSaveError] = useState('');
  const [curTime, setCurTime] = useState(0);
  const [shotsOnly, setShotsOnly] = useState(false);
  const [editSpk, setEditSpk] = useState<number | null>(null);   // id of the speaker being renamed
  const [spkDraft, setSpkDraft] = useState('');

  const commitSpeaker = (id: number) => {
    const name = spkDraft.trim();
    if (name) {
      if (live.running) live.rename(id, name);   // While recording: via WS, changed in real time
      else void onRenameSpeaker?.(id, name);     // After recording: via REST, persisted
      // Either way the server stores this person's voiceprint + name in this account's voiceprint library, to recognize them automatically later
    }
    setEditSpk(null);
    setSpkDraft('');
  };

  const isLive = live.lines.length > 0 || live.running;
  const liveMapped: TranscriptLine[] = live.lines.map((l) => ({
    id: l.id, ts: l.ts, speaker: l.speaker, speaker_id: l.speaker_id,
    text: l.text, kind: l.kind, new_para: l.new_para,
    start: l.start, end: l.end, translation: l.translation,
  } as TranscriptLine));
  // Continued recording: show the old transcript + what's newly said, joined together (when sid == the session being recorded and history exists);
  // For a fresh session historyLines is empty, so only live remains.
  const lines: TranscriptLine[] = !isLive
    ? historyLines
    : (sid && sid === live.liveSid && historyLines.length
        ? (() => {
            const ids = new Set(liveMapped.map((l) => l.id));
            return [...historyLines.filter((l) => !ids.has(l.id)), ...liveMapped];
          })()
        : liveMapped);

  // Speaker list: during recording from real-time stats; after recording (an editable past session) deduped out of the lines by speaker_id.
  const speakerRows = useMemo(() => {
    if (live.running) {
      return live.status.speakers.map((s) => ({ id: s.id, name: s.name, seconds: s.seconds as number | undefined }));
    }
    if (!canEdit) return [];
    const seen = new Map<number, string>();
    for (const l of lines) {
      if (l.speaker_id != null && !seen.has(l.speaker_id)) seen.set(l.speaker_id, l.speaker || '');
    }
    return Array.from(seen, ([id, name]) => ({ id, name, seconds: undefined as number | undefined }));
  }, [live.running, live.status.speakers, lines, canEdit]);

  const showPlayer = !isLive && !!sid && lines.length > 0;

  /** Which line is currently playing */
  const playingId = useMemo(() => {
    if (!showPlayer || curTime <= 0) return null;
    const hit = lines.find(
      (l) => (l.start ?? 0) <= curTime && curTime < (l.end ?? (l.start ?? 0) + 3)
    );
    return hit?.id ?? null;
  }, [lines, curTime, showPlayer]);

  useEffect(() => {
    if (!follow || !isLive) return;
    boxRef.current?.scrollTo({ top: boxRef.current.scrollHeight });
  }, [live.lines, live.partial, follow, isLive]);

  // Scroll along with playback
  useEffect(() => {
    if (!playingId || isLive) return;
    document.getElementById(`ln-${playingId}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [playingId, isLive]);

  // Arrived from a search result
  useEffect(() => {
    if (!focusLineId) return;
    const el = document.getElementById(`ln-${focusLineId}`);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [focusLineId, historyLines]);

  const exportText = () => {
    const text = lines.map((l) => `[${l.ts} ${l.speaker}] ${l.text}`).join('\n');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${sessionTitle || '课堂转写'}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const save = async (id: number, before: string) => {
    setSaveError('');
    try {
      await onEditLine(id, draft);
      const diff = singleWordDiff(before, draft);
      if (diff && onProposeCorrection) onProposeCorrection(diff[0], diff[1]);
      setEditingId(null);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    }
  };

  /** Insert screenshots into the transcript stream by time: returns which images go before this line */
  const shotsBefore = (l: TranscriptLine, prev: TranscriptLine | undefined) =>
    shots.filter((s) => s.at <= (l.start ?? 0) && s.at > (prev?.start ?? -1));

  return (
    <div className="space-y-5">
      <RecordingControls
        onStatusChange={setRecordingStatus}
        connected={live.connected}
        running={live.running}
        paused={live.paused}
        starting={live.starting}
        devices={live.devices}
        defaultDevice={live.defaultDevice}
        status={live.status}
        error={live.error}
        notice={live.notice}
        sessionTitle={sessionTitle}
        micActive={live.micActive}
        courses={courses}
        subjectTags={subjectTags}
        onShoot={onShoot}
        onStart={onStartRecording ?? ((o) => void live.start({ ...o }))}
        onStop={onEndRecording ?? live.stop}
        onPause={live.setPaused}
        autoStartNaming={autoStartNaming}
        initialCourseName={initialCourseName}
        onMark={live.mark}
      />

      {recordingStatus === 'recording' && (
        <div className="bg-accent-50 border border-accent-200 rounded-xl p-4 flex items-start gap-3">
          <div className="w-8 h-8 flex items-center justify-center flex-shrink-0 mt-0.5">
            <i className="ri-sound-module-line text-accent-500 text-xl"></i>
          </div>
          <div>
            <p className="text-sm font-medium text-accent-800">{t('实时转写中...')}</p>
            <p className="text-xs text-accent-600 mt-1">
              <span className="bg-yellow-100 px-1 rounded">{t('黄色')}</span>{t(' 为老师强调的重点，')}
              <span className="bg-green-100 px-1 rounded">{t('浅绿')}</span>{t(' 为定义句。')}
              {t('黑板上有内容时,点击「拍板书」,会自动对齐到当前时间点。')}
            </p>
          </div>
        </div>
      )}

      {/* Speaker: click the name to rename -- works both during and after recording. Once changed, this person's voiceprint is stored in your own
          voiceprint library, so recording the same person again automatically uses this name. */}
      {speakerRows.length > 0 && (
        <div className="bg-background-50 border border-background-200 rounded-xl px-4 py-3 flex items-center gap-2 flex-wrap">
          <span className="text-xs text-foreground-400 flex items-center gap-1 mr-1">
            <i className="ri-user-voice-line text-accent-500"></i>{t('说话人')}
            <span className="text-foreground-300">{t('（点名字改）')}</span>
          </span>
          {speakerRows.map((sp) => (
            editSpk === sp.id ? (
              <span key={sp.id} className="inline-flex items-center gap-1">
                <input
                  autoFocus
                  value={spkDraft}
                  onChange={(e) => setSpkDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') commitSpeaker(sp.id); if (e.key === 'Escape') { setEditSpk(null); setSpkDraft(''); } }}
                  onBlur={() => commitSpeaker(sp.id)}
                  placeholder={t('他是谁?')}
                  className="w-24 text-xs px-2 py-1 rounded-full border border-accent-300 bg-background-100 focus:outline-none focus:border-accent-500"
                />
              </span>
            ) : (
              <button
                key={sp.id}
                onClick={() => { setEditSpk(sp.id); setSpkDraft(/^(老师|同学\d+)$/.test(sp.name) ? '' : sp.name); }}
                className="group inline-flex items-center gap-1 pl-2.5 pr-2 py-1 bg-accent-100 text-accent-700 rounded-full text-xs font-medium hover:bg-accent-200 cursor-pointer"
                title={t('点击修改姓名(修改后自动存入声纹库,后续自动识别此人)')}
              >
                {sp.name || t('某人')}
                {sp.seconds != null && <span className="text-[10px] text-accent-500">{Math.round(sp.seconds)}s</span>}
                <i className="ri-pencil-line text-[11px] opacity-50 group-hover:opacity-100"></i>
              </button>
            )
          ))}
        </div>
      )}

      <div className="flex flex-col lg:flex-row gap-4 items-stretch">
      <div className="bg-background-50 border border-background-200 rounded-xl p-4 sm:p-6 lg:flex-1 min-w-0 w-full">
        {showPlayer && <AudioPlayer ref={playerRef} src={audioUrl(sid)} onTime={setCurTime} />}

        <div className="flex items-center justify-between my-4 gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 flex items-center justify-center">
              <i className="ri-file-text-line text-foreground-500 text-lg"></i>
            </div>
            <h3 className="text-sm font-semibold text-foreground-800">{t('课堂转写内容')}</h3>
            <span className="text-xs text-foreground-400">
              {t('{n} 句', { n: lines.length })}
              {shots.length > 0 && t(' · {n} 张板书', { n: shots.length })}
              {isLive ? t('（正在录制）') : canEdit ? (showPlayer ? t(' · 点句子跳到录音,点「修改」改文字') : t(' · 点句子后的「修改」可改文字')) : ''}
            </span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {shots.length > 0 && !isLive && (
              <label className="flex items-center gap-1.5 text-xs text-foreground-500 cursor-pointer">
                <input type="checkbox" checked={shotsOnly} onChange={(e) => setShotsOnly(e.target.checked)} className="cursor-pointer" />
                {t('只看板书')}
              </label>
            )}
            {isLive && (
              <label className="flex items-center gap-1.5 text-xs text-foreground-500 cursor-pointer">
                <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} className="cursor-pointer" />
                {t('自动滚动')}
              </label>
            )}
            <button
              onClick={exportText}
              disabled={lines.length === 0}
              className="flex items-center gap-1.5 px-3 py-2 bg-background-100 text-foreground-600 rounded-full text-xs font-medium hover:bg-background-200 transition-colors cursor-pointer whitespace-nowrap disabled:opacity-50"
            >
              <i className="ri-download-line text-sm"></i>{t('导出文本')}
            </button>
            <button
              data-guide="gen-summary"
              onClick={onGenerateSummary}
              disabled={isGenerating || lines.length === 0}
              className="flex items-center gap-1.5 px-4 py-2 bg-accent-500 text-background-50 rounded-full text-xs font-semibold hover:bg-accent-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap"
            >
              <i className={`${isGenerating ? 'ri-loader-4-line animate-spin' : 'ri-magic-line'} text-sm`}></i>
              {isGenerating ? t('DeepSeek 整理中...') : t('生成AI摘要')}
            </button>
          </div>
        </div>

        {saveError && <p className="text-xs text-red-600 mb-2">{saveError}</p>}

        {shotsOnly ? (
          <ShotStrip shots={shots} onSeek={(t) => playerRef.current?.seek(t)} onDelete={onDeleteShot} onNote={onNoteShot} />
        ) : (
          <div ref={boxRef} className="min-h-[360px] max-h-[560px] overflow-y-auto">
            {lines.length > 0 || shots.length > 0 ? (
              <div className="space-y-3">
                {lines.map((l, i) => {
                  const before = shotsBefore(l, lines[i - 1]);
                  return (
                    <div key={l.id}>
                      {before.length > 0 && (
                        <ShotStrip shots={before} onSeek={(t) => playerRef.current?.seek(t)} onDelete={onDeleteShot} onNote={onNoteShot} />
                      )}
                      <div
                        id={`ln-${l.id}`}
                        className={`${l.new_para ? 'pt-2' : ''} ${
                          playingId === l.id ? 'bg-blue-50 -mx-2 px-2 rounded' : ''
                        } ${focusLineId === l.id ? 'ring-2 ring-accent-300 -mx-2 px-2 rounded' : ''}`}
                      >
                        <button
                          onClick={() => showPlayer && playerRef.current?.seek(l.start ?? 0)}
                          className={`text-xs text-foreground-400 font-mono mr-2 ${
                            showPlayer ? 'hover:text-accent-600 cursor-pointer' : 'cursor-default'
                          }`}
                          title={showPlayer ? t('跳到这一句的录音') : undefined}
                        >
                          {l.ts}
                        </button>
                        <span className="text-xs font-medium text-accent-600 mr-2">{l.speaker}</span>
                        {!isLive && onMarkLine && (
                          <button
                            onClick={() => onMarkLine(l.id, l.kind === 'key' ? null : 'key')}
                            className={`mr-2 text-xs cursor-pointer align-middle ${
                              l.kind === 'key' ? 'text-yellow-500' : 'text-foreground-300 hover:text-yellow-500'
                            }`}
                            title={l.kind === 'key' ? t('取消重点') : t('标为重点')}
                          >
                            <i className={l.kind === 'key' ? 'ri-star-fill' : 'ri-star-line'}></i>
                          </button>
                        )}
                        {editingId === l.id ? (
                          <span className="flex flex-wrap items-center gap-2 mt-1">
                            <textarea
                              value={draft}
                              autoFocus
                              onChange={(e) => setDraft(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Escape') { e.preventDefault(); setEditingId(null); }
                                else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void save(l.id, l.text); }
                              }}
                              rows={2}
                              className="text-sm px-2 py-1 rounded border border-accent-300 w-full max-w-[560px] min-w-[180px]"
                            />
                            <span className="flex items-center gap-2 flex-shrink-0">
                              <button onClick={() => void save(l.id, l.text)} className="text-xs px-3 py-1.5 rounded bg-accent-500 text-background-50 cursor-pointer">{t('保存')}</button>
                              <button onClick={() => setEditingId(null)} className="text-xs px-3 py-1.5 rounded bg-background-100 text-foreground-600 cursor-pointer">{t('取消')}</button>
                              <span className="text-[11px] text-foreground-300">{t('Esc 退出')}</span>
                            </span>
                          </span>
                        ) : (
                          <>
                            {/* Click the text -> seek the recording to this line */}
                            <span
                              onClick={() => { if (showPlayer) playerRef.current?.seek(l.start ?? 0); }}
                              className={`text-sm leading-relaxed text-foreground-700 ${
                                KIND_STYLE[l.kind ?? ''] ?? ''
                              } ${showPlayer ? 'cursor-pointer hover:text-accent-700' : ''}`}
                              title={showPlayer ? t('跳到这一句的录音') : undefined}
                            >
                              {l.text}
                            </span>
                            {/* The 「修改」 button -> only then enter line-by-line editing */}
                            {canEdit && (
                              <button
                                onClick={() => { setEditingId(l.id); setDraft(l.text); }}
                                className="ml-2 text-xs text-foreground-300 hover:text-accent-600 cursor-pointer align-middle whitespace-nowrap"
                                title={t('修改这一句')}
                              >
                                <i className="ri-edit-line"></i> {t('修改')}
                              </button>
                            )}
                          </>
                        )}
                        {l.edited && <span className="text-xs text-accent-500 ml-2">{t('已修改')}</span>}
                        {l.translation && (
                          <div className="mt-1 flex items-start gap-1.5 text-[13px] leading-snug text-sky-700 bg-sky-50 border-l-2 border-sky-300 rounded-r px-2 py-1">
                            <i className="ri-translate-2 text-sky-400 mt-0.5 flex-shrink-0"></i>
                            <span>{l.translation}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
                {/* Board photos taken after the last line (just taken during the live session) -- shown immediately, no need to wait for the next line */}
                {(() => {
                  const lastStart = lines.length ? (lines[lines.length - 1].start ?? 0) : -1;
                  const trailing = shots.filter((s) => s.at > lastStart);
                  return trailing.length > 0 ? (
                    <ShotStrip shots={trailing} onSeek={(t) => playerRef.current?.seek(t)} onDelete={onDeleteShot} onNote={onNoteShot} />
                  ) : null;
                })()}
                {live.partial && <div className="text-sm text-foreground-400 italic">{live.partial} …</div>}
              </div>
            ) : (
              <p className="text-foreground-400 italic text-sm">
                {live.running
                  ? t('已开启麦克风,等待第一句话…')
                  : t('暂无转写内容，点上方「开始录音」，或去「历史课程」选一节已录好的课。')}
              </p>
            )}
          </div>
        )}
      </div>

      {canNote && (
        <div className="bg-background-50 border border-background-200 rounded-xl p-4 w-full lg:w-96 flex-shrink-0 flex flex-col">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-foreground-800 flex items-center gap-1.5">
              <i className="ri-sticky-note-line text-accent-500"></i>{t('我的笔记')}
            </h3>
            <span className="text-xs text-foreground-400">
              {noteStatus === 'saving' ? t('保存中…') : noteStatus === 'saved' ? t('✓ 已保存') : t('随时记录,自动保存')}
            </span>
          </div>
          <textarea
            value={note ?? ''}
            onChange={(e) => onNoteChange?.(e.target.value)}
            placeholder={t('在这里记笔记…(和这节课绑定,边听边记,自动保存)')}
            className="w-full flex-1 min-h-[360px] px-3 py-2.5 bg-background-100 border border-background-200 rounded-lg text-sm text-foreground-800 placeholder:text-foreground-300 focus:outline-none focus:border-accent-400 focus:ring-2 focus:ring-accent-100 transition-all resize-none leading-relaxed"
          />
        </div>
      )}
      </div>
    </div>
  );
}
