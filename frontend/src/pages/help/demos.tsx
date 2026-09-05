import { useEffect, useState } from 'react';
import { useT } from '@/lib/i18n';

/**
 * Collection of "animated demo" components for the help page.
 * All drawn with pure CSS / SVG / React state loops, without any external images / GIFs / assets,
 * keeping the app offline-self-sufficient. Animations rely on transform / opacity, kept as light as possible.
 * Respects prefers-reduced-motion: when on, animations degrade to a static "final state".
 */

/* ------------------------------------------------------------------ */
/* Shared hooks                                                        */
/* ------------------------------------------------------------------ */

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() =>
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

/** Cyclically advance a step counter [0, total). When reduced, freezes on the last frame. */
function useCycle(total: number, interval: number, reduced: boolean): number {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (reduced) {
      setI(total - 1);
      return;
    }
    setI(0);
    const id = window.setInterval(() => setI((v) => (v + 1) % total), interval);
    return () => window.clearInterval(id);
  }, [total, interval, reduced]);
  return reduced ? total - 1 : i;
}

/* ------------------------------------------------------------------ */
/* Keyframes injected once (rendered a single time per page)        */
/* ------------------------------------------------------------------ */

const KEYFRAMES = `
@keyframes hd-mic {
  0%,100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(239,68,68,.5); }
  50%     { transform: scale(1.12); box-shadow: 0 0 0 6px rgba(239,68,68,0); }
}
@keyframes hd-bar {
  0%,100% { transform: scaleY(.35); }
  50%     { transform: scaleY(1); }
}
@keyframes hd-sweep {
  0%   { background-size: 0% 100%; }
  60%  { background-size: 100% 100%; }
  100% { background-size: 100% 100%; }
}
@keyframes hd-star {
  0%,55% { transform: scale(0) rotate(-40deg); opacity: 0; }
  70%    { transform: scale(1.35) rotate(0deg); opacity: 1; }
  100%   { transform: scale(1) rotate(0deg); opacity: 1; }
}
@keyframes hd-flip {
  0%,42%  { transform: rotateY(0deg); }
  50%,92% { transform: rotateY(180deg); }
  100%    { transform: rotateY(0deg); }
}
@keyframes hd-flash {
  0%,70%,100% { opacity: 0; }
  80%         { opacity: .85; }
}
@keyframes hd-shimmer {
  0%   { transform: translateX(-120%); }
  100% { transform: translateX(220%); }
}
@keyframes hd-caret {
  0%,100% { opacity: 1; }
  50%     { opacity: 0; }
}
@keyframes hd-rise {
  0%   { opacity: 0; transform: translateY(6px); }
  100% { opacity: 1; transform: translateY(0); }
}
@media (prefers-reduced-motion: reduce) {
  .hd-anim { animation: none !important; }
}
`;

export function HelpDemoStyles() {
  return <style dangerouslySetInnerHTML={{ __html: KEYFRAMES }} />;
}

/* ------------------------------------------------------------------ */
/* Mini "app UI" outer frame                                            */
/* ------------------------------------------------------------------ */

function Screen({
  title,
  icon,
  children,
  tint = 'accent',
}: {
  title: string;
  icon: string;
  children: React.ReactNode;
  tint?: 'accent' | 'red';
}) {
  return (
    <div className="rounded-xl border border-background-200 bg-background-100 overflow-hidden select-none">
      <div className="flex items-center gap-1.5 px-2.5 h-6 bg-background-200/70 border-b border-background-200">
        <span className="w-1.5 h-1.5 rounded-full bg-red-400/70" />
        <span className="w-1.5 h-1.5 rounded-full bg-amber-400/70" />
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400/70" />
        <span
          className={`ml-1 flex items-center gap-1 text-[10px] font-medium ${
            tint === 'red' ? 'text-red-500' : 'text-accent-600'
          }`}
        >
          <i className={icon} />
          {title}
        </span>
      </div>
      <div className="p-2.5">{children}</div>
    </div>
  );
}

/** Speaker mini-label */
function Speaker({ who }: { who: 'teacher' | 'student' }) {
  const t = useT();
  const teacher = who === 'teacher';
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-semibold flex-shrink-0 ${
        teacher ? 'bg-accent-100 text-accent-700' : 'bg-primary-100 text-primary-700'
      }`}
    >
      <i className={teacher ? 'ri-user-2-fill' : 'ri-user-3-line'} />
      {teacher ? t('老师') : t('同学1')}
    </span>
  );
}

/* ================================================================== */
/* 1. Real-time recording transcription                                 */
/* ================================================================== */

const RECORD_LINES = [
  { t: '09:12', s: '今天我们来讲格林公式的应用' },
  { t: '09:12', s: '它把曲线积分和二重积分联系起来' },
  { t: '09:13', s: '注意方向要取正向,也就是逆时针' },
  { t: '09:13', s: '下面看一道例题' },
];

export function RecordDemo() {
  const t = useT();
  const reduced = usePrefersReducedMotion();
  const i = useCycle(RECORD_LINES.length + 3, 900, reduced);
  const shown = Math.min(i, RECORD_LINES.length);
  return (
    <Screen title={t('录制中 00:41')} icon="ri-mic-fill" tint="red">
      <div className="flex items-center gap-2 mb-2">
        <span
          className="hd-anim w-2.5 h-2.5 rounded-full bg-red-500 flex-shrink-0"
          style={{ animation: 'hd-mic 1.1s ease-in-out infinite' }}
        />
        <div className="flex items-end gap-[3px] h-4">
          {[0, 1, 2, 3, 4].map((k) => (
            <span
              key={k}
              className="hd-anim w-[3px] bg-accent-400 rounded-full h-full origin-bottom"
              style={{ animation: `hd-bar .7s ease-in-out ${k * 0.12}s infinite` }}
            />
          ))}
        </div>
        <span className="ml-auto text-[9px] text-foreground-400">{t('SenseVoice · 本机')}</span>
      </div>
      <div className="space-y-1.5 min-h-[76px]">
        {RECORD_LINES.slice(0, shown).map((l, idx) => (
          <div key={idx} className="flex gap-1.5 text-[10px] leading-snug">
            <span className="text-foreground-300 font-mono flex-shrink-0">{l.t}</span>
            <span className="text-foreground-700">
              {t(l.s)}
              {idx === shown - 1 && shown < RECORD_LINES.length && !reduced && (
                <span
                  className="hd-anim inline-block w-[2px] h-[10px] bg-accent-500 ml-0.5 align-middle"
                  style={{ animation: 'hd-caret .8s step-end infinite' }}
                />
              )}
            </span>
          </div>
        ))}
      </div>
    </Screen>
  );
}

/* ================================================================== */
/* 2. Speaker separation and voiceprint                                 */
/* ================================================================== */

const SPEAKER_LINES: { who: 'teacher' | 'student'; s: string }[] = [
  { who: 'teacher', s: '大家看这道极限题怎么求?' },
  { who: 'student', s: '老师,可以用洛必达法则吗?' },
  { who: 'teacher', s: '可以,但要先验证是不是 0/0 型' },
];

export function SpeakerDemo() {
  const t = useT();
  const reduced = usePrefersReducedMotion();
  const i = useCycle(SPEAKER_LINES.length + 3, 1000, reduced);
  const shown = Math.min(i, SPEAKER_LINES.length);
  return (
    <Screen title={t('说话人区分')} icon="ri-user-voice-fill">
      <div className="space-y-2 min-h-[92px]">
        {SPEAKER_LINES.slice(0, shown).map((l, idx) => (
          <div
            key={idx}
            className="flex items-start gap-1.5"
            style={{ transition: 'opacity .3s', opacity: 1 }}
          >
            <Speaker who={l.who} />
            <span className="text-[10px] text-foreground-700 leading-snug pt-0.5">{t(l.s)}</span>
          </div>
        ))}
      </div>
      <div className="mt-2 pt-2 border-t border-background-200 flex items-center gap-2 text-[9px] text-foreground-400">
        <i className="ri-fingerprint-line text-accent-500" />
        {t('声纹已记住 · 下次自动认出')}
      </div>
    </Screen>
  );
}

/* ================================================================== */
/* 3. Mark highlights                                                   */
/* ================================================================== */

export function MarkDemo() {
  const t = useT();
  const reduced = usePrefersReducedMotion();
  const i = useCycle(2, 2000, reduced);
  const marked = reduced || i >= 1;
  return (
    <Screen title={t('课堂字幕')} icon="ri-mark-pen-fill">
      <div className="space-y-1.5 text-[10px] leading-snug min-h-[86px]">
        <div className="text-foreground-500">{t('这一步是整道题的关键——')}</div>
        <div className="flex items-start gap-1">
          <span
            className={marked ? 'hd-anim rounded px-0.5 text-foreground-800 font-medium' : 'text-foreground-800 font-medium'}
            style={
              marked
                ? {
                    backgroundImage: 'linear-gradient(rgba(253,224,71,.85),rgba(253,224,71,.85))',
                    backgroundRepeat: 'no-repeat',
                    backgroundPosition: 'left center',
                    animation: reduced ? 'none' : 'hd-sweep 1s ease-out forwards',
                    backgroundSize: reduced ? '100% 100%' : undefined,
                  }
                : undefined
            }
          >
            {t('期末一定会考换元积分法')}
          </span>
          {marked && (
            <i
              className="hd-anim ri-star-fill text-amber-400 text-[11px] flex-shrink-0"
              style={{ animation: reduced ? 'none' : 'hd-star 1.2s ease-out forwards' }}
            />
          )}
        </div>
        <div className="text-foreground-500">{t('大家课后一定要练熟。')}</div>
      </div>
      <div className="mt-2 flex items-center gap-1 text-[9px] text-accent-600">
        <i className="ri-mark-pen-line" />
        {t('点「标记重点」即把刚说的这句标黄')}
      </div>
    </Screen>
  );
}

/* ================================================================== */
/* 4. Photograph board notes                                            */
/* ================================================================== */

export function PhotoDemo() {
  const t = useT();
  const reduced = usePrefersReducedMotion();
  const i = useCycle(2, 2200, reduced);
  const captured = reduced || i >= 1;
  return (
    <Screen title={t('拍板书')} icon="ri-camera-fill">
      <div className="relative rounded-lg bg-foreground-900 h-[92px] overflow-hidden flex items-center justify-center">
        {/* Simulated blackboard notes */}
        <div className="text-center leading-relaxed">
          <div className="text-emerald-300 text-[11px] font-semibold">∮ P dx + Q dy</div>
          <div className="text-background-50/80 text-[10px]">= ∬ (∂Q/∂x − ∂P/∂y) dσ</div>
          <div className="text-amber-200/80 text-[9px] mt-0.5">{t('— 格林公式 —')}</div>
        </div>
        {/* Viewfinder corners */}
        <span className="absolute top-1.5 left-1.5 w-3 h-3 border-t-2 border-l-2 border-accent-300/80 rounded-tl" />
        <span className="absolute top-1.5 right-1.5 w-3 h-3 border-t-2 border-r-2 border-accent-300/80 rounded-tr" />
        <span className="absolute bottom-1.5 left-1.5 w-3 h-3 border-b-2 border-l-2 border-accent-300/80 rounded-bl" />
        <span className="absolute bottom-1.5 right-1.5 w-3 h-3 border-b-2 border-r-2 border-accent-300/80 rounded-br" />
        {/* Shutter flash */}
        {!reduced && (
          <span
            className="hd-anim absolute inset-0 bg-white pointer-events-none"
            style={{ animation: 'hd-flash 2.2s ease-out infinite' }}
          />
        )}
      </div>
      <div className="mt-1.5 flex items-center gap-1 text-[9px] text-foreground-400">
        <i className={`ri-check-line ${captured ? 'text-emerald-500' : 'text-foreground-300'}`} />
        {t('已保存,对应 09:13 转写时间点')}
      </div>
    </Screen>
  );
}

/* ================================================================== */
/* 5. AI real-time correction                                           */
/* ================================================================== */

export function CorrectionDemo() {
  const t = useT();
  const reduced = usePrefersReducedMotion();
  const i = useCycle(4, 1100, reduced); // 0 original 1 highlight 2 corrected 3 hold
  const stage = reduced ? 2 : i;
  const wrong = stage <= 1;
  return (
    <Screen title={t('AI 实时纠错')} icon="ri-eraser-fill">
      <div className="min-h-[70px] flex flex-col justify-center">
        <div className="text-[11px] leading-relaxed text-foreground-700">
          {t('我们用')}
          <span
            className="mx-0.5 rounded px-1 py-0.5 font-medium transition-all duration-500"
            style={
              wrong
                ? {
                    color: '#b91c1c',
                    background: stage === 1 ? 'rgba(254,202,202,.9)' : 'transparent',
                    textDecoration: stage === 1 ? 'line-through' : 'none',
                  }
                : { color: 'oklch(var(--accent-700))', background: 'rgba(153,246,228,.6)' }
            }
          >
            {wrong ? t('格林公司') : t('格林公式')}
          </span>
          {t('来计算这个曲线积分。')}
        </div>
        <div className="mt-2 flex items-center gap-1 text-[9px]">
          <i
            className={`transition-colors ${
              wrong ? 'ri-loader-4-line text-foreground-400' : 'ri-check-double-line text-accent-500'
            }`}
          />
          <span className="text-foreground-400">
            {wrong ? t('DeepSeek 正在校对同音错字…') : t('已把「公司」纠正为「公式」')}
          </span>
        </div>
      </div>
    </Screen>
  );
}

/* ================================================================== */
/* 6. AI smart sentence splitting                                       */
/* ================================================================== */

const FRAGMENTS = ['这个', '定理', '很', '重要', '大家', '记一下'];

export function SegmentDemo() {
  const t = useT();
  const reduced = usePrefersReducedMotion();
  const i = useCycle(3, 1300, reduced); // 0 fragments 1 merged 2 hold
  const merged = reduced || i >= 1;
  return (
    <Screen title={t('AI 智能分句')} icon="ri-scissors-cut-fill">
      <div className="min-h-[86px] flex flex-col justify-center gap-2">
        <div>
          <div className="text-[9px] text-foreground-400 mb-1">{t('ASR 碎片')}</div>
          <div className="flex flex-wrap gap-1">
            {FRAGMENTS.map((f, idx) => (
              <span
                key={idx}
                className="px-1.5 py-0.5 rounded-md bg-background-200 text-foreground-500 text-[10px] transition-all duration-500"
                style={{
                  opacity: merged ? 0.35 : 1,
                  transform: merged ? 'scale(.92)' : 'scale(1)',
                }}
              >
                {t(f)}
              </span>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-center">
          <i
            className="ri-arrow-down-line text-accent-500 text-sm transition-opacity duration-500"
            style={{ opacity: merged ? 1 : 0.2 }}
          />
        </div>
        <div
          className="rounded-lg bg-accent-100 text-accent-800 text-[11px] px-2 py-1.5 font-medium transition-all duration-500"
          style={{ opacity: merged ? 1 : 0, transform: merged ? 'translateY(0)' : 'translateY(6px)' }}
        >
          {t('这个定理很重要,大家记一下。')}
        </div>
      </div>
    </Screen>
  );
}

/* ================================================================== */
/* 7. Automatic English translation                                     */
/* ================================================================== */

export function TranslateDemo() {
  const t = useT();
  const reduced = usePrefersReducedMotion();
  const i = useCycle(3, 1400, reduced);
  const translated = reduced || i >= 1;
  return (
    <Screen title={t('英文自动翻译')} icon="ri-translate-2">
      <div className="min-h-[74px] flex flex-col justify-center gap-2">
        <div className="flex items-start gap-1.5">
          <span className="px-1.5 py-0.5 rounded bg-primary-100 text-primary-700 text-[9px] font-semibold flex-shrink-0">
            EN
          </span>
          <span className="text-[11px] text-foreground-700 leading-snug">
            The derivative measures the rate of change.
          </span>
        </div>
        <div
          className="flex items-start gap-1.5 transition-all duration-500"
          style={{ opacity: translated ? 1 : 0, transform: translated ? 'translateY(0)' : 'translateY(8px)' }}
        >
          <span className="px-1.5 py-0.5 rounded bg-accent-100 text-accent-700 text-[9px] font-semibold flex-shrink-0">
            {t('中')}
          </span>
          <span className="text-[11px] text-accent-800 leading-snug">{t('导数刻画的是变化的快慢。')}</span>
        </div>
      </div>
    </Screen>
  );
}

/* ================================================================== */
/* 8. AI course summary                                                 */
/* ================================================================== */

const SUMMARY_POINTS = [
  '格林公式连接曲线积分与二重积分',
  '使用前提:闭合曲线取正向(逆时针)',
  '典型应用:计算复杂曲线积分',
];

export function SummaryDemo() {
  const t = useT();
  const reduced = usePrefersReducedMotion();
  const i = useCycle(SUMMARY_POINTS.length + 3, 850, reduced);
  const shown = Math.min(i, SUMMARY_POINTS.length);
  return (
    <Screen title={t('AI 课程概要')} icon="ri-magic-fill">
      <div className="text-[10px] font-semibold text-foreground-800 mb-1.5 flex items-center gap-1">
        <i className="ri-sparkling-2-line text-accent-500" />
        {t('本节要点')}
      </div>
      <div className="space-y-1.5 min-h-[76px]">
        {SUMMARY_POINTS.slice(0, shown).map((p, idx) => (
          <div key={idx} className="flex items-start gap-1.5" style={{ opacity: 1 }}>
            <span className="mt-[3px] w-3.5 h-3.5 rounded-full bg-accent-100 text-accent-600 text-[8px] flex items-center justify-center flex-shrink-0 font-bold">
              {idx + 1}
            </span>
            <span className="text-[10px] text-foreground-600 leading-snug">{t(p)}</span>
          </div>
        ))}
        {shown < SUMMARY_POINTS.length && !reduced && (
          <div className="flex items-center gap-1 text-[9px] text-foreground-300">
            <i className="ri-loader-4-line" /> {t('AI 整理中…')}
          </div>
        )}
      </div>
    </Screen>
  );
}

/* ================================================================== */
/* 9. Review flashcards and self-test                                   */
/* ================================================================== */

export function FlashcardDemo() {
  const t = useT();
  const reduced = usePrefersReducedMotion();
  return (
    <Screen title={t('复习闪卡')} icon="ri-book-read-fill">
      <div className="flex items-center justify-center min-h-[92px]" style={{ perspective: '600px' }}>
        <div
          className="hd-anim relative w-[150px] h-[80px]"
          style={{
            transformStyle: 'preserve-3d',
            animation: reduced ? 'none' : 'hd-flip 4s ease-in-out infinite',
          }}
        >
          {/* Front: question */}
          <div
            className="absolute inset-0 rounded-xl bg-background-50 border border-background-200 flex flex-col items-center justify-center px-2"
            style={{ backfaceVisibility: 'hidden' }}
          >
            <span className="text-[9px] text-accent-600 font-semibold mb-1">{t('问')}</span>
            <span className="text-[10px] text-foreground-700 text-center leading-snug">
              {t('格林公式成立的前提是?')}
            </span>
          </div>
          {/* Back: answer */}
          <div
            className="absolute inset-0 rounded-xl bg-accent-500 text-background-50 flex flex-col items-center justify-center px-2"
            style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
          >
            <span className="text-[9px] font-semibold mb-1 opacity-80">{t('答')}</span>
            <span className="text-[10px] text-center leading-snug">{t('闭区域 + 曲线取正向')}</span>
          </div>
        </div>
      </div>
      <div className="mt-1 text-center text-[9px] text-foreground-400">
        <i className="ri-time-line mr-0.5" />{t('艾宾浩斯排期 · 明天再复习')}
      </div>
    </Screen>
  );
}

/* ================================================================== */
/* 10. Overall course summary (multi-session aggregation)             */
/* ================================================================== */

export function CourseSummaryDemo() {
  const t = useT();
  const reduced = usePrefersReducedMotion();
  const i = useCycle(4, 900, reduced); // 3 sessions merged in one by one + hold
  const merged = Math.min(i, 3);
  const lessons = ['第 3 讲 · 曲线积分', '第 4 讲 · 格林公式', '第 5 讲 · 曲面积分'];
  return (
    <Screen title={t('课程大总结')} icon="ri-file-text-fill">
      <div className="flex gap-2 min-h-[92px]">
        <div className="flex flex-col gap-1 w-[46%]">
          {lessons.map((l, idx) => (
            <div
              key={idx}
              className="rounded-md border border-background-200 bg-background-50 px-1.5 py-1 text-[9px] text-foreground-500 transition-all duration-500 flex items-center gap-1"
              style={{ opacity: idx < merged ? 0.4 : 1 }}
            >
              <i className="ri-file-3-line text-foreground-300" />
              {t(l)}
            </div>
          ))}
        </div>
        <div className="flex items-center">
          <i className="ri-arrow-right-line text-accent-500 text-sm" />
        </div>
        <div className="flex-1 rounded-lg bg-accent-100 border border-accent-200 p-2">
          <div className="text-[9px] font-semibold text-accent-700 mb-1 flex items-center gap-1">
            <i className="ri-booklet-fill" />{t('整门课总结')}
          </div>
          <div className="space-y-1">
            {['积分学脉络贯通', '公式间的联系', '高频考点汇总'].map((txt, idx) => (
              <div
                key={idx}
                className="text-[9px] text-accent-800 flex items-center gap-1 transition-all duration-500"
                style={{ opacity: idx < merged ? 1 : 0.15 }}
              >
                <i className="ri-checkbox-circle-fill text-[9px]" />
                {t(txt)}
              </div>
            ))}
          </div>
        </div>
      </div>
    </Screen>
  );
}

/* ================================================================== */
/* 11. Exam-topic prediction (animated pie chart)                     */
/* ================================================================== */

const EXAM_SEGMENTS = [
  { label: '格林公式', pct: 40, color: 'oklch(0.6 0.12 178)' },
  { label: '曲线积分', pct: 30, color: 'oklch(0.68 0.19 82)' },
  { label: '重积分', pct: 20, color: 'oklch(0.7 0.1 250)' },
  { label: '其他', pct: 10, color: 'oklch(0.85 0.015 95)' },
];

export function ExamPieDemo() {
  const t = useT();
  const reduced = usePrefersReducedMotion();
  const i = useCycle(EXAM_SEGMENTS.length + 3, 700, reduced);
  const shown = Math.min(i, EXAM_SEGMENTS.length);

  let acc = 0;
  const arcs = EXAM_SEGMENTS.map((s, idx) => {
    const rot = acc * 3.6; // each 1% = 3.6deg
    acc += s.pct;
    return { ...s, rot, visible: idx < shown };
  });

  return (
    <Screen title={t('考点推测')} icon="ri-pie-chart-2-fill">
      <div className="flex items-center gap-3 min-h-[92px]">
        <svg viewBox="0 0 60 60" className="w-[70px] h-[70px] flex-shrink-0">
          {arcs.map((a, idx) => (
            <circle
              key={idx}
              cx="30"
              cy="30"
              r="15"
              fill="none"
              stroke={a.color}
              strokeWidth="15"
              pathLength={100}
              strokeDasharray={`${a.pct} ${100 - a.pct}`}
              strokeDashoffset={a.visible ? 0 : a.pct}
              style={{
                transform: `rotate(${a.rot - 90}deg)`,
                transformOrigin: '30px 30px',
                transition: 'stroke-dashoffset .6s ease',
              }}
            />
          ))}
          <circle cx="30" cy="30" r="7.5" fill="oklch(var(--background-100))" />
        </svg>
        <div className="space-y-1 flex-1 min-w-0">
          {arcs.map((a, idx) => (
            <div
              key={idx}
              className="flex items-center gap-1.5 text-[9px] transition-opacity duration-500"
              style={{ opacity: a.visible ? 1 : 0.2 }}
            >
              <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ background: a.color }} />
              <span className="text-foreground-600 truncate">{t(a.label)}</span>
              <span className="ml-auto font-semibold text-foreground-800">{a.pct}%</span>
            </div>
          ))}
        </div>
      </div>
    </Screen>
  );
}

/* ================================================================== */
/* 12. Mock exam paper                                                  */
/* ================================================================== */

const QUIZ_OPTIONS = ['牛顿-莱布尼茨公式', '格林公式', '斯托克斯公式', '高斯公式'];
const QUIZ_ANSWER = 1;

export function QuizDemo() {
  const t = useT();
  const reduced = usePrefersReducedMotion();
  // scan the 4 options, stop on the correct one, then hold
  const total = QUIZ_OPTIONS.length + 4;
  const i = useCycle(total, 500, reduced);
  const scanning = i < QUIZ_OPTIONS.length;
  const cursor = scanning ? i : QUIZ_ANSWER;
  const settled = reduced || i >= QUIZ_OPTIONS.length;

  return (
    <Screen title={t('模拟试卷 · 第 2 题')} icon="ri-file-list-3-fill">
      <div className="text-[10px] text-foreground-700 mb-1.5 leading-snug">
        {t('平面闭区域上的曲线积分,常用哪个公式化为二重积分?')}
      </div>
      <div className="space-y-1">
        {QUIZ_OPTIONS.map((opt, idx) => {
          const isAnswer = idx === QUIZ_ANSWER;
          const active = idx === cursor;
          const correct = settled && isAnswer;
          return (
            <div
              key={idx}
              className="flex items-center gap-1.5 px-1.5 py-1 rounded-md border text-[10px] transition-all duration-200"
              style={{
                borderColor: correct
                  ? 'oklch(0.7 0.15 150)'
                  : active
                  ? 'oklch(var(--accent-400))'
                  : 'oklch(var(--background-200))',
                background: correct
                  ? 'rgba(187,247,208,.5)'
                  : active
                  ? 'oklch(var(--accent-100))'
                  : 'transparent',
              }}
            >
              <span
                className="w-3.5 h-3.5 rounded-full border flex items-center justify-center text-[8px] font-bold flex-shrink-0"
                style={{
                  borderColor: correct ? 'oklch(0.6 0.15 150)' : 'oklch(var(--background-300))',
                  background: correct ? 'oklch(0.6 0.15 150)' : 'transparent',
                  color: correct ? 'white' : 'oklch(var(--foreground-400))',
                }}
              >
                {correct ? '✓' : String.fromCharCode(65 + idx)}
              </span>
              <span className={correct ? 'text-emerald-700 font-medium' : 'text-foreground-600'}>
                {t(opt)}
              </span>
            </div>
          );
        })}
      </div>
    </Screen>
  );
}

/* ================================================================== */
/* 13. Tag management                                                   */
/* ================================================================== */

const TAGS = [
  { name: '高等数学', color: 'oklch(0.6 0.12 178)' },
  { name: '期末重点', color: 'oklch(0.68 0.19 82)' },
  { name: '易错', color: 'oklch(0.62 0.2 25)' },
  { name: '待复习', color: 'oklch(0.62 0.15 280)' },
];

export function TagDemo() {
  const t = useT();
  const reduced = usePrefersReducedMotion();
  const i = useCycle(TAGS.length + 3, 750, reduced);
  const shown = Math.min(i, TAGS.length);
  return (
    <Screen title={t('标签管理')} icon="ri-price-tag-3-fill">
      <div className="min-h-[86px]">
        <div className="text-[9px] text-foreground-400 mb-1.5">{t('给这节课打标签')}</div>
        <div className="flex flex-wrap gap-1.5">
          {TAGS.slice(0, shown).map((tag, idx) => (
            <span
              key={idx}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium"
              style={{
                background: `color-mix(in oklch, ${tag.color} 18%, transparent)`,
                color: tag.color,
              }}
            >
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: tag.color }} />
              {t(tag.name)}
            </span>
          ))}
          {shown < TAGS.length && (
            <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] border border-dashed border-background-300 text-foreground-400">
              <i className="ri-add-line" />{t('添加')}
            </span>
          )}
        </div>
      </div>
    </Screen>
  );
}

/* ================================================================== */
/* 14. Reference materials (check subjects as AI context)             */
/* ================================================================== */

export function ReferenceDemo() {
  const t = useT();
  const reduced = usePrefersReducedMotion();
  const i = useCycle(2, 2000, reduced);
  const checked = reduced || i >= 1;
  return (
    <Screen title={t('参考资料 · 高等数学')} icon="ri-booklet-fill">
      <div className="space-y-1.5 min-h-[70px]">
        {['高等数学教学大纲.pdf', '同济第七版 · 第十一章'].map((f, idx) => (
          <div
            key={idx}
            className="flex items-center gap-1.5 px-1.5 py-1 rounded-md bg-background-50 border border-background-200"
          >
            <i className="ri-file-pdf-2-line text-red-400 text-xs" />
            <span className="text-[10px] text-foreground-600 truncate">{t(f)}</span>
            {idx === 0 && (
              <span
                className="ml-auto w-3.5 h-3.5 rounded border flex items-center justify-center text-[8px] transition-all duration-300 flex-shrink-0"
                style={{
                  borderColor: checked ? 'oklch(var(--accent-500))' : 'oklch(var(--background-300))',
                  background: checked ? 'oklch(var(--accent-500))' : 'transparent',
                  color: 'white',
                }}
              >
                {checked ? '✓' : ''}
              </span>
            )}
          </div>
        ))}
      </div>
      <div
        className="mt-1.5 flex items-center gap-1 text-[9px] transition-colors duration-300"
        style={{ color: checked ? 'oklch(var(--accent-600))' : 'oklch(var(--foreground-300))' }}
      >
        <i className="ri-link" />
        {checked ? t('已作为 AI 纠错上下文,识别更准') : t('勾选学科即可作为上下文')}
      </div>
    </Screen>
  );
}

/* ================================================================== */
/* 15. Course sharing (generate read-only link)                       */
/* ================================================================== */

export function ShareDemo() {
  const t = useT();
  const reduced = usePrefersReducedMotion();
  const i = useCycle(3, 1500, reduced); // 0 按钮 1 生成中 2 链接
  const stage = reduced ? 2 : i;
  return (
    <Screen title={t('共享课程')} icon="ri-share-forward-fill">
      <div className="min-h-[74px] flex flex-col justify-center gap-2">
        {stage === 0 ? (
          <button className="mx-auto inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-accent-500 text-background-50 text-[10px] font-semibold">
            <i className="ri-link" />{t('生成分享链接')}
          </button>
        ) : (
          <div className="relative overflow-hidden rounded-lg border border-background-200 bg-background-50 px-2 py-1.5 flex items-center gap-1.5">
            <i className="ri-link text-accent-500 text-xs flex-shrink-0" />
            <span className="text-[10px] text-foreground-600 truncate font-mono">
              {stage === 1 ? t('生成中…') : 'eeclass.app/s/9fx2a1'}
            </span>
            <span
              className={`ml-auto text-[9px] font-semibold flex-shrink-0 ${
                stage === 2 ? 'text-accent-600' : 'text-foreground-300'
              }`}
            >
              {stage === 2 ? t('复制') : ''}
            </span>
            {stage === 1 && !reduced && (
              <span
                className="hd-anim absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-accent-200/60 to-transparent"
                style={{ animation: 'hd-shimmer 1.2s linear infinite' }}
              />
            )}
          </div>
        )}
        <div className="flex items-center gap-1 text-[9px] text-foreground-400">
          <i className="ri-eye-line" />{t('对方无需登录即可只读查看 · 可随时撤销')}
        </div>
      </div>
    </Screen>
  );
}

/* ================================================================== */
/* 16. Past courses (search + results)                                */
/* ================================================================== */

const HISTORY_ROWS = [
  { d: '05-12', t: '格林公式与应用' },
  { d: '05-10', t: '曲线积分基础' },
];

export function HistoryDemo() {
  const t = useT();
  const reduced = usePrefersReducedMotion();
  const query = '格林';
  const i = useCycle(query.length + 5, 450, reduced);
  const typed = reduced ? query : query.slice(0, Math.min(i, query.length));
  const doneTyping = i >= query.length;
  const rowsShown = doneTyping ? (typed.includes('格林') ? 1 : HISTORY_ROWS.length) : 0;

  return (
    <Screen title={t('历史课程')} icon="ri-history-fill">
      <div className="flex items-center gap-1.5 rounded-lg border border-background-200 bg-background-50 px-2 py-1 mb-2">
        <i className="ri-search-line text-foreground-400 text-xs" />
        <span className="text-[10px] text-foreground-700">
          {typed}
          {!reduced && !doneTyping && (
            <span
              className="hd-anim inline-block w-[2px] h-[9px] bg-accent-500 ml-px align-middle"
              style={{ animation: 'hd-caret .8s step-end infinite' }}
            />
          )}
        </span>
      </div>
      <div className="space-y-1 min-h-[52px]">
        {HISTORY_ROWS.slice(0, rowsShown).map((r, idx) => (
          <div
            key={idx}
            className="flex items-center gap-2 px-1.5 py-1 rounded-md hover:bg-background-100 border border-background-200 bg-background-50"
          >
            <span className="text-[9px] font-mono text-foreground-400">{r.d}</span>
            <span className="text-[10px] text-foreground-700 truncate">{t(r.t)}</span>
            <span className="ml-auto flex items-center gap-1 text-[9px] text-foreground-300">
              <i className="ri-file-word-2-line" />
              <i className="ri-file-pdf-2-line" />
            </span>
          </div>
        ))}
      </div>
    </Screen>
  );
}

/* ================================================================== */
/* 17. AI default options / recording settings (toggle panel)         */
/* ================================================================== */

const TOGGLES = ['实时纠错', '智能分句', '英文翻译', '结束自动生成概要'];

export function ToggleDemo() {
  const t = useT();
  const reduced = usePrefersReducedMotion();
  const i = useCycle(TOGGLES.length + 3, 650, reduced);
  const onCount = Math.min(i, TOGGLES.length);
  return (
    <Screen title={t('AI 处理默认项')} icon="ri-sparkling-fill">
      <div className="space-y-1.5 min-h-[92px]">
        {TOGGLES.map((label, idx) => {
          const on = reduced || idx < onCount;
          return (
            <div key={idx} className="flex items-center gap-2">
              <span className="text-[10px] text-foreground-600">{t(label)}</span>
              <span
                className="ml-auto relative w-7 h-4 rounded-full transition-colors duration-300 flex-shrink-0"
                style={{ background: on ? 'oklch(var(--accent-500))' : 'oklch(var(--background-300))' }}
              >
                <span
                  className="absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all duration-300"
                  style={{ left: on ? '14px' : '2px' }}
                />
              </span>
            </div>
          );
        })}
      </div>
    </Screen>
  );
}

/* ================================================================== */
/* 18. Meeting Translator — multi-language live subtitles             */
/* ================================================================== */

const ML_LINES = [
  { zh: '我们下周一上线', en: 'We go live next Monday' },
  { zh: '先过一下发布清单', en: 'Let’s run through the checklist' },
  { zh: '这一版重点是稳定性', en: 'This release focuses on stability' },
  { zh: '测试要覆盖主要流程', en: 'Testing should cover the main flows' },
  { zh: '上线后我盯着监控', en: 'I’ll watch the dashboards after launch' },
  { zh: '有问题随时同步', en: 'Sync up anytime if issues come up' },
];

export function MeetingLiveDemo() {
  const t = useT();
  const reduced = usePrefersReducedMotion();
  const i = useCycle(ML_LINES.length + 2, 850, reduced); // sentences stream in one by one, then hold
  const shown = reduced ? ML_LINES.length : Math.min(i + 1, ML_LINES.length);
  const rows = ML_LINES.slice(0, shown);
  const col = (chip: string, pick: (r: { zh: string; en: string }) => string, strong: boolean) => (
    <div className="flex-1 min-w-0 flex flex-col">
      <span className="self-start text-[9px] font-bold px-1.5 py-0.5 rounded bg-accent-100 text-accent-600">{t(chip)}</span>
      {/* bottom-aligned: newest line hugs the bottom, older lines stack above */}
      <div className="flex-1 overflow-hidden flex flex-col justify-end gap-1 pt-1">
        {rows.map((r, idx) => (
          <span
            key={idx}
            className={`text-[9px] leading-snug break-words ${strong ? 'text-foreground-800' : 'text-foreground-600'}`}
            style={idx === rows.length - 1 && !reduced ? { animation: 'hd-rise .5s ease-out' } : undefined}
          >
            {pick(r)}
          </span>
        ))}
      </div>
    </div>
  );
  return (
    <Screen title={t('多语言实时字幕')} icon="ri-translate-2">
      {/* 16:9 like a projection screen */}
      <div className="aspect-video flex gap-1.5">
        {col('中', (r) => t(r.zh), true)}
        {col('英', (r) => r.en, false)}
      </div>
    </Screen>
  );
}

// Three-language variant (中 / 英 / 法): shows you can pick more than two.
const ML3_LINES = [
  { zh: '我们下周一上线', en: 'We go live next Monday', fr: 'On lance lundi prochain' },
  { zh: '先过一下发布清单', en: 'Let’s run the checklist', fr: 'Passons la checklist' },
  { zh: '这一版重点是稳定性', en: 'This release is about stability', fr: 'Cette version vise la stabilité' },
  { zh: '有问题随时同步', en: 'Sync up anytime', fr: 'On se synchronise à tout moment' },
];

export function MeetingLive3Demo() {
  const t = useT();
  const reduced = usePrefersReducedMotion();
  const i = useCycle(ML3_LINES.length + 2, 900, reduced);
  const shown = reduced ? ML3_LINES.length : Math.min(i + 1, ML3_LINES.length);
  const rows = ML3_LINES.slice(0, shown);
  const col = (chip: string, pick: (r: { zh: string; en: string; fr: string }) => string, strong: boolean) => (
    <div className="flex-1 min-w-0 flex flex-col">
      <span className="self-start text-[8px] font-bold px-1 py-0.5 rounded bg-accent-100 text-accent-600">{t(chip)}</span>
      <div className="flex-1 overflow-hidden flex flex-col justify-end gap-1 pt-1">
        {rows.map((r, idx) => (
          <span
            key={idx}
            className={`text-[8px] leading-snug break-words ${strong ? 'text-foreground-800' : 'text-foreground-600'}`}
            style={idx === rows.length - 1 && !reduced ? { animation: 'hd-rise .5s ease-out' } : undefined}
          >
            {pick(r)}
          </span>
        ))}
      </div>
    </div>
  );
  return (
    <Screen title={t('多语言实时字幕')} icon="ri-translate-2">
      <div className="aspect-video flex gap-1.5">
        {col('中', (r) => t(r.zh), true)}
        {col('英', (r) => r.en, false)}
        {col('法', (r) => r.fr, false)}
      </div>
    </Screen>
  );
}

// Card demo: two languages, then three — so it's clear you can select several.
export function MeetingLiveShowcase() {
  const t = useT();
  const label = (text: string) => (
    <div className="flex items-center gap-1 text-[10px] font-medium text-foreground-400">
      <i className="ri-checkbox-circle-line text-accent-500" />{t(text)}
    </div>
  );
  return (
    <div className="space-y-2">
      {label('选 2 种语言')}
      <MeetingLiveDemo />
      {label('选 3 种语言(中 / 英 / 法)')}
      <MeetingLive3Demo />
    </div>
  );
}

/* ================================================================== */
/* 19. Meeting Translator — projection layout (big fonts / fullscreen) */
/* ================================================================== */

// Same content in both layouts — only the arrangement (stacked vs columns) differs.
// Same sentences shown in both layouts — only the arrangement (stacked vs columns) differs.
type ProjPair = { zh: string; en: string; fr?: string };
type ProjLang = { chip: string; key: 'zh' | 'en' | 'fr'; translate?: boolean; strong?: boolean };

const MP_PAIRS: ProjPair[] = [
  { zh: '欢迎各位参加今天的会议', en: 'Welcome to today’s meeting' },
  { zh: '先看这一季的整体路线图', en: 'First, the overall roadmap this quarter' },
  { zh: '请看这一页的关键里程碑', en: 'Now, the key milestones on this page' },
];
const MP3_PAIRS: ProjPair[] = [
  { zh: '欢迎各位参加今天的会议', en: 'Welcome to today’s meeting', fr: 'Bienvenue à la réunion' },
  { zh: '先看这一季的整体路线图', en: 'The overall roadmap this quarter', fr: 'La feuille de route du trimestre' },
];
const LANGS2: ProjLang[] = [{ chip: '中', key: 'zh', translate: true, strong: true }, { chip: '英', key: 'en' }];
const LANGS3: ProjLang[] = [...LANGS2, { chip: '法', key: 'fr' }];

// One projection screen: toggles 横版 (stacked) ↔ 竖版 (columns); the same sentences either way.
// Works for any number of languages, so 2- and 3-language variants share this.
function ProjectionCore({ pairs, langs }: { pairs: ProjPair[]; langs: ProjLang[] }) {
  const t = useT();
  const reduced = usePrefersReducedMotion();
  const i = useCycle(2, 2000, reduced);
  const columns = reduced ? false : i === 1; // false = 横版 (stacked), true = 竖版 (columns)
  const txt = (p: ProjPair, l: ProjLang) => (l.translate ? t(p[l.key] || '') : p[l.key] || '');
  return (
    <Screen title={t('投屏排版')} icon="ri-slideshow-2-line">
      {/* 16:9 like a projection screen */}
      <div className="aspect-video flex flex-col">
        {/* toolbar: which layout is active, font size, fullscreen */}
        <div className="flex items-center gap-1.5 mb-2 flex-shrink-0">
          <span className="text-[9px] font-semibold text-accent-600 w-6">{columns ? t('竖版') : t('横版')}</span>
          <span className={`w-4 h-4 flex items-center justify-center rounded transition-colors ${!columns ? 'bg-accent-100 text-accent-600' : 'text-foreground-300'}`}>
            <i className="ri-layout-row-line text-[11px]" />
          </span>
          <span className={`w-4 h-4 flex items-center justify-center rounded transition-colors ${columns ? 'bg-accent-100 text-accent-600' : 'text-foreground-300'}`}>
            <i className="ri-layout-column-line text-[11px]" />
          </span>
          <span className="ml-auto flex items-center gap-2 text-foreground-300">
            <span className="flex items-center gap-0.5 text-[9px] tabular-nums"><i className="ri-font-size" />150%</span>
            <i className="ri-fullscreen-line text-[11px]" />
          </span>
        </div>
        <div className="flex-1 min-h-0 flex items-stretch">
          {!columns ? (
            /* 横版: stacked, each sentence as one row per language */
            <div key="stack" className="w-full overflow-hidden flex flex-col justify-end gap-1.5">
              {pairs.map((p, idx) => (
                <div key={idx} className="space-y-0.5">
                  {langs.map((l, li) => (
                    <div key={li} className="flex items-center gap-1.5">
                      <span className="flex-shrink-0 text-[8px] font-bold px-1 py-0.5 rounded bg-accent-100 text-accent-600">{t(l.chip)}</span>
                      <span className={`text-[11px] font-semibold truncate ${l.strong ? 'text-foreground-900' : 'text-foreground-600'}`}>{txt(p, l)}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ) : (
            /* 竖版: one column per language, the same sentences */
            <div key="cols" className="w-full flex gap-1.5">
              {langs.map((l, li) => (
                <div key={li} className="flex-1 min-w-0 flex flex-col border-l-2 border-background-200 pl-1.5 first:border-l-0 first:pl-0">
                  <span className="self-start text-[8px] font-bold px-1 py-0.5 rounded bg-accent-100 text-accent-600">{t(l.chip)}</span>
                  <div className="flex-1 overflow-hidden flex flex-col justify-end gap-1 pt-1">
                    {pairs.map((p, idx) => (
                      <span key={idx} className="text-[10px] font-semibold text-foreground-800 break-words leading-snug">{txt(p, l)}</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Screen>
  );
}

export function MeetingProjectionDemo() { return <ProjectionCore pairs={MP_PAIRS} langs={LANGS2} />; }
export function MeetingProjection3Demo() { return <ProjectionCore pairs={MP3_PAIRS} langs={LANGS3} />; }

export function MeetingProjectionShowcase() {
  const t = useT();
  const label = (text: string) => (
    <div className="flex items-center gap-1 text-[10px] font-medium text-foreground-400">
      <i className="ri-checkbox-circle-line text-accent-500" />{t(text)}
    </div>
  );
  return (
    <div className="space-y-2">
      {label('选 2 种语言')}
      <MeetingProjectionDemo />
      {label('选 3 种语言(中 / 英 / 法)')}
      <MeetingProjection3Demo />
    </div>
  );
}

/* ================================================================== */
/* 20. Meeting Translator — AI meeting minutes (the highlight)         */
/* ================================================================== */

const MIN_POINTS = ['确定 8 月上线时间表', 'API 联调本周内完成'];
const MIN_TODOS = [
  { task: '补充测试用例', owner: '小李' },
  { task: '准备发布说明', owner: 'Anna' },
];

export function MeetingMinutesDemo() {
  const t = useT();
  const reduced = usePrefersReducedMotion();
  const i = useCycle(8, 720, reduced); // generating → summary → points → decision → todos → hold…
  const generating = !reduced && i < 2;
  const showSummary = reduced || i >= 2;
  const showPoints = reduced || i >= 3;
  const showDecision = reduced || i >= 4;
  const showTodos = reduced || i >= 5;
  const Row = ({ show, children }: { show: boolean; children: React.ReactNode }) => (
    <div className="transition-all duration-400" style={{ opacity: show ? 1 : 0, transform: show ? 'translateY(0)' : 'translateY(6px)' }}>
      {children}
    </div>
  );
  return (
    <Screen title={t('会议纪要')} icon="ri-file-list-3-line">
      <div className="min-h-[118px] space-y-1.5">
        <div className="flex items-center gap-1 text-[10px] font-semibold text-foreground-800">
          <i className="ri-magic-fill text-accent-500" />
          {generating ? (
            <span className="flex items-center gap-1 text-foreground-400">
              <i className="ri-loader-4-line animate-spin" />
              {t('AI 整理中…')}
            </span>
          ) : (
            t('8 月上线评审会')
          )}
        </div>
        <Row show={showSummary}>
          <p className="text-[9px] text-foreground-500 leading-snug pl-2 border-l-2 border-background-200">
            {t('评审 8 月上线计划,明确联调排期与发布准备工作。')}
          </p>
        </Row>
        <Row show={showPoints}>
          <div className="text-[9px] font-semibold text-foreground-600 mb-0.5">{t('讨论要点')}</div>
          {MIN_POINTS.map((p, idx) => (
            <div key={idx} className="flex items-start gap-1 text-[9px] text-foreground-500">
              <span className="text-accent-500 font-bold">{idx + 1}.</span>
              {t(p)}
            </div>
          ))}
        </Row>
        <Row show={showTodos}>
          <div className="text-[9px] font-semibold text-foreground-600 mb-0.5">{t('待办事项')}</div>
          {MIN_TODOS.map((td, idx) => (
            <div key={idx} className="flex items-center gap-1 text-[9px] text-foreground-500">
              <i className="ri-checkbox-blank-circle-line text-[7px] text-accent-500" />
              {t(td.task)}
              <span className="px-1 rounded bg-accent-100 text-accent-600 text-[8px]">{t(td.owner)}</span>
            </div>
          ))}
        </Row>
      </div>
      {/* footer: choose language + export PDF, mirroring the real minutes bar */}
      <div className="mt-2 pt-1.5 border-t border-background-100 flex items-center gap-1.5" style={{ opacity: showDecision ? 1 : 0, transition: 'opacity .4s' }}>
        {['中', '英'].map((c) => (
          <span key={c} className="text-[8px] font-bold px-1 py-0.5 rounded bg-background-200 text-foreground-500">{t(c)}</span>
        ))}
        <span className="ml-auto inline-flex items-center gap-0.5 text-[8px] font-semibold text-accent-600">
          <i className="ri-file-pdf-2-line" />
          {t('导出 PDF')}
        </span>
      </div>
    </Screen>
  );
}

/* ================================================================== */
/* 21. Meeting Translator — file library (slides / video beside text)  */
/* ================================================================== */

/**
 * A mini PowerPoint slide rendered with pure CSS (two pages: a cover and a bullet page). Everything is
 * sized in `em` off a single font-size derived from the given height `h` (px), so the whole slide scales
 * proportionally — it renders correctly whether the display box is tiny or large.
 */
function MiniSlide({ page, h }: { page: number; h: number }) {
  const t = useT();
  const box: React.CSSProperties = {
    height: h, width: (h * 4) / 3, fontSize: h / 9,
    transition: 'width .5s ease, height .5s ease, font-size .5s ease', // grow smoothly with the box
  };
  if (page === 1) {
    // Cover slide
    return (
      <div style={box} className="rounded bg-white flex flex-col items-center justify-center px-[0.5em] relative overflow-hidden shadow">
        <div className="absolute top-0 left-0 right-0 bg-accent-500" style={{ height: '0.16em' }} />
        <div className="font-bold text-neutral-800 leading-tight" style={{ fontSize: '1.15em' }}>{t('产品路线图')}</div>
        <div className="text-neutral-400 tracking-wide" style={{ fontSize: '0.6em', marginTop: '0.2em' }}>PRODUCT ROADMAP · 2026</div>
        <div className="bg-accent-500 rounded" style={{ width: '2.2em', height: '0.13em', marginTop: '0.35em' }} />
      </div>
    );
  }
  // Bullet slide
  const bullets = ['Q1 立项调研', 'Q2 内部测试', 'Q3 正式上线'];
  return (
    <div style={box} className="rounded bg-white flex flex-col px-[0.7em] py-[0.5em] relative overflow-hidden shadow">
      <div className="font-bold text-neutral-800" style={{ fontSize: '0.95em' }}>{t('关键里程碑')}</div>
      <div className="bg-accent-500 rounded" style={{ width: '1.6em', height: '0.13em', marginTop: '0.15em', marginBottom: '0.4em' }} />
      <div className="flex flex-col" style={{ gap: '0.32em' }}>
        {bullets.map((b, idx) => (
          <div key={idx} className="flex items-center text-neutral-600" style={{ fontSize: '0.82em', gap: '0.4em' }}>
            <span className="rounded-full bg-accent-500 flex-shrink-0" style={{ width: '0.36em', height: '0.36em' }} />
            <span className="truncate">{t(b)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Subtitle lines for the mock meeting page. Rendered bottom-aligned (newest hugs the bottom).
const MF_SUBS = [
  { zh: '欢迎各位参加今天的会议', en: 'Welcome everyone to today’s meeting' },
  { zh: '先看这一季的整体路线图', en: 'First, the overall roadmap this quarter' },
  { zh: '请看这一页的关键里程碑', en: 'Now, the key milestones on this page' },
];

// Vertical (columns) layout: one column per language, both visible at once, each bottom-aligned.
function MfSubtitles() {
  const t = useT();
  const col = (chip: string, lines: string[], strong: boolean) => (
    <div className="flex-1 min-w-0 flex flex-col">
      <span className="self-start text-[8px] font-bold px-1 py-0.5 rounded bg-accent-100 text-accent-600">{t(chip)}</span>
      <div className="flex-1 overflow-hidden flex flex-col justify-end gap-1 pt-1">
        {lines.map((l, idx) => (
          <span key={idx} className={`text-[8px] leading-snug break-words ${strong ? 'text-foreground-800' : 'text-foreground-500'}`}>{l}</span>
        ))}
      </div>
    </div>
  );
  return (
    <div className="h-full flex gap-2">
      {col('中', MF_SUBS.map((p) => t(p.zh)), true)}
      {col('英', MF_SUBS.map((p) => p.en), false)}
    </div>
  );
}

export function MeetingFilesDemo() {
  const t = useT();
  const reduced = usePrefersReducedMotion();
  const i = useCycle(9, 1050, reduced);
  // Full flow: ordinary page (adaptive, bottom-aligned subtitles) → open library → upload → double-click
  // → present in the box → drag the divider to resize → collapse the top bar for a bigger view.
  // Note the order: 'resize' only stretches the box (page stays 1); the page flips on the *next* frame
  // ('flip'), at the same size — so the page turn happens after the stretch finishes, not during it.
  const scene = reduced
    ? 'collapse'
    : (['normal', 'empty', 'uploading', 'opening', 'present', 'resize', 'flip', 'collapse', 'collapse'][i] || 'normal');
  const inLibrary = scene === 'empty' || scene === 'uploading' || scene === 'opening';
  const presenting = scene === 'present' || scene === 'resize' || scene === 'flip' || scene === 'collapse';
  const collapsed = scene === 'collapse';
  const boxH = scene === 'present' ? 42 : scene === 'resize' ? 72 : scene === 'flip' ? 72 : scene === 'collapse' ? 92 : 0; // file-box height (px)
  const page = scene === 'flip' || scene === 'collapse' ? 2 : 1;
  const caption = scene === 'resize' ? '拖动分隔条调整大小' : scene === 'flip' ? '拉伸完成,翻到下一页' : scene === 'collapse' ? '上拉顶栏,画面更大' : '';

  return (
    <Screen title={t('管理文件')} icon="ri-folder-3-line">
      <div className="h-[150px] flex flex-col">
        {/* top bar — collapses (pulls up) in the last scene to give the display more room */}
        {!collapsed ? (
          <div className="flex items-center gap-1 pb-1 mb-1 border-b border-background-200">
            <i className="ri-translate-2 text-accent-500 text-[10px]" />
            <span className="text-[8px] font-semibold text-foreground-700">{t('会议翻译')}</span>
            <span
              className={`ml-auto inline-flex items-center gap-0.5 text-[8px] rounded px-1 py-0.5 transition-colors ${
                inLibrary ? 'bg-accent-500 text-background-50' : 'text-foreground-500 border border-background-200'
              }`}
            >
              <i className="ri-folder-3-line" />{t('管理文件')}
            </span>
          </div>
        ) : (
          <div className="flex justify-center pb-1">
            <span className="inline-flex items-center h-2.5 px-2 rounded-b bg-background-100 text-foreground-400">
              <i className="ri-arrow-up-s-line text-[10px]" />
            </span>
          </div>
        )}

        {/* body */}
        <div className="flex-1 min-h-0">
          {scene === 'normal' ? (
            /* ordinary page: subtitles fill the adaptive area, bottom-aligned */
            <MfSubtitles />
          ) : inLibrary ? (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-1">
                <i className="ri-folder-3-line text-accent-500 text-[11px]" />
                <span className="text-[10px] font-semibold text-foreground-800">{t('文件库')}</span>
                <span className="ml-auto inline-flex items-center gap-0.5 text-[8px] font-semibold text-background-50 bg-accent-500 rounded px-1.5 py-0.5">
                  <i className="ri-add-line" />{t('新增文件')}
                </span>
              </div>
              {scene === 'empty' ? (
                <div className="rounded-md border border-dashed border-background-300 flex flex-col items-center justify-center gap-1 py-4 text-foreground-300">
                  <i className="ri-upload-cloud-2-line text-base" />
                  <span className="text-[8px]">{t('上传 PPT / 视频 / 图片')}</span>
                </div>
              ) : scene === 'uploading' ? (
                <div className="rounded-md border border-background-200 bg-background-50 px-2 py-2.5">
                  <div className="flex items-center gap-1 text-[9px] text-foreground-600 mb-1.5">
                    <i className="ri-file-ppt-2-line text-accent-500" />{t('产品路线图.pptx')}
                  </div>
                  <div className="h-1 rounded-full bg-background-200 overflow-hidden">
                    <div className="h-full bg-accent-500 rounded-full" style={{ width: '68%' }} />
                  </div>
                  <div className="text-[7px] text-foreground-400 mt-1">{t('上传中…')}</div>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 px-1.5 py-2.5 rounded-md border border-accent-400 bg-accent-100 ring-2 ring-accent-200">
                  <i className="ri-file-ppt-2-line text-accent-500 text-xs" />
                  <span className="text-[10px] text-foreground-700 truncate">{t('产品路线图.pptx')}</span>
                  <span className="ml-auto text-[8px] text-accent-600">{t('双击打开')}</span>
                </div>
              )}
            </div>
          ) : presenting ? (
            /* presenting: bottom-aligned subtitle strip on top, resizable file box below */
            <div className="h-full flex flex-col">
              <div className="flex-1 min-h-0">
                <MfSubtitles />
              </div>
              {/* divider — highlighted while resizing */}
              <div className="flex justify-center py-0.5">
                <div className={`h-0.5 rounded-full transition-all duration-300 ${scene === 'resize' ? 'w-12 bg-accent-500' : 'w-8 bg-background-300'}`} />
              </div>
              <div
                style={{ height: boxH }}
                className="relative flex-shrink-0 rounded-md bg-neutral-800 flex items-center justify-center transition-all duration-500 overflow-hidden"
              >
                <MiniSlide page={page} h={boxH - 12} />
                <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 text-[6px] text-white/80 bg-black/40 rounded-full px-1 tabular-nums">
                  {page} / 2
                </span>
                <i className="ri-close-line absolute top-0.5 right-0.5 text-white/60 text-[9px]" />
              </div>
            </div>
          ) : null}
        </div>

        {/* scene caption for the resize / collapse steps */}
        <div className="h-3 pt-0.5 text-center text-[7px] text-accent-600">
          {caption ? (
            <span className="inline-flex items-center gap-0.5">
              <i className={scene === 'resize' ? 'ri-drag-move-2-line' : scene === 'flip' ? 'ri-arrow-right-s-line' : 'ri-arrow-up-s-line'} />
              {t(caption)}
            </span>
          ) : ''}
        </div>
      </div>
    </Screen>
  );
}

/* ================================================================== */
/* 22. Meeting Translator — meeting history                            */
/* ================================================================== */

const MH_ROWS = [
  { d: '08-20', t: '8 月上线评审会' },
  { d: '08-18', t: '中韩合作沟通' },
];

export function MeetingHistoryDemo() {
  const t = useT();
  const reduced = usePrefersReducedMotion();
  const i = useCycle(MH_ROWS.length + 3, 750, reduced);
  const shown = reduced ? MH_ROWS.length : Math.min(i, MH_ROWS.length);
  return (
    <Screen title={t('会议历史')} icon="ri-history-line">
      <div className="space-y-1 min-h-[84px]">
        {MH_ROWS.slice(0, shown).map((r, idx) => (
          <div
            key={idx}
            className="flex items-center gap-2 px-1.5 py-1.5 rounded-md border border-background-200 bg-background-50"
          >
            <i className="ri-translate-2 text-accent-500 text-xs" />
            <span className="text-[9px] font-mono text-foreground-400">{r.d}</span>
            <span className="text-[10px] text-foreground-700 truncate">{t(r.t)}</span>
            <span className="ml-auto flex items-center gap-1 text-[9px] text-foreground-300">
              <i className="ri-file-list-3-line" title={t('会议纪要')} />
            </span>
          </div>
        ))}
        {shown < MH_ROWS.length && !reduced && (
          <div className="flex items-center gap-1 text-[9px] text-foreground-300">
            <i className="ri-save-line" /> {t('自动存档中…')}
          </div>
        )}
      </div>
    </Screen>
  );
}

/* ------------------------------------------------------------------ */
/* Demo component registry: mapped by key                              */
/* ------------------------------------------------------------------ */

export const DEMOS: Record<string, React.ComponentType> = {
  record: RecordDemo,
  speaker: SpeakerDemo,
  mark: MarkDemo,
  photo: PhotoDemo,
  correction: CorrectionDemo,
  segment: SegmentDemo,
  translate: TranslateDemo,
  summary: SummaryDemo,
  flashcard: FlashcardDemo,
  courseSummary: CourseSummaryDemo,
  examPie: ExamPieDemo,
  quiz: QuizDemo,
  tag: TagDemo,
  reference: ReferenceDemo,
  share: ShareDemo,
  history: HistoryDemo,
  toggle: ToggleDemo,
  meetingLive: MeetingLiveShowcase,
  meetingProjection: MeetingProjectionShowcase,
  meetingMinutes: MeetingMinutesDemo,
  meetingFiles: MeetingFilesDemo,
  meetingHistory: MeetingHistoryDemo,
};

export type DemoKey = keyof typeof DEMOS;
