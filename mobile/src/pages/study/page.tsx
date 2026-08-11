import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useSessions, useStudy } from '@/hooks/useRecords';

type Mode = 'flashcards' | 'quiz';

export default function StudyPage() {
  const [params] = useSearchParams();
  const { sessions, loading: sessLoading } = useSessions();
  const { data, loading, error, generate, clear } = useStudy();

  const [sid, setSid] = useState<string>(params.get('sid') || '');
  const [mode, setMode] = useState<Mode>('flashcards');

  // When there's a session list and none is selected, default to the first one
  useEffect(() => {
    if (!sid && sessions.length > 0) setSid(sessions[0].sid);
  }, [sessions, sid]);

  const run = (m: Mode) => {
    if (!sid) return;
    setMode(m);
    clear();
    generate(sid, m);
  };

  return (
    <div className="min-h-full bg-background-50">
      {/* Header */}
      <div className="px-5 md:px-8 pt-6 md:pt-8 pb-4">
        <h1 className="text-lg md:text-2xl font-bold text-foreground-900">复习</h1>
        <p className="text-xs md:text-sm text-foreground-400 mt-1">基于课堂转写生成闪卡与自测题</p>
      </div>

      <div className="px-5 md:px-8 pb-24 md:pb-8 max-w-5xl">
        {/* Course picker */}
        <div className="mb-4">
          <label className="text-xs text-foreground-500">选择课时</label>
          {sessLoading ? (
            <div className="mt-1 h-11 rounded-xl bg-background-100 animate-pulse" />
          ) : sessions.length === 0 ? (
            <p className="mt-1 text-sm text-foreground-400">还没有课时,请先录制一节课</p>
          ) : (
            <select
              value={sid}
              onChange={(e) => { setSid(e.target.value); clear(); }}
              className="w-full mt-1 px-3 py-2.5 rounded-xl bg-background-50 border border-background-200 text-sm text-foreground-800 focus:outline-none focus:border-accent-400"
            >
              {sessions.map((s) => (
                <option key={s.sid} value={s.sid}>{s.title}（{s.date}）</option>
              ))}
            </select>
          )}
        </div>

        {/* Mode switch */}
        <div className="grid grid-cols-2 gap-3 mb-5">
          <button
            onClick={() => run('flashcards')}
            disabled={!sid || loading}
            className={`flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-medium transition-colors disabled:opacity-50 whitespace-nowrap cursor-pointer ${
              mode === 'flashcards' ? 'bg-accent-500 text-background-50' : 'bg-background-100 text-foreground-600 hover:bg-background-200'
            }`}
          >
            <i className="ri-stack-line"></i>闪卡
          </button>
          <button
            onClick={() => run('quiz')}
            disabled={!sid || loading}
            className={`flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-medium transition-colors disabled:opacity-50 whitespace-nowrap cursor-pointer ${
              mode === 'quiz' ? 'bg-accent-500 text-background-50' : 'bg-background-100 text-foreground-600 hover:bg-background-200'
            }`}
          >
            <i className="ri-question-answer-line"></i>自测题
          </button>
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex flex-col items-center py-16">
            <i className="ri-loader-4-line animate-spin text-accent-500 text-2xl"></i>
            <p className="text-xs text-foreground-400 mt-2">AI 正在出题…</p>
          </div>
        )}

        {/* Error */}
        {!loading && error && (
          <div className="flex flex-col items-center py-12 text-center">
            <div className="w-12 h-12 flex items-center justify-center bg-red-50 rounded-xl mb-2">
              <i className="ri-error-warning-line text-red-400 text-xl"></i>
            </div>
            <p className="text-sm text-red-500">{error}</p>
          </div>
        )}

        {/* Not-generated notice */}
        {!loading && !error && !data && (
          <div className="flex flex-col items-center py-12 text-center">
            <div className="w-16 h-16 flex items-center justify-center bg-primary-100 rounded-2xl mb-4">
              <i className="ri-brain-line text-primary-600 text-2xl"></i>
            </div>
            <p className="text-sm text-foreground-400 max-w-xs leading-relaxed">
              选择课时后,点击上方的「闪卡」或「自测题」,AI 会根据本节课内容出题。
            </p>
          </div>
        )}

        {/* Flashcards */}
        {!loading && !error && data && mode === 'flashcards' && (
          <FlashcardDeck cards={data.flashcards} />
        )}

        {/* Self-test questions */}
        {!loading && !error && data && mode === 'quiz' && (
          <QuizList items={data.quiz} />
        )}
      </div>
    </div>
  );
}

function FlashcardDeck({ cards }: { cards: { front: string; back: string; ts: string }[] }) {
  if (!cards || cards.length === 0) {
    return <p className="text-sm text-foreground-400 text-center py-8">本节课暂未生成闪卡</p>;
  }
  return (
    <div className="space-y-3">
      <p className="text-xs text-foreground-400">共 {cards.length} 张,点击翻面</p>
      {cards.map((c, i) => <Flashcard key={i} card={c} />)}
    </div>
  );
}

function Flashcard({ card }: { card: { front: string; back: string; ts: string } }) {
  const [flipped, setFlipped] = useState(false);
  return (
    <button
      onClick={() => setFlipped((v) => !v)}
      className="w-full text-left bg-background-50 rounded-xl p-5 border border-background-200 hover:border-accent-300 transition-colors cursor-pointer"
    >
      <div className="flex items-center gap-1.5 mb-2">
        <i className={`${flipped ? 'ri-lightbulb-flash-line text-accent-500' : 'ri-question-line text-primary-500'}`}></i>
        <span className="text-[11px] text-foreground-400">{flipped ? '答案' : '问题'}</span>
        {card.ts && <span className="text-[11px] text-foreground-300 font-mono ml-auto">{card.ts}</span>}
      </div>
      <p className="text-sm text-foreground-800 leading-relaxed whitespace-pre-wrap">
        {flipped ? card.back : card.front}
      </p>
      {!flipped && <p className="text-[11px] text-foreground-300 mt-2">点击查看答案</p>}
    </button>
  );
}

function QuizList({ items }: { items: { question: string; options: string[]; answer: number; why: string; ts: string }[] }) {
  if (!items || items.length === 0) {
    return <p className="text-sm text-foreground-400 text-center py-8">本节课暂未生成自测题</p>;
  }
  return (
    <div className="space-y-4">
      <p className="text-xs text-foreground-400">共 {items.length} 题</p>
      {items.map((q, i) => <QuizItemCard key={i} item={q} index={i} />)}
    </div>
  );
}

function QuizItemCard({ item, index }: { item: { question: string; options: string[]; answer: number; why: string; ts: string }; index: number }) {
  const [picked, setPicked] = useState<number | null>(null);
  const answered = picked !== null;
  return (
    <div className="bg-background-50 rounded-xl p-5 border border-background-200">
      <p className="text-sm font-medium text-foreground-800 mb-3 leading-relaxed">
        <span className="text-accent-600 mr-1">{index + 1}.</span>{item.question}
      </p>
      <div className="space-y-2">
        {item.options.map((opt, oi) => {
          const isAnswer = oi === item.answer;
          const isPicked = oi === picked;
          let cls = 'border-background-200 bg-background-50 text-foreground-700';
          if (answered && isAnswer) cls = 'border-green-300 bg-green-50 text-green-700';
          else if (answered && isPicked && !isAnswer) cls = 'border-red-300 bg-red-50 text-red-600';
          return (
            <button
              key={oi}
              disabled={answered}
              onClick={() => setPicked(oi)}
              className={`w-full text-left flex items-start gap-2 px-3 py-2.5 rounded-lg border text-sm transition-colors cursor-pointer disabled:cursor-default ${cls}`}
            >
              <span className="font-medium">{String.fromCharCode(65 + oi)}.</span>
              <span className="flex-1">{opt}</span>
              {answered && isAnswer && <i className="ri-check-line text-green-500"></i>}
              {answered && isPicked && !isAnswer && <i className="ri-close-line text-red-400"></i>}
            </button>
          );
        })}
      </div>
      {answered && item.why && (
        <div className="mt-3 flex items-start gap-1.5 px-3 py-2 bg-background-100 rounded-lg">
          <i className="ri-information-line text-accent-500 mt-0.5"></i>
          <p className="text-xs text-foreground-600 leading-relaxed">{item.why}</p>
        </div>
      )}
    </div>
  );
}
