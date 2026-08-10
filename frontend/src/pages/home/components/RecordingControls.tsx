import { useEffect, useMemo, useRef, useState } from 'react';
import type { AudioDevice, LiveStatus } from '@/hooks/useLiveCaption';
import { SERVICE_ORIGIN, getToken, setToken } from '@/hooks/useLiveCaption';
import { loadSettings } from '@/lib/settings';
import { useAuth } from '@/hooks/useAuth';
import { useT, t } from '@/lib/i18n';
import { TRANS_LANGS, type TransLang } from '@/lib/translateLangs';

// Cloud models regular users may pick; local/technical models are admin-only.
const CLOUD_MODELS = ['aliyun', 'aliyun_wu', 'aliyun_multi'] as const;

function defaultCourseName(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${t('课程')} ${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

type RecordingStatus = 'idle' | 'recording' | 'paused';

interface RecordingControlsProps {
  onStatusChange?: (status: RecordingStatus) => void;
  connected: boolean;
  running: boolean;
  paused: boolean;
  starting: boolean;
  devices: AudioDevice[];
  defaultDevice: string | null;
  status: LiveStatus;
  error: string;
  notice: string;
  sessionTitle: string;
  micActive: boolean;
  courses: { id: string; name: string }[];
  /** Subject tags (syllabus names), checkable, providing subject context for correction */
  subjectTags?: string[];
  /** Photograph board notes while recording. Returns a Promise for showing success/failure */
  onShoot?: (file: File) => Promise<void>;
  onStart: (opts: {
    device: string | null;
    sensitivity: 'std' | 'high' | 'max';
    toWord: boolean;
    courseId: string | null;
    model: 'sensevoice' | 'paraformer' | 'stream' | 'shanghainese' | 'aliyun' | 'aliyun_wu' | 'aliyun_multi';
    title: string;
    aiCorrect: boolean;
    smartSeg: boolean;
    translateFrom: TransLang;
    translateTo: TransLang;
    subjects: string[];
  }) => void;
  onStop: () => void;
  onPause: (v: boolean) => void;
  onMark: () => void;
  autoStartNaming?: boolean;
  initialCourseName?: string;
}

const formatTime = (seconds: number) => {
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
};

export default function RecordingControls({
  onStatusChange,
  connected,
  running,
  paused,
  starting,
  devices,
  defaultDevice,
  status,
  error,
  notice,
  micActive,
  courses,
  subjectTags,
  onShoot,
  onStart,
  onStop,
  onPause,
  onMark,
  autoStartNaming,
  initialCourseName,
}: RecordingControlsProps) {
  const t = useT();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';   // Only admins may pick local/technical models
  const [defaults] = useState(loadSettings);   // Defaults from settings (remembered on this device)
  const [device, setDevice] = useState<string | null>(null);
  const [sensitivity, setSensitivity] = useState<'std' | 'high' | 'max'>(defaults.sensitivity);
  const [model, setModel] = useState<'sensevoice' | 'paraformer' | 'stream' | 'shanghainese' | 'aliyun' | 'aliyun_wu' | 'aliyun_multi'>(defaults.model);
  const [toWord] = useState(defaults.toWord);   // No more inline toggle, use the settings default (off by default)
  const [courseId] = useState<string>('');   // Inline course binding is now handled by subject tags, so this stays empty
  const [shotState, setShotState] = useState<'' | 'busy' | 'ok' | 'err'>('');
  const [confirm, setConfirm] = useState<'' | 'pause' | 'stop'>('');   // Confirmation: pause / stop
  const [courseName, setCourseName] = useState(() => initialCourseName?.trim() || defaultCourseName());   // Inline course name, prefilled and editable
  const nameRef = useRef<HTMLInputElement>(null);
  const [aiCorrect, setAiCorrect] = useState(defaults.aiCorrect);  // AI real-time correction toggle (defaults from settings)
  const [smartSeg, setSmartSeg] = useState(defaults.smartSeg);     // AI smart sentence splitting (defaults from settings)
  const [translateFrom, setTranslateFrom] = useState(defaults.translateFrom);   // source language (原文); off when from === to
  const [translateTo, setTranslateTo] = useState(defaults.translateTo);         // target language (译文); default follows the UI language
  const [subjects, setSubjects] = useState<string[]>([]);         // Checked subject tags
  const [subjOpen, setSubjOpen] = useState(false);                // Whether the subject-tag dropdown is expanded
  const toggleSubject = (name: string) =>
    setSubjects((prev) => (prev.includes(name) ? prev.filter((x) => x !== name) : [...prev, name]));

  // Opened somewhere other than the machine running the service (phone/tablet/another computer),
  // so picking the server's sound card is pointless; default to this device's microphone.
  const isRemote =
    typeof window !== 'undefined' &&
    !['localhost', '127.0.0.1'].includes(window.location.hostname);

  useEffect(() => {
    if (device !== null) return;
    // Use the default audio source if one is set in settings; otherwise automatic (browser mic when remote, sound card when local)
    if (defaults.device !== 'auto') { setDevice(defaults.device); return; }
    setDevice(isRemote ? 'browser' : defaultDevice);
  }, [defaultDevice, device, isRemote, defaults.device]);

  // Arriving via the main 「开始录音」: auto-focus the course-name input so you can rename directly / press Enter to start
  const didAutoName = useRef(false);
  useEffect(() => {
    if (autoStartNaming && !didAutoName.current) {
      didAutoName.current = true;
      nameRef.current?.focus();
      nameRef.current?.select();
    }
  }, [autoStartNaming]);

  // Non-admins can only use cloud models; if a local model was remembered, snap to cloud.
  useEffect(() => {
    if (!isAdmin && !CLOUD_MODELS.includes(model as (typeof CLOUD_MODELS)[number])) setModel('aliyun');
  }, [isAdmin, model]);

  const uiStatus: RecordingStatus = running ? (paused ? 'paused' : 'recording') : 'idle';
  useEffect(() => {
    onStatusChange?.(uiStatus);
  }, [uiStatus, onStatusChange]);

  const backlogWarn = status.backlog > 3;
  const levelPct = useMemo(() => Math.min(100, status.level * 180), [status.level]);

  const [tokenInput, setTokenInput] = useState('');

  // Consistent style: dropdowns use appearance-none pills + a hand-drawn arrow; toggles use filled/outlined pills
  const selCls = 'appearance-none text-xs pl-3 pr-8 py-2 rounded-full bg-background-100 border border-background-200 text-foreground-700 cursor-pointer hover:bg-background-200 transition-colors focus:outline-none focus:ring-2 focus:ring-primary-100 max-w-[240px] truncate';
  const pillCls = (on: boolean) =>
    `text-xs px-3.5 py-2 rounded-full border cursor-pointer transition-colors whitespace-nowrap ${on ? 'bg-accent-500 text-background-50 border-accent-500 font-medium' : 'bg-background-100 text-foreground-500 border-background-200 hover:bg-background-200'}`;

  return (
    <div className="bg-background-50 rounded-xl border border-background-200">
      {(error || (!connected && !getToken())) && (
        <div className="px-4 py-3 border-b border-red-200 bg-red-50 rounded-t-xl space-y-2">
          {error && (
            <p className="text-xs text-red-700 leading-relaxed">
              <i className="ri-error-warning-line mr-1"></i>
              {error}
            </p>
          )}
          {!getToken() && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-red-700">
                {t('需要访问令牌（启动服务的那个黑窗口里有）：')}
              </span>
              <input
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                placeholder={t('粘贴令牌')}
                className="text-xs px-2 py-1.5 rounded border border-red-200 bg-background-50"
              />
              <button
                onClick={() => {
                  if (!tokenInput.trim()) return;
                  setToken(tokenInput);
                  window.location.reload();
                }}
                className="text-xs px-3 py-1.5 rounded bg-red-600 text-background-50 cursor-pointer"
              >
                {t('保存并重连')}
              </button>
            </div>
          )}
          <p className="text-xs text-red-600">
            {t('服务地址：')}
            <a
              href={`${SERVICE_ORIGIN}/health`}
              target="_blank"
              rel="noreferrer"
              className="underline cursor-pointer"
            >
              {SERVICE_ORIGIN}/health
            </a>
            {t('（手机上先打开这个链接，选「继续访问」信任证书）')}
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-4 p-4">
        <div className="flex items-center gap-2">
          {uiStatus === 'idle' && (
            <>
              <input
                ref={nameRef}
                data-guide="rec-name"
                type="text"
                value={courseName}
                onChange={(e) => setCourseName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && connected && !starting) {
                    onStart({ device, sensitivity, toWord, courseId: courseId || null, model, title: courseName.trim() || defaultCourseName(), aiCorrect, smartSeg, translateFrom, translateTo, subjects });
                  }
                }}
                placeholder={t('课程名称(如 高数第3讲)')}
                title={t('这节课的名字,可以直接改')}
                className="px-3 py-2.5 bg-background-100 border border-background-200 rounded-lg text-sm text-foreground-800 focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100 w-[190px]"
              />
              <button
                data-guide="rec-start"
                onClick={() => onStart({ device, sensitivity, toWord, courseId: courseId || null, model, title: courseName.trim() || defaultCourseName(), aiCorrect, smartSeg, translateFrom, translateTo, subjects })}
                disabled={!connected || starting}
                className="flex items-center gap-2 px-5 py-2.5 bg-primary-500 text-background-50 rounded-full text-sm font-semibold hover:bg-primary-600 transition-colors cursor-pointer whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <i className={`${starting ? 'ri-loader-4-line animate-spin' : 'ri-mic-line'} text-lg`}></i>
                {starting ? t('正在启动…') : t('开始录音')}
              </button>
            </>
          )}

          {uiStatus !== 'idle' && confirm !== '' && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm text-foreground-700">
                {confirm === 'pause' ? t('确认暂停录制？') : t('确认结束录制？结束后会自动生成 AI 概要。')}
              </span>
              <button
                onClick={() => { const c = confirm; setConfirm(''); if (c === 'pause') onPause(true); else onStop(); }}
                className={`px-4 py-2 rounded-full text-sm font-semibold text-background-50 cursor-pointer whitespace-nowrap ${
                  confirm === 'pause' ? 'bg-accent-500 hover:bg-accent-600' : 'bg-red-500 hover:bg-red-600'
                }`}
              >
                {t('确认')}{confirm === 'pause' ? t('暂停') : t('结束')}
              </button>
              <button
                onClick={() => setConfirm('')}
                className="px-4 py-2 rounded-full text-sm font-medium bg-background-100 text-foreground-600 hover:bg-background-200 cursor-pointer whitespace-nowrap"
              >
                {t('取消')}
              </button>
            </div>
          )}

          {uiStatus !== 'idle' && confirm === '' && (
            <>
              {uiStatus === 'recording' ? (
                <button
                  onClick={() => setConfirm('pause')}
                  className="flex items-center gap-1.5 px-4 py-2 bg-accent-100 text-accent-700 rounded-full text-sm font-medium hover:bg-accent-200 transition-colors cursor-pointer whitespace-nowrap"
                >
                  <i className="ri-pause-line text-base"></i>{t('暂停录制')}
                </button>
              ) : (
                <button
                  onClick={() => onPause(false)}
                  className="flex items-center gap-1.5 px-4 py-2 bg-primary-100 text-primary-700 rounded-full text-sm font-medium hover:bg-primary-200 transition-colors cursor-pointer whitespace-nowrap"
                >
                  <i className="ri-play-fill text-base"></i>{t('继续录制')}
                </button>
              )}
              <button
                data-guide="rec-stop"
                onClick={() => setConfirm('stop')}
                className="flex items-center gap-1.5 px-4 py-2 bg-red-100 text-red-600 rounded-full text-sm font-medium hover:bg-red-200 transition-colors cursor-pointer whitespace-nowrap"
              >
                <i className="ri-stop-fill text-base"></i>{t('结束录制')}
              </button>
              <button
                data-guide="rec-mark"
                onClick={onMark}
                className="flex items-center gap-1.5 px-3 py-2 bg-yellow-100 text-yellow-800 rounded-full text-xs font-medium hover:bg-yellow-200 transition-colors cursor-pointer whitespace-nowrap"
                title={t('把刚说过的那句标为重点')}
              >
                <i className="ri-star-line"></i>
                {t('标记重点')}
              </button>

              {onShoot && (
                <label
                  data-guide="rec-shoot"
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                    shotState === 'ok'
                      ? 'bg-green-100 text-green-700'
                      : shotState === 'err'
                        ? 'bg-red-100 text-red-700'
                        : 'bg-background-100 text-foreground-600 hover:bg-background-200'
                  }`}
                  title={t('拍一张黑板/PPT，自动对齐到当前时间点')}
                >
                  <i className={shotState === 'busy' ? 'ri-loader-4-line animate-spin' : 'ri-camera-line'}></i>
                  {shotState === 'ok' ? t('已保存') : shotState === 'busy' ? t('上传中') : t('拍板书')}
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      e.target.value = '';
                      if (!f) return;
                      setShotState('busy');
                      try {
                        await onShoot(f);
                        setShotState('ok');
                      } catch {
                        setShotState('err');
                      }
                      setTimeout(() => setShotState(''), 2000);
                    }}
                  />
                </label>
              )}
            </>
          )}
        </div>

        {uiStatus === 'idle' && (
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative inline-flex">
              <select value={device ?? ''} onChange={(e) => setDevice(e.target.value)} className={selCls} title={t('声音来源:本设备麦克风 / 电脑声卡 / 电脑系统声音(网课)')}>
                <option value="browser">{t('📱 本设备麦克风')}</option>
                <option value="browser-system">{t('🔊 本设备系统声音')}</option>
                {devices.map((d) => (
                  <option key={d.id} value={d.id}>{d.shaky ? '⚠ ' : ''}{d.kind === 'loopback' ? '🔊 ' : '🎤 '}{d.name}</option>
                ))}
              </select>
              <i className="ri-arrow-down-s-line absolute right-2.5 top-1/2 -translate-y-1/2 text-foreground-400 pointer-events-none text-sm"></i>
            </div>

            <div className="relative inline-flex">
              <select value={model} onChange={(e) => setModel(e.target.value as 'sensevoice' | 'paraformer' | 'stream' | 'shanghainese' | 'aliyun' | 'aliyun_wu' | 'aliyun_multi')} className={selCls} title={isAdmin ? t('普通话/英语·方言·多语言=云端识别(需联网);SenseVoice=整句·最准;Paraformer=整句·对照;流式=边说边出字;上海话(本地)=本机吴语识别') : t('普通话/英语=云端普通话/英语识别;方言=云端多方言识别(粤/吴/闽/客/川等16种),自动转普通话;多语言=云端识别法/德/意/西/俄/日/韩等,再配合右侧翻译出字幕')}>
                <option value="aliyun">{t('普通话/英语')}</option>
                <option value="aliyun_wu">{t('方言')}</option>
                <option value="aliyun_multi">{t('多语言')}</option>
                {isAdmin && (
                  <>
                    <option value="sensevoice">🎯 SenseVoice</option>
                    <option value="paraformer">🔬 Paraformer</option>
                    <option value="stream">{t('⚡ 流式')}</option>
                    <option value="shanghainese">{t('🗣️ 上海话(本地)')}</option>
                  </>
                )}
              </select>
              <i className="ri-arrow-down-s-line absolute right-2.5 top-1/2 -translate-y-1/2 text-foreground-400 pointer-events-none text-sm"></i>
            </div>

            {/* Live translation: [source 原文] ⇄ [target 译文]. Off when source === target. */}
            <div className="inline-flex items-center gap-1" title={t('给字幕加一行翻译:左边说的语言,右边译成的语言;相同则不翻译')}>
              <div className="relative inline-flex">
                <select value={translateFrom} onChange={(e) => setTranslateFrom(e.target.value as TransLang)} className={selCls} title={t('原文语言(说的是什么语言)')}>
                  {TRANS_LANGS.map((l) => <option key={l.code} value={l.code}>{t(l.label)}</option>)}
                </select>
                <i className="ri-arrow-down-s-line absolute right-2.5 top-1/2 -translate-y-1/2 text-foreground-400 pointer-events-none text-sm"></i>
              </div>
              <button
                type="button"
                onClick={() => { setTranslateFrom(translateTo); setTranslateTo(translateFrom); }}
                title={t('交换原文和译文')}
                className="w-7 h-7 flex items-center justify-center rounded-full text-foreground-500 hover:bg-background-200 cursor-pointer flex-shrink-0"
              >
                <i className="ri-arrow-left-right-line text-sm"></i>
              </button>
              <div className="relative inline-flex">
                <select value={translateTo} onChange={(e) => setTranslateTo(e.target.value as TransLang)} className={selCls} title={t('译文语言(翻译成什么语言)')}>
                  {TRANS_LANGS.map((l) => <option key={l.code} value={l.code}>{t(l.label)}</option>)}
                </select>
                <i className="ri-arrow-down-s-line absolute right-2.5 top-1/2 -translate-y-1/2 text-foreground-400 pointer-events-none text-sm"></i>
              </div>
            </div>

            {/* Subject tags: check the subjects this session covers (syllabus names) to give AI correction/translation context, for better accuracy */}
            <div className="relative inline-flex">
              <button
                type="button"
                onClick={() => setSubjOpen((v) => !v)}
                className={`text-xs pl-3 pr-8 py-2 rounded-full border cursor-pointer transition-colors relative ${subjects.length ? 'bg-accent-500 text-background-50 border-accent-500 font-medium' : 'bg-background-100 text-foreground-600 border-background-200 hover:bg-background-200'}`}
                title={t('勾选这节课涉及的学科,纠错会往对应学科的术语方向纠,更准(可多选)')}
              >
                🏷 {subjects.length ? t('学科·{n}', { n: subjects.length }) : t('学科标签')}
                <i className="ri-arrow-down-s-line absolute right-2.5 top-1/2 -translate-y-1/2 text-sm"></i>
              </button>
              {subjOpen && (
                <>
                  <div className="fixed inset-0 z-20" onClick={() => setSubjOpen(false)}></div>
                  <div className="absolute z-30 top-full mt-1.5 left-0 w-72 max-h-72 overflow-y-auto bg-background-50 border border-background-200 rounded-xl shadow-lg p-2.5">
                    <p className="text-[11px] text-foreground-400 px-1 pb-2 leading-relaxed">{t('勾选这节课涉及的学科,AI 纠错会往对应学科术语方向纠(可多选)。')}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {(subjectTags ?? []).map((name) => {
                        const on = subjects.includes(name);
                        return (
                          <button
                            key={name}
                            type="button"
                            onClick={() => toggleSubject(name)}
                            className={`text-xs px-2.5 py-1 rounded-full border cursor-pointer transition-colors ${on ? 'bg-accent-500 text-background-50 border-accent-500 font-medium' : 'bg-background-100 text-foreground-600 border-background-200 hover:bg-background-200'}`}
                          >
                            {on ? '✓ ' : ''}{name}
                          </button>
                        );
                      })}
                      {(subjectTags ?? []).length === 0 && (
                        <span className="text-xs text-foreground-400 px-1 py-1">{t('学科标签加载中…')}</span>
                      )}
                    </div>
                    {subjects.length > 0 && (
                      <button type="button" onClick={() => setSubjects([])} className="mt-2.5 text-[11px] text-foreground-400 hover:text-foreground-600 cursor-pointer px-1">
                        <i className="ri-close-circle-line mr-0.5"></i>{t('清空')}
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>

            <div className="relative inline-flex">
              <select value={sensitivity} onChange={(e) => setSensitivity(e.target.value as 'std' | 'high' | 'max')} className={selCls} title={t('老师声音小或坐得远就调高')}>
                <option value="std">{t('🎚 灵敏度·标准')}</option>
                <option value="high">{t('🎚 灵敏度·灵敏')}</option>
                <option value="max">{t('🎚 灵敏度·最灵敏')}</option>
              </select>
              <i className="ri-arrow-down-s-line absolute right-2.5 top-1/2 -translate-y-1/2 text-foreground-400 pointer-events-none text-sm"></i>
            </div>

            <button type="button" data-guide="ai-correct" onClick={() => setAiCorrect(!aiCorrect)} className={pillCls(aiCorrect)} title={t('出字后让 DeepSeek 异步改同音错字(如影射→映射),消耗少量 API 额度')}>
              {t('✨ AI 实时纠错')}
            </button>
            <button type="button" data-guide="ai-seg" onClick={() => setSmartSeg(!smartSeg)} className={pillCls(smartSeg)} title={t('让 DeepSeek 按语意把停顿切碎的句子合并成完整句再断句(整句模式生效)')}>
              {t('🧩 AI 智能分句')}
            </button>
          </div>
        )}

        <div className="flex items-center gap-3 ml-auto">
          {uiStatus !== 'idle' && (
            <div className="w-24 h-1.5 bg-background-200 rounded-full overflow-hidden" title={t('输入音量')}>
              <div
                className="h-full bg-primary-500 transition-all duration-100"
                style={{ width: `${levelPct}%` }}
              ></div>
            </div>
          )}

          {uiStatus === 'recording' && (
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>
              <span className="text-xs font-medium text-red-600">
                {micActive ? t('本设备录制中') : t('录制中')}
              </span>
            </span>
          )}
          {uiStatus === 'paused' && <span className="text-xs font-medium text-accent-600">{t('已暂停')}</span>}
          {uiStatus === 'idle' && (
            <span className={`text-xs font-medium ${connected ? 'text-green-600' : 'text-foreground-400'}`}>
              <i className={`mr-1 ${connected ? 'ri-checkbox-circle-line' : 'ri-loader-4-line animate-spin'}`}></i>
              {connected ? t('本机服务已连接') : t('正在连接本机服务…')}
            </span>
          )}

          {uiStatus !== 'idle' && (
            <>
              <span className={`text-xs ${backlogWarn ? 'text-red-600 font-medium' : 'text-foreground-400'}`}
                    title={t('识别积压。持续大于 3 说明 CPU 跟不上')}>
                {t('积压')} {status.backlog}
              </span>
              <span className="text-xs text-foreground-400" title={t('实时率，需要小于 1')}>
                RTF {status.rtf || '-'}
              </span>
              <span className="text-sm font-mono text-foreground-600 min-w-[64px] text-right">
                {formatTime(status.elapsed)}
              </span>
            </>
          )}
        </div>
      </div>

      {(notice || (uiStatus !== 'idle' && status.speakers.length > 0)) && (
        <div className="px-4 pb-3 flex flex-wrap items-center gap-x-4 gap-y-1">
          {status.speakers.map((s) => (
            <span key={s.id} className="text-xs text-foreground-500">
              <i className="ri-user-voice-line mr-1"></i>
              {s.name} · {formatTime(s.seconds)}
            </span>
          ))}
          {notice && <span className="text-xs text-foreground-400 ml-auto">{notice}</span>}
        </div>
      )}
    </div>
  );
}
