import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import BackButton from '@/components/feature/BackButton';
import { useSessionDetail } from '@/hooks/useRecords';
import { apiFetch, getServerUrl, getToken } from '@/lib/api';

interface AiSummary {
  summary: string;
  key_points?: string[];
  formulas?: string[];
  exam_hints?: string[];
  questions?: string[];
  corrections?: string[];
}

function shotUrl(url: string): string {
  const token = getToken();
  return `${getServerUrl()}${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
}

export default function SummaryPage() {
  const { sid } = useParams<{ sid: string }>();
  const navigate = useNavigate();
  const { detail, loading, error, refresh } = useSessionDetail(sid || null);

  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState('');

  const handleGenerate = async () => {
    if (!sid || !detail) return;
    if (!detail.transcription.length) {
      setGenError('这节课还没有转写内容，无法生成摘要');
      return;
    }
    setGenerating(true);
    setGenError('');
    try {
      // 服务端调 DeepSeek(API key 只在服务端)。传逐句转写 + sid(让后端一并纳入板书)。
      const ai = await apiFetch<AiSummary>('/api/summarize', {
        method: 'POST',
        body: JSON.stringify({
          sid,
          title: detail.title,
          lines: detail.transcription.map((l) => ({ ts: l.ts, speaker: l.speaker, text: l.text })),
        }),
      });
      const keyPoints = [
        ...(ai.key_points ?? []),
        ...(ai.exam_hints ?? []).map((x) => `【老师说要考】${x}`),
        ...(ai.formulas ?? []).map((x) => `【公式/定理】${x}`),
        ...(ai.questions ?? []).map((x) => `【课堂问答】${x}`),
      ];
      // 持久化,下次进来直接显示、并让首页统计到"已出摘要"
      try {
        await apiFetch(`/api/transcript/${encodeURIComponent(sid)}/summary`, {
          method: 'POST',
          body: JSON.stringify({ summary: ai.summary, key_points: keyPoints }),
        });
      } catch { /* 保存失败不影响本次查看 */ }
      await refresh();
    } catch (e) {
      setGenError(e instanceof Error ? e.message : '生成失败');
    } finally {
      setGenerating(false);
    }
  };

  const hasSummary = !!(detail && (detail.summary || (detail.key_points && detail.key_points.length)));

  return (
    <div className="min-h-full bg-background-50">
      {/* Header */}
      <div className="px-5 md:px-8 pt-6 md:pt-8 pb-4">
        <BackButton />
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 flex items-center justify-center bg-accent-100 rounded-xl flex-shrink-0">
            <i className="ri-magic-line text-accent-600 text-lg"></i>
          </div>
          <div className="min-w-0">
            <h1 className="text-lg md:text-2xl font-bold text-foreground-900 truncate">AI 摘要</h1>
            <p className="text-xs md:text-sm text-foreground-400 truncate">{detail?.title || sid}</p>
          </div>
        </div>
      </div>

      <div className="px-5 md:px-8 pb-24 md:pb-8 max-w-5xl">
        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-16">
            <i className="ri-loader-4-line animate-spin text-accent-500 text-2xl"></i>
          </div>
        )}

        {/* Load error */}
        {!loading && error && (
          <div className="flex flex-col items-center py-16 text-center">
            <div className="w-12 h-12 flex items-center justify-center bg-red-50 rounded-xl mb-2">
              <i className="ri-error-warning-line text-red-400 text-xl"></i>
            </div>
            <p className="text-sm text-red-500">{error}</p>
          </div>
        )}

        {!loading && !error && detail && (
          <>
            {hasSummary ? (
              <div className="space-y-4">
                {/* 摘要正文 */}
                {detail.summary && (
                  <div className="bg-background-50 rounded-xl p-5 border border-background-200">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-8 h-8 flex items-center justify-center bg-accent-100 rounded-lg">
                        <i className="ri-file-list-3-line text-accent-600"></i>
                      </div>
                      <h3 className="text-sm font-semibold text-foreground-800">课堂纪要</h3>
                    </div>
                    <p className="text-sm text-foreground-700 leading-relaxed whitespace-pre-wrap">
                      {detail.summary}
                    </p>
                  </div>
                )}

                {/* 重点 */}
                {detail.key_points && detail.key_points.length > 0 && (
                  <div className="bg-background-50 rounded-xl p-5 border border-background-200">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-8 h-8 flex items-center justify-center bg-primary-100 rounded-lg">
                        <i className="ri-lightbulb-line text-primary-600"></i>
                      </div>
                      <h3 className="text-sm font-semibold text-foreground-800">重点提炼</h3>
                    </div>
                    <ul className="space-y-2">
                      {detail.key_points.map((p, i) => (
                        <li key={i} className="flex gap-2 text-sm text-foreground-700 leading-relaxed">
                          <i className="ri-checkbox-circle-line text-accent-500 mt-0.5 flex-shrink-0"></i>
                          <span>{p}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* 重新生成 */}
                <button
                  onClick={handleGenerate}
                  disabled={generating}
                  className="w-full py-3 bg-background-100 text-foreground-600 rounded-xl text-sm font-medium hover:bg-background-200 transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap"
                >
                  {generating ? (
                    <span className="flex items-center justify-center gap-2">
                      <i className="ri-loader-4-line animate-spin"></i>
                      正在重新生成…
                    </span>
                  ) : (
                    <span className="flex items-center justify-center gap-2">
                      <i className="ri-refresh-line"></i>
                      重新生成摘要
                    </span>
                  )}
                </button>
              </div>
            ) : (
              /* 还没有摘要 */
              <div className="flex flex-col items-center py-10 text-center">
                <div className="w-16 h-16 flex items-center justify-center bg-accent-100 rounded-2xl mb-4">
                  <i className="ri-magic-line text-accent-600 text-2xl"></i>
                </div>
                <h2 className="text-base font-semibold text-foreground-800 mb-1">还没有生成摘要</h2>
                <p className="text-sm text-foreground-400 max-w-xs mb-6 leading-relaxed">
                  基于本节课 {detail.transcription.length} 句转写，由 AI 整理出课堂纪要与重点。
                </p>
                <button
                  onClick={handleGenerate}
                  disabled={generating || detail.transcription.length === 0}
                  className="px-6 py-3 bg-accent-500 text-background-50 rounded-xl text-sm font-semibold hover:bg-accent-600 transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap"
                >
                  {generating ? (
                    <span className="flex items-center justify-center gap-2">
                      <i className="ri-loader-4-line animate-spin"></i>
                      正在生成…
                    </span>
                  ) : (
                    <span className="flex items-center justify-center gap-2">
                      <i className="ri-sparkling-line"></i>
                      生成 AI 摘要
                    </span>
                  )}
                </button>
              </div>
            )}

            {genError && (
              <div className="mt-4 flex items-start gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-xl">
                <i className="ri-error-warning-line text-red-400 mt-0.5"></i>
                <p className="text-xs text-red-600">{genError}</p>
              </div>
            )}

            {/* 板书 */}
            {detail.shots && detail.shots.length > 0 && (
              <div className="mt-6">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-8 h-8 flex items-center justify-center bg-secondary-100 rounded-lg">
                    <i className="ri-image-line text-secondary-600"></i>
                  </div>
                  <h3 className="text-sm font-semibold text-foreground-800">板书 · {detail.shots.length} 张</h3>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {detail.shots.map((s) => (
                    <div key={s.id} className="bg-background-50 rounded-xl border border-background-200 overflow-hidden">
                      <img
                        src={shotUrl(s.url)}
                        alt={s.note || '板书'}
                        loading="lazy"
                        className="w-full h-32 object-cover"
                      />
                      <div className="px-2 py-1.5 flex items-center justify-between">
                        <span className="text-[11px] text-foreground-400 font-mono">{s.ts}</span>
                        {s.note && <span className="text-[11px] text-foreground-500 truncate ml-1">{s.note}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 去看全文 */}
            {sid && (
              <button
                onClick={() => navigate(`/session/${encodeURIComponent(sid)}`)}
                className="mt-6 w-full flex items-center justify-center gap-2 py-3 bg-background-100 text-foreground-600 rounded-xl text-sm font-medium hover:bg-background-200 transition-colors cursor-pointer"
              >
                <i className="ri-file-text-line"></i>
                查看课堂转写全文
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
