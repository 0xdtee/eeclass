/**
 * Review: flashcards (with Ebbinghaus scheduling), self-test questions, and asking DeepSeek follow-ups about this session.
 * The transcript is just raw material; what you can self-test on is what review really needs.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AskCite, Flashcard, QuizItem } from '@/hooks/useLibrary';
import { useT } from '@/lib/i18n';

interface ReviewTabProps {
  sid: string;
  title: string;
  hasLines: boolean;
  onStudy: (sid: string, mode: 'flashcards' | 'quiz', title?: string) => Promise<{
    flashcards?: Flashcard[];
    quiz?: QuizItem[];
  }>;
  onAsk: (
    sid: string,
    q: string,
    history: { role: string; content: string }[],
    title?: string
  ) => Promise<{ answer: string; cites: AskCite[] }>;
  onSeek: (seconds: number) => void;
}

/** Ebbinghaus intervals (days). Forgot = come back in 10 minutes; the rest progress by this. */
const LADDER = [1, 2, 4, 7, 15];
const AGAIN_MS = 10 * 60 * 1000;

interface CardState {
  step: number;
  due: number;
}

const stateKey = (sid: string) => `flash_${sid}`;

function loadState(sid: string): Record<number, CardState> {
  try {
    return JSON.parse(localStorage.getItem(stateKey(sid)) || '{}');
  } catch {
    return {};
  }
}
function saveState(sid: string, s: Record<number, CardState>) {
  localStorage.setItem(stateKey(sid), JSON.stringify(s));
}

export default function ReviewTab({
  sid, title, hasLines, onStudy, onAsk, onSeek,
}: ReviewTabProps) {
  const t = useT();
  const [section, setSection] = useState<'cards' | 'quiz' | 'ask'>('cards');

  // ---- Flashcards ----
  const [cards, setCards] = useState<Flashcard[]>([]);
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [cardState, setCardState] = useState<Record<number, CardState>>({});
  const [loadingCards, setLoadingCards] = useState(false);

  // ---- Self-test ----
  const [quiz, setQuiz] = useState<QuizItem[]>([]);
  const [picked, setPicked] = useState<Record<number, number>>({});
  const [wrongOnly, setWrongOnly] = useState(false);
  const [loadingQuiz, setLoadingQuiz] = useState(false);

  // ---- Follow-up ----
  const [chat, setChat] = useState<{ role: string; content: string; cites?: AskCite[] }[]>([]);
  const [q, setQ] = useState('');
  const [asking, setAsking] = useState(false);

  const [error, setError] = useState('');

  useEffect(() => {
    setCards([]); setQuiz([]); setChat([]); setIdx(0); setFlipped(false);
    setPicked({}); setError('');
    setCardState(loadState(sid));
  }, [sid]);

  const dueCount = useMemo(() => {
    const now = Date.now();
    return cards.filter((_, i) => (cardState[i]?.due ?? 0) <= now).length;
  }, [cards, cardState]);

  const genCards = useCallback(async () => {
    setLoadingCards(true);
    setError('');
    try {
      const j = await onStudy(sid, 'flashcards', title);
      setCards(j.flashcards ?? []);
      setIdx(0);
      setFlipped(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingCards(false);
    }
  }, [sid, title, onStudy]);

  const genQuiz = useCallback(async () => {
    setLoadingQuiz(true);
    setError('');
    try {
      const j = await onStudy(sid, 'quiz', title);
      setQuiz(j.quiz ?? []);
      setPicked({});
      setWrongOnly(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingQuiz(false);
    }
  }, [sid, title, onStudy]);

  const grade = (level: 'again' | 'hard' | 'good') => {
    const cur = cardState[idx] ?? { step: 0, due: 0 };
    let next: CardState;
    if (level === 'again') next = { step: 0, due: Date.now() + AGAIN_MS };
    else if (level === 'hard') next = { step: 1, due: Date.now() + LADDER[0] * 86400000 };
    else {
      const step = Math.min(cur.step + 1, LADDER.length);
      next = { step, due: Date.now() + LADDER[step - 1] * 86400000 };
    }
    const s = { ...cardState, [idx]: next };
    setCardState(s);
    saveState(sid, s);
    setFlipped(false);
    setIdx((i) => (i + 1) % Math.max(1, cards.length));
  };

  const send = async () => {
    const question = q.trim();
    if (!question || asking) return;
    setQ('');
    const history = chat.map(({ role, content }) => ({ role, content }));
    setChat((c) => [...c, { role: 'user', content: question }]);
    setAsking(true);
    setError('');
    try {
      const j = await onAsk(sid, question, history, title);
      setChat((c) => [...c, { role: 'assistant', content: j.answer, cites: j.cites }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAsking(false);
    }
  };

  if (!hasLines) {
    return (
      <div className="bg-background-50 border border-background-200 rounded-xl p-12 text-center">
        <i className="ri-book-read-line text-foreground-300 text-3xl"></i>
        <p className="text-sm text-foreground-400 mt-3">{t('这节课还没有转写内容')}</p>
        <p className="text-xs text-foreground-300 mt-1">{t('先录一节课，或去「历史课程」选一节已录好的')}</p>
      </div>
    );
  }

  const card = cards[idx];
  const shown = wrongOnly ? quiz.filter((it, i) => picked[i] !== undefined && picked[i] !== it.answer) : quiz;
  const answered = Object.keys(picked).length;
  const right = quiz.filter((it, i) => picked[i] === it.answer).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        {([['cards', '闪卡', 'ri-flashlight-line'], ['quiz', '自测题', 'ri-question-line'],
           ['ask', '追问这节课', 'ri-chat-3-line']] as const).map(([k, label, icon]) => (
          <button
            key={k}
            onClick={() => setSection(k)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
              section === k
                ? 'bg-accent-500 text-background-50'
                : 'bg-background-100 text-foreground-600 hover:bg-background-200'
            }`}
          >
            <i className={icon}></i>
            {t(label)}
          </button>
        ))}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3">
          <p className="text-xs text-red-700">{error}</p>
        </div>
      )}

      {/* ---------------- Flashcards ---------------- */}
      {section === 'cards' && (
        <div className="bg-background-50 border border-background-200 rounded-xl p-6">
          {cards.length === 0 ? (
            <div className="text-center py-10">
              <p className="text-sm text-foreground-500">{t('让 DeepSeek 把这节课做成闪卡')}</p>
              <button
                data-guide="make-flashcard"
                onClick={genCards}
                disabled={loadingCards}
                className="mt-4 px-5 py-2.5 bg-accent-500 text-background-50 rounded-full text-sm font-semibold hover:bg-accent-600 cursor-pointer disabled:opacity-50"
              >
                {loadingCards ? t('生成中…（约 10 秒）') : t('生成闪卡')}
              </button>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-4">
                <span className="text-xs text-foreground-500">
                  {t('第 {a} / {b} 张 · 今天要复习 {c} 张', { a: idx + 1, b: cards.length, c: dueCount })}
                </span>
                <button
                  onClick={genCards}
                  disabled={loadingCards}
                  className="text-xs text-foreground-400 hover:text-foreground-600 cursor-pointer"
                >
                  <i className="ri-refresh-line mr-1"></i>{t('重新生成')}
                </button>
              </div>

              <div
                onClick={() => setFlipped((f) => !f)}
                className="min-h-[180px] flex flex-col items-center justify-center text-center p-6 bg-background-100 rounded-xl cursor-pointer select-none"
              >
                <p className="text-base text-foreground-800 leading-relaxed">{card?.front}</p>
                {flipped && (
                  <>
                    <div className="w-16 h-px bg-background-300 my-4"></div>
                    <p className="text-sm text-foreground-600 leading-relaxed">{card?.back}</p>
                  </>
                )}
                {!flipped && <p className="text-xs text-foreground-400 mt-6">{t('点击翻面')}</p>}
              </div>

              <div className="flex items-center justify-between mt-4 gap-2">
                <div className="flex gap-2">
                  <button onClick={() => grade('again')} className="px-4 py-2 bg-red-50 text-red-600 rounded-full text-xs font-semibold hover:bg-red-100 cursor-pointer">
                    {t('忘了')}
                  </button>
                  <button onClick={() => grade('hard')} className="px-4 py-2 bg-accent-50 text-accent-700 rounded-full text-xs font-semibold hover:bg-accent-100 cursor-pointer">
                    {t('有印象')}
                  </button>
                  <button onClick={() => grade('good')} className="px-4 py-2 bg-green-50 text-green-700 rounded-full text-xs font-semibold hover:bg-green-100 cursor-pointer">
                    {t('记住了')}
                  </button>
                </div>
                {card?.start ? (
                  <button
                    onClick={() => onSeek(card.start)}
                    className="flex items-center gap-1 text-xs text-foreground-400 hover:text-accent-600 cursor-pointer"
                    title={t('听老师的原话')}
                  >
                    <i className="ri-volume-up-line"></i>
                    {card.ts}
                  </button>
                ) : null}
              </div>
            </>
          )}
        </div>
      )}

      {/* ---------------- Self-test ---------------- */}
      {section === 'quiz' && (
        <div className="bg-background-50 border border-background-200 rounded-xl p-6">
          {quiz.length === 0 ? (
            <div className="text-center py-10">
              <p className="text-sm text-foreground-500">{t('让 DeepSeek 出一套这节课的自测题')}</p>
              <button
                data-guide="make-quiz"
                onClick={genQuiz}
                disabled={loadingQuiz}
                className="mt-4 px-5 py-2.5 bg-accent-500 text-background-50 rounded-full text-sm font-semibold hover:bg-accent-600 cursor-pointer disabled:opacity-50"
              >
                {loadingQuiz ? t('出题中…（约 10 秒）') : t('生成自测题')}
              </button>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                <span className="text-xs text-foreground-500">
                  {t('已答 {a} / {b}', { a: answered, b: quiz.length })}
                  {answered > 0 && t(' · 对 {n} 题', { n: right })}
                </span>
                <div className="flex items-center gap-3">
                  {answered > 0 && right < answered && (
                    <label className="flex items-center gap-1.5 text-xs text-foreground-500 cursor-pointer">
                      <input type="checkbox" checked={wrongOnly} onChange={(e) => setWrongOnly(e.target.checked)} className="cursor-pointer" />
                      {t('只看错题')}
                    </label>
                  )}
                  <button onClick={genQuiz} className="text-xs text-foreground-400 hover:text-foreground-600 cursor-pointer">
                    <i className="ri-refresh-line mr-1"></i>{t('换一套')}
                  </button>
                </div>
              </div>

              <div className="space-y-5">
                {shown.map((it) => {
                  const i = quiz.indexOf(it);
                  const chose = picked[i];
                  const done = chose !== undefined;
                  return (
                    <div key={i}>
                      <p className="text-sm text-foreground-800 mb-2">
                        {i + 1}. {it.question}
                      </p>
                      <div className="space-y-1.5">
                        {it.options.map((opt, oi) => {
                          const isAnswer = oi === it.answer;
                          const isChosen = chose === oi;
                          let cls = 'bg-background-100 text-foreground-700 hover:bg-background-200';
                          if (done && isAnswer) cls = 'bg-green-100 text-green-800';
                          else if (done && isChosen) cls = 'bg-red-100 text-red-700';
                          else if (done) cls = 'bg-background-100 text-foreground-400';
                          return (
                            <button
                              key={oi}
                              disabled={done}
                              onClick={() => setPicked((p) => ({ ...p, [i]: oi }))}
                              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${cls} ${done ? '' : 'cursor-pointer'}`}
                            >
                              {String.fromCharCode(65 + oi)}. {opt}
                            </button>
                          );
                        })}
                      </div>
                      {done && (
                        <div className="mt-2 flex items-start justify-between gap-3">
                          <p className="text-xs text-foreground-500 leading-relaxed flex-1">{it.why}</p>
                          {it.start ? (
                            <button
                              onClick={() => onSeek(it.start)}
                              className="flex items-center gap-1 text-xs text-foreground-400 hover:text-accent-600 cursor-pointer flex-shrink-0"
                            >
                              <i className="ri-volume-up-line"></i>{t('听原话')}
                            </button>
                          ) : null}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {answered === quiz.length && (
                <div className="mt-6 p-4 bg-accent-50 rounded-lg text-center">
                  <p className="text-sm font-semibold text-accent-800">
                    {t('做完了：{a} / {b} 题正确', { a: right, b: quiz.length })}
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ---------------- Follow-up ---------------- */}
      {section === 'ask' && (
        <div className="bg-background-50 border border-background-200 rounded-xl p-6">
          <div className="min-h-[240px] max-h-[440px] overflow-y-auto space-y-4 mb-4">
            {chat.length === 0 && (
              <div className="text-center py-10">
                <p className="text-sm text-foreground-500">{t('拿这节课的内容问 DeepSeek')}</p>
                <p className="text-xs text-foreground-400 mt-2">
                  {t('比如「老师讲格林公式时强调了什么」「这节课有哪些是明说要考的」')}
                </p>
                <p className="text-xs text-foreground-300 mt-2">
                  {t('它只根据这节课的转写回答，没讲到的会直说没讲到')}
                </p>
              </div>
            )}
            {chat.map((m, i) => (
              <div key={i} className={m.role === 'user' ? 'text-right' : ''}>
                <div
                  className={`inline-block max-w-[85%] text-left px-3.5 py-2.5 rounded-xl text-sm leading-relaxed ${
                    m.role === 'user'
                      ? 'bg-primary-500 text-background-50'
                      : 'bg-background-100 text-foreground-700'
                  }`}
                >
                  {m.content}
                  {m.cites && m.cites.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-background-200 space-y-1">
                      {m.cites.map((c) => (
                        <button
                          key={c.line_id}
                          onClick={() => onSeek(c.start)}
                          className="block text-left text-xs text-foreground-500 hover:text-accent-600 cursor-pointer"
                        >
                          <span className="font-mono mr-1.5">{c.ts}</span>
                          {c.text.slice(0, 40)}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {asking && <p className="text-xs text-foreground-400">{t('DeepSeek 思考中…')}</p>}
          </div>

          <div className="flex items-center gap-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void send()}
              placeholder={t('问这节课的内容…')}
              className="flex-1 text-sm px-3 py-2.5 rounded-lg border border-background-200 bg-background-50"
            />
            <button
              onClick={() => void send()}
              disabled={asking || !q.trim()}
              className="px-4 py-2.5 bg-accent-500 text-background-50 rounded-lg text-sm font-semibold hover:bg-accent-600 cursor-pointer disabled:opacity-50"
            >
              {t('问')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
