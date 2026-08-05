import { useState, useCallback, useMemo } from 'react';
import Tabs from '@/components/base/Tabs';
import { useStudy, useAskStream, type Flashcard, type QuizItem } from '@/hooks/useRecords';

interface StudyTabProps {
  sessionId: string;
  onTimeSeek?: (start: number) => void;
}

const studyTabs = [
  { id: 'flashcards', label: '闪卡', icon: 'ri-stack-line' },
  { id: 'quiz', label: '自测题', icon: 'ri-question-answer-line' },
  { id: 'ask', label: '追问', icon: 'ri-chat-3-line' },
];

// ── Ebbinghaus intervals (in days) ──
const EBBINGHAUS = [1, 2, 4, 7, 15];

function getReviewStorageKey(sid: string, cardIdx: number) {
  return `fc_review_${sid}_${cardIdx}`;
}

interface ReviewState {
  level: number; // 0=forgot, 1=seen, 2+=remembered with interval index
  nextReview: number; // timestamp
}

// ── Flashcard view ──
function FlashcardView({ sessionId, onTimeSeek }: { sessionId: string; onTimeSeek?: (start: number) => void }) {
  const { data, loading, error, generate, clear } = useStudy();
  const [currentIdx, setCurrentIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [reviewed, setReviewed] = useState<Set<number>>(new Set());

  const flashcards = data?.flashcards || [];

  const dueCount = useMemo(() => {
    const now = Date.now();
    let count = 0;
    for (let i = 0; i < flashcards.length; i++) {
      const key = getReviewStorageKey(sessionId, i);
      try {
        const raw = localStorage.getItem(key);
        if (raw) {
          const state: ReviewState = JSON.parse(raw);
          if (state.nextReview <= now && state.level > -1) count++;
        } else {
          count++; // never reviewed
        }
      } catch (_e) {
        count++;
      }
    }
    return count;
  }, [flashcards, sessionId]);

  const handleGenerate = () => {
    setCurrentIdx(0);
    setFlipped(false);
    setReviewed(new Set());
    generate(sessionId, 'flashcards');
  };

  const recordReview = (cardIdx: number, level: number) => {
    const key = getReviewStorageKey(sessionId, cardIdx);
    let nextInterval: number;
    if (level === 0) nextInterval = 10 * 60 * 1000; // 10 minutes
    else if (level === 1) nextInterval = 24 * 60 * 60 * 1000; // 1 day
    else {
      const raw = localStorage.getItem(key);
      let prevLevel = 0;
      if (raw) {
        try { prevLevel = JSON.parse(raw).level || 0; } catch { /* ignore */ }
      }
      const idx = Math.min(prevLevel, EBBINGHAUS.length - 1);
      nextInterval = EBBINGHAUS[idx] * 24 * 60 * 60 * 1000;
    }
    const state: ReviewState = { level: level === 0 ? 0 : (level === 1 ? 1 : 2), nextReview: Date.now() + nextInterval };
    localStorage.setItem(key, JSON.stringify(state));
    setReviewed((prev) => new Set(prev).add(cardIdx));
  };

  const handleForgot = () => {
    recordReview(currentIdx, 0);
    goNext();
  };
  const handleSeen = () => {
    recordReview(currentIdx, 1);
    goNext();
  };
  const handleRemembered = () => {
    recordReview(currentIdx, 2);
    goNext();
  };

  const goNext = () => {
    setFlipped(false);
    if (currentIdx < flashcards.length - 1) {
      setCurrentIdx((i) => i + 1);
    }
  };

  if (flashcards.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="w-16 h-16 flex items-center justify-center mb-4">
          <i className="ri-stack-line text-foreground-300 text-3xl"></i>
        </div>
        {loading ? (
          <p className="text-sm text-foreground-400">DeepSeek 思考中…</p>
        ) : (
          <>
            <p className="text-sm text-foreground-400 mb-4">还没有生成闪卡</p>
            {error && <p className="text-xs text-red-500 mb-3">{error}</p>}
            <button
              onClick={handleGenerate}
              className="px-5 py-2.5 bg-accent-500 text-background-50 rounded-full text-sm font-semibold hover:bg-accent-600 transition-colors cursor-pointer whitespace-nowrap"
            >
              生成闪卡
            </button>
          </>
        )}
      </div>
    );
  }

  const card = flashcards[currentIdx];
  const progress = currentIdx + 1;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-foreground-400">
          卡片 {progress} / {flashcards.length}
          {dueCount > 0 && <span className="ml-2 text-accent-600">（今日待复习 {dueCount} 张）</span>}
        </span>
        <button
          onClick={clear}
          className="text-xs text-foreground-400 hover:text-foreground-600 cursor-pointer whitespace-nowrap"
        >
          重新生成
        </button>
      </div>

      {/* Card */}
      <div
        onClick={() => setFlipped(!flipped)}
        className="relative bg-background-50 border border-background-200 rounded-xl p-8 min-h-[200px] flex flex-col items-center justify-center cursor-pointer hover:border-accent-300 transition-all duration-300 select-none"
      >
        <p className="text-base font-medium text-foreground-800 text-center leading-relaxed">
          {flipped ? card.back : card.front}
        </p>
        <p className="text-xs text-foreground-400 mt-4">
          {flipped ? '点击翻回正面' : '点击翻看答案'}
        </p>

        {/* Play icon */}
        {flipped && onTimeSeek && (
          <button
            onClick={(e) => { e.stopPropagation(); onTimeSeek(card.start); }}
            className="absolute bottom-3 right-3 w-8 h-8 flex items-center justify-center rounded-full bg-accent-100 text-accent-600 hover:bg-accent-200 transition-colors cursor-pointer"
            title="听原话"
          >
            <i className="ri-volume-up-line text-sm"></i>
          </button>
        )}
      </div>

      {/* Review buttons */}
      {flipped && (
        <div className="flex items-center gap-3 justify-center">
          <button
            onClick={handleForgot}
            className="px-5 py-2.5 bg-red-100 text-red-700 rounded-full text-sm font-medium hover:bg-red-200 transition-colors cursor-pointer whitespace-nowrap"
          >
            忘了
          </button>
          <button
            onClick={handleSeen}
            className="px-5 py-2.5 bg-secondary-100 text-secondary-700 rounded-full text-sm font-medium hover:bg-secondary-200 transition-colors cursor-pointer whitespace-nowrap"
          >
            有印象
          </button>
          <button
            onClick={handleRemembered}
            className="px-5 py-2.5 bg-accent-100 text-accent-700 rounded-full text-sm font-medium hover:bg-accent-200 transition-colors cursor-pointer whitespace-nowrap"
          >
            记住了
          </button>
        </div>
      )}

      {/* Progress dots */}
      <div className="flex items-center justify-center gap-1.5">
        {flashcards.map((_, idx) => (
          <span
            key={idx}
            className={`w-2 h-2 rounded-full transition-colors ${
              idx === currentIdx
                ? 'bg-accent-500'
                : reviewed.has(idx)
                  ? 'bg-accent-200'
                  : 'bg-background-200'
            }`}
          ></span>
        ))}
      </div>
    </div>
  );
}

// ── Quiz view ──
function QuizView({ sessionId, onTimeSeek }: { sessionId: string; onTimeSeek?: (start: number) => void }) {
  const { data, loading, error, generate, clear } = useStudy();
  const [currentIdx, setCurrentIdx] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [answers, setAnswers] = useState<(number | null)[]>([]);
  const [showWrongOnly, setShowWrongOnly] = useState(false);
  const [finished, setFinished] = useState(false);

  const quiz = data?.quiz || [];

  const handleGenerate = () => {
    setCurrentIdx(0);
    setSelected(null);
    setAnswers([]);
    setShowWrongOnly(false);
    setFinished(false);
    generate(sessionId, 'quiz');
  };

  const handleSelect = (optIdx: number) => {
    if (selected !== null) return; // already answered
    setSelected(optIdx);
    const newAnswers = [...answers];
    newAnswers[currentIdx] = optIdx;
    setAnswers(newAnswers);
  };

  const handleNext = () => {
    if (currentIdx < quiz.length - 1) {
      setCurrentIdx((i) => i + 1);
      setSelected(answers[currentIdx + 1] ?? null);
    } else {
      setFinished(true);
    }
  };

  const score = answers.filter((a, i) => a === quiz[i]?.answer).length;
  const wrongIndices = quiz
    .map((q, i) => (answers[i] !== null && answers[i] !== q.answer ? i : -1))
    .filter((i) => i >= 0);

  const displayQuiz = showWrongOnly
    ? quiz.filter((_, i) => wrongIndices.includes(i))
    : quiz;

  if (finished && !showWrongOnly) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="w-16 h-16 flex items-center justify-center mb-4">
          <i className={`${score === quiz.length ? 'ri-trophy-line text-yellow-500' : 'ri-medal-line text-foreground-300'} text-3xl`}></i>
        </div>
        <p className="text-lg font-semibold text-foreground-800 mb-2">
          得分：{score} / {quiz.length}
        </p>
        <p className="text-sm text-foreground-400 mb-6">
          {score === quiz.length ? '全部正确，太棒了！' : `${wrongIndices.length} 道错题`}
        </p>
        <div className="flex items-center gap-3">
          {wrongIndices.length > 0 && (
            <button
              onClick={() => { setShowWrongOnly(true); setFinished(false); setCurrentIdx(0); }}
              className="px-5 py-2.5 bg-accent-100 text-accent-700 rounded-full text-sm font-medium hover:bg-accent-200 transition-colors cursor-pointer whitespace-nowrap"
            >
              只看错题再做一遍
            </button>
          )}
          <button
            onClick={handleGenerate}
            className="px-5 py-2.5 bg-accent-500 text-background-50 rounded-full text-sm font-semibold hover:bg-accent-600 transition-colors cursor-pointer whitespace-nowrap"
          >
            重新生成
          </button>
        </div>
      </div>
    );
  }

  if (quiz.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="w-16 h-16 flex items-center justify-center mb-4">
          <i className="ri-question-answer-line text-foreground-300 text-3xl"></i>
        </div>
        {loading ? (
          <p className="text-sm text-foreground-400">DeepSeek 思考中…</p>
        ) : (
          <>
            <p className="text-sm text-foreground-400 mb-4">还没有生成自测题</p>
            {error && <p className="text-xs text-red-500 mb-3">{error}</p>}
            <button
              onClick={handleGenerate}
              className="px-5 py-2.5 bg-accent-500 text-background-50 rounded-full text-sm font-semibold hover:bg-accent-600 transition-colors cursor-pointer whitespace-nowrap"
            >
              生成自测题
            </button>
          </>
        )}
      </div>
    );
  }

  const item = displayQuiz[currentIdx]!;
  const isCorrect = selected !== null && selected === item.answer;
  const isWrong = selected !== null && selected !== item.answer;
  const realIdx = showWrongOnly ? wrongIndices[currentIdx] : currentIdx;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-foreground-400">
          第 {currentIdx + 1} / {displayQuiz.length} 题
          {showWrongOnly && <span className="ml-2 text-red-500">（错题重做）</span>}
        </span>
      </div>

      <div className="bg-background-50 border border-background-200 rounded-xl p-6">
        <p className="text-sm font-medium text-foreground-800 mb-5">{item.question}</p>
        <div className="space-y-2">
          {item.options.map((opt, oIdx) => {
            let bg = 'bg-background-100 hover:bg-background-200';
            if (selected !== null) {
              if (oIdx === item.answer) bg = 'bg-green-100 border border-green-300';
              else if (oIdx === selected && isWrong) bg = 'bg-red-100 border border-red-300';
              else bg = 'bg-background-50';
            }
            return (
              <button
                key={oIdx}
                onClick={() => handleSelect(oIdx)}
                disabled={selected !== null}
                className={`w-full text-left px-4 py-3 rounded-lg text-sm transition-colors cursor-pointer whitespace-normal ${bg} ${
                  selected !== null ? 'cursor-default' : ''
                }`}
              >
                <span className="font-medium mr-2">{String.fromCharCode(65 + oIdx)}.</span>
                {opt}
              </button>
            );
          })}
        </div>

        {/* Feedback */}
        {isCorrect && (
          <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-lg">
            <p className="text-sm text-green-700 font-medium flex items-center gap-1.5">
              <div className="w-4 h-4 flex items-center justify-center">
                <i className="ri-check-line text-green-600"></i>
              </div>
              回答正确！
            </p>
          </div>
        )}
        {isWrong && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm text-red-700 font-medium flex items-center gap-1.5 mb-1">
              <div className="w-4 h-4 flex items-center justify-center">
                <i className="ri-close-line text-red-600"></i>
              </div>
              回答错误
            </p>
            <p className="text-xs text-foreground-600">{item.why}</p>
          </div>
        )}

        {/* Listen */}
        {selected !== null && onTimeSeek && (
          <button
            onClick={() => onTimeSeek(item.start)}
            className="mt-3 flex items-center gap-1.5 text-xs text-accent-600 hover:text-accent-800 cursor-pointer whitespace-nowrap"
          >
            <div className="w-4 h-4 flex items-center justify-center">
              <i className="ri-volume-up-line"></i>
            </div>
            听老师原话
          </button>
        )}
      </div>

      {selected !== null && (
        <div className="flex justify-center">
          <button
            onClick={handleNext}
            className="px-6 py-2.5 bg-accent-500 text-background-50 rounded-full text-sm font-semibold hover:bg-accent-600 transition-colors cursor-pointer whitespace-nowrap"
          >
            {currentIdx < displayQuiz.length - 1 ? '下一题' : '查看结果'}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Ask (chat) view ──
function AskView({ sessionId, onTimeSeek }: { sessionId: string; onTimeSeek?: (start: number) => void }) {
  const { answer, cites, loading, error, ask, clear } = useAskStream();
  const [question, setQuestion] = useState('');
  const [history, setHistory] = useState<{ role: string; content: string }[]>([]);

  const handleAsk = () => {
    if (!question.trim() || loading) return;
    const q = question.trim();
    setQuestion('');
    const newHistory = [...history, { role: 'user', content: q }];
    setHistory(newHistory);
    ask(sessionId, q, history);
  };

  return (
    <div className="space-y-4">
      {/* Chat display */}
      {(history.length > 0 || loading || answer) && (
        <div className="bg-background-50 border border-background-200 rounded-xl p-5 space-y-4 max-h-[400px] overflow-y-auto">
          {history.map((msg, idx) => (
            <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {msg.role === 'assistant' ? (
                <div className="max-w-[85%] bg-secondary-50 border border-secondary-200 rounded-xl px-4 py-3">
                  <p className="text-sm text-foreground-700">{msg.content}</p>
                </div>
              ) : (
                <div className="max-w-[85%] bg-accent-100 rounded-xl px-4 py-3">
                  <p className="text-sm text-foreground-700">{msg.content}</p>
                </div>
              )}
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="max-w-[85%] bg-secondary-50 border border-secondary-200 rounded-xl px-4 py-3">
                <p className="text-sm text-foreground-400 italic">DeepSeek 思考中…</p>
              </div>
            </div>
          )}

          {error && (
            <p className="text-sm text-red-500 text-center">{error}</p>
          )}
        </div>
      )}

      {/* Citations */}
      {cites.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-foreground-500">引用原话</p>
          {cites.map((c, i) => (
            <button
              key={i}
              onClick={() => onTimeSeek?.(c.start)}
              className="w-full text-left flex items-start gap-3 p-3 bg-accent-50 border border-accent-100 rounded-lg hover:bg-accent-100 transition-colors cursor-pointer"
            >
              <span className="text-xs font-mono text-accent-600 flex-shrink-0">{c.ts}</span>
              <span className="text-sm text-foreground-600 leading-relaxed line-clamp-2">{c.text}</span>
              <div className="w-4 h-4 flex items-center justify-center flex-shrink-0 ml-auto">
                <i className="ri-volume-up-line text-accent-500 text-xs"></i>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleAsk(); }}
          placeholder="针对这节课提问..."
          className="flex-1 px-4 py-2.5 bg-background-50 border border-background-200 rounded-full text-sm text-foreground-800 placeholder:text-foreground-400 outline-none focus:border-accent-300 transition-colors"
        />
        <button
          onClick={handleAsk}
          disabled={loading || !question.trim()}
          className="w-10 h-10 flex items-center justify-center rounded-full bg-accent-500 text-background-50 hover:bg-accent-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer flex-shrink-0"
        >
          <i className="ri-send-plane-fill"></i>
        </button>
      </div>
    </div>
  );
}

// ── Main StudyTab ──
export default function StudyTab({ sessionId, onTimeSeek }: StudyTabProps) {
  const [mode, setMode] = useState('flashcards');

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-center">
        <Tabs tabs={studyTabs} activeTab={mode} onTabChange={setMode} />
      </div>

      <div className="bg-background-50 border border-background-200 rounded-xl p-6">
        {mode === 'flashcards' && <FlashcardView sessionId={sessionId} onTimeSeek={onTimeSeek} />}
        {mode === 'quiz' && <QuizView sessionId={sessionId} onTimeSeek={onTimeSeek} />}
        {mode === 'ask' && <AskView sessionId={sessionId} onTimeSeek={onTimeSeek} />}
      </div>
    </div>
  );
}