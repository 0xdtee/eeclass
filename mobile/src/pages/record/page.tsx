import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveCaption } from '@/hooks/useLiveCaption';
import { getAiDefault } from '@/lib/settings';
import { TRANS_LANGS, type TransLang } from '@/lib/translateLangs';

// Default subject tags from the national syllabus (ticked to give AI subject context for correction/translation)
const NATIONAL_TAGS = [
  '大学物理', '大学物理实验', '大学计算机基础', '大学英语',
  '马克思主义基本原理', '毛泽东思想和中国特色社会主义理论体系概论',
  '习近平新时代中国特色社会主义思想概论', '思想道德与法治',
  '中国近现代史纲要', '军事理论', '大学生心理健康教育',
];

function defaultTitle() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `课程 ${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function fmtTime(s: number) {
  const t = Math.floor(s || 0);
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

export default function RecordPage() {
  const navigate = useNavigate();
  const live = useLiveCaption();
  const [title, setTitle] = useState(defaultTitle());
  const [aiCorrect, setAiCorrect] = useState(() => getAiDefault('aiCorrect'));
  const [smartSeg, setSmartSeg] = useState(() => getAiDefault('smartSeg'));
  const [model, setModel] = useState<'aliyun' | 'aliyun_wu' | 'aliyun_multi'>('aliyun');
  const [translateFrom, setTranslateFrom] = useState<TransLang>('en');   // source (原文); off when from === to
  const [translateTo, setTranslateTo] = useState<TransLang>('zh');       // target (译文)
  const [subjects, setSubjects] = useState<string[]>([]);
  const [showTags, setShowTags] = useState(false);
  const [justSaved, setJustSaved] = useState<string>('');
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    boxRef.current?.scrollTo({ top: boxRef.current.scrollHeight });
  }, [live.lines, live.partial]);

  useEffect(() => {
    if (!live.running && live.liveSid && live.notice.startsWith('已保存')) {
      setJustSaved(live.liveSid);
    }
  }, [live.running, live.liveSid, live.notice]);

  const onStart = () => {
    setJustSaved('');
    void live.start({ title: title.trim() || defaultTitle(), aiCorrect, smartSeg, model, translateFrom, translateTo, subjects });
  };

  const toggleTag = (t: string) =>
    setSubjects((s) => (s.includes(t) ? s.filter((x) => x !== t) : [...s, t]));

  const renameSpeaker = (id: number, cur: string) => {
    const name = window.prompt('请为该说话人命名', /^(老师|同学\d+)$/.test(cur) ? '' : cur);
    if (name && name.trim()) live.rename(id, name.trim());
  };

  const Toggle = ({ on, set, label, desc, icon }: { on: boolean; set: (v: boolean) => void; label: string; desc: string; icon: string }) => (
    <button
      onClick={() => set(!on)}
      className="w-full flex items-center gap-3 p-3 rounded-xl bg-background-50 border border-background-200 text-left"
    >
      <i className={`${icon} text-lg ${on ? 'text-accent-600' : 'text-foreground-300'}`}></i>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground-800">{label}</p>
        <p className="text-xs text-foreground-400 truncate">{desc}</p>
      </div>
      <span className={`relative w-10 h-6 rounded-full transition-colors flex-shrink-0 ${on ? 'bg-accent-500' : 'bg-background-300'}`}>
        <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${on ? 'left-[18px]' : 'left-0.5'}`}></span>
      </span>
    </button>
  );

  /* ---------------- Recording ---------------- */
  if (live.running || live.starting) {
    return (
      <div className="flex flex-col h-full min-h-full bg-background-100">
        <div className="px-5 pt-6 pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse"></span>
              <span className="text-sm font-semibold text-foreground-900">{live.starting ? '正在开启麦克风…' : '录音中'}</span>
              <span className="text-sm text-foreground-400 font-mono">{fmtTime(live.status.elapsed)}</span>
            </div>
            <span className="text-xs text-foreground-400">{live.status.lines} 句</span>
          </div>
          {live.status.speakers.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap mt-3">
              <span className="text-xs text-foreground-400 mr-1"><i className="ri-user-voice-line text-accent-500"></i> 说话人</span>
              {live.status.speakers.map((sp) => (
                <button key={sp.id} onClick={() => renameSpeaker(sp.id, sp.name)}
                  className="inline-flex items-center gap-1 pl-2.5 pr-2 py-1 bg-accent-100 text-accent-700 rounded-full text-xs font-medium">
                  {sp.name}<i className="ri-pencil-line text-[11px] opacity-60"></i>
                </button>
              ))}
            </div>
          )}
        </div>

        <div ref={boxRef} className="flex-1 overflow-y-auto px-5 pb-4 space-y-3">
          {live.lines.length === 0 && !live.partial && (
            <p className="text-sm text-foreground-400 italic mt-6">麦克风已开启,等待第一句话…</p>
          )}
          {live.lines.map((l) => (
            <div key={l.id} className={l.new_para ? 'pt-1' : ''}>
              <span className="text-[11px] text-foreground-400 font-mono mr-2">{l.ts}</span>
              <span className="text-xs font-medium text-accent-600 mr-2">{l.speaker}</span>
              <span className={`text-sm leading-relaxed text-foreground-800 ${l.kind === 'key' ? 'bg-yellow-200/60 px-0.5 rounded' : l.kind === 'define' ? 'bg-green-200/60 px-0.5 rounded' : ''}`}>{l.text}</span>
              {l.translation && (
                <div className="mt-1 flex items-start gap-1.5 text-[13px] text-sky-700 bg-sky-50 border-l-2 border-sky-300 rounded-r px-2 py-1">
                  <i className="ri-translate-2 text-sky-400 mt-0.5"></i><span>{l.translation}</span>
                </div>
              )}
            </div>
          ))}
          {live.partial && <p className="text-sm text-foreground-400 italic">{live.partial} …</p>}
        </div>

        {live.error && <p className="px-5 pb-2 text-xs text-red-600">{live.error}</p>}

        <div className="flex items-center justify-around gap-2 px-5 py-4 bg-background-50 border-t border-background-200">
          <button onClick={() => live.setPaused(!live.paused)}
            className="flex flex-col items-center gap-1 text-foreground-600 w-16">
            <i className={`${live.paused ? 'ri-play-fill' : 'ri-pause-fill'} text-2xl`}></i>
            <span className="text-[11px]">{live.paused ? '继续' : '暂停'}</span>
          </button>
          <button onClick={() => live.mark()} className="flex flex-col items-center gap-1 text-yellow-600 w-16">
            <i className="ri-star-fill text-2xl"></i><span className="text-[11px]">标记重点</span>
          </button>
          <button onClick={() => live.stop()}
            className="flex flex-col items-center gap-1 text-red-600 w-16">
            <i className="ri-stop-circle-fill text-3xl"></i><span className="text-[11px]">结束</span>
          </button>
        </div>
      </div>
    );
  }

  /* ---------------- Ready / ended ---------------- */
  return (
    <div className="min-h-full bg-background-100 px-5 md:px-8 pt-6 pb-28 md:pb-8">
      <h1 className="text-lg md:text-2xl font-bold text-foreground-900">录音</h1>
      <p className="text-xs md:text-sm text-foreground-400 mt-1">
        {live.connected ? <span className="text-accent-600"><i className="ri-checkbox-circle-line"></i> 本机服务已连接</span> : '连接服务中…'}
      </p>

      {justSaved && (
        <div className="mt-4 flex items-center justify-between gap-3 bg-green-50 border border-green-200 rounded-xl px-4 py-3">
          <span className="text-sm text-green-800"><i className="ri-checkbox-circle-fill mr-1"></i>{live.notice}</span>
          <button onClick={() => navigate(`/summary/${encodeURIComponent(justSaved)}`)}
            className="px-3 py-1.5 bg-accent-500 text-white rounded-full text-xs font-semibold whitespace-nowrap">查看摘要</button>
        </div>
      )}

      <div className="mt-5 space-y-4 max-w-5xl">
        <div>
          <label className="text-xs text-foreground-500">课程名</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)}
            className="w-full mt-1 px-3 py-2.5 rounded-xl bg-background-50 border border-background-200 text-sm focus:outline-none focus:border-accent-400" />
        </div>

        <div className="space-y-2">
          <Toggle on={aiCorrect} set={setAiCorrect} icon="ri-sparkling-line" label="AI 实时纠错" desc="出字后自动纠正同音错字" />
          <Toggle on={smartSeg} set={setSmartSeg} icon="ri-scissors-cut-line" label="AI 智能分句" desc="按语义将碎片合并为完整句" />
        </div>

        {/* Recognition model: cloud Mandarin/English, cloud dialects, or cloud multilingual */}
        <div>
          <label className="text-xs text-foreground-500">识别模型</label>
          <div className="flex gap-1.5 mt-1.5">
            {([['aliyun', '普通话/英语'], ['aliyun_wu', '方言'], ['aliyun_multi', '多语言']] as const).map(([v, l]) => (
              <button key={v} onClick={() => setModel(v)}
                className={`flex-1 px-3 py-2 rounded-xl text-xs border ${model === v ? 'bg-accent-500 text-white border-accent-500 font-medium' : 'bg-background-50 text-foreground-600 border-background-200'}`}>
                {l}
              </button>
            ))}
          </div>
          {model === 'aliyun_multi' && (
            <p className="text-[11px] text-foreground-400 mt-1.5">可识别法/德/意/西/俄/日/韩等语言,配合下方翻译生成字幕</p>
          )}
        </div>

        {/* Live translation: source (原文) ⇄ target (译文); off when equal */}
        <div>
          <label className="text-xs text-foreground-500">翻译字幕(左侧为源语言，右侧为目标语言，相同则不翻译)</label>
          <div className="flex items-center gap-2 mt-1.5">
            <select value={translateFrom} onChange={(e) => setTranslateFrom(e.target.value as TransLang)}
              className="flex-1 px-3 py-2 rounded-xl bg-background-50 border border-background-200 text-sm focus:outline-none focus:border-accent-400">
              {TRANS_LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
            </select>
            <button onClick={() => { setTranslateFrom(translateTo); setTranslateTo(translateFrom); }}
              className="w-9 h-9 flex items-center justify-center rounded-full bg-background-100 text-foreground-500 flex-shrink-0" title="交换原文和译文">
              <i className="ri-arrow-left-right-line"></i>
            </button>
            <select value={translateTo} onChange={(e) => setTranslateTo(e.target.value as TransLang)}
              className="flex-1 px-3 py-2 rounded-xl bg-background-50 border border-background-200 text-sm focus:outline-none focus:border-accent-400">
              {TRANS_LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
            </select>
          </div>
        </div>

        <div>
          <button onClick={() => setShowTags((v) => !v)} className="flex items-center gap-1.5 text-xs text-foreground-500">
            <i className="ri-price-tag-3-line text-accent-500"></i>
            学科标签{subjects.length ? `·${subjects.length}` : ''}
            <i className={`ri-arrow-down-s-line transition-transform ${showTags ? 'rotate-180' : ''}`}></i>
          </button>
          {showTags && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {NATIONAL_TAGS.map((t) => (
                <button key={t} onClick={() => toggleTag(t)}
                  className={`px-2.5 py-1 rounded-full text-xs border ${subjects.includes(t) ? 'bg-accent-500 text-white border-accent-500' : 'bg-background-50 text-foreground-600 border-background-200'}`}>
                  {t}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {live.error && <p className="mt-3 text-xs text-red-600 max-w-5xl">{live.error}</p>}

      <div className="flex flex-col items-center mt-8">
        <button onClick={onStart} disabled={live.starting}
          className="w-24 h-24 flex items-center justify-center bg-accent-500 rounded-full shadow-lg active:scale-95 transition-transform disabled:opacity-50">
          <i className="ri-mic-fill text-white text-4xl"></i>
        </button>
        <span className="mt-3 text-sm text-foreground-500">点击开始录音</span>
        <p className="mt-4 text-[11px] text-foreground-400 text-center max-w-xs leading-relaxed">
          录音、识别、说话人区分均在你自己的服务器上完成,音频不会上传至第三方。
        </p>
      </div>
    </div>
  );
}
