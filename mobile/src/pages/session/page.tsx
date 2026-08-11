import { useParams, useNavigate } from 'react-router-dom';
import BackButton from '@/components/feature/BackButton';
import { useSessionDetail } from '@/hooks/useRecords';

export default function SessionDetailPage() {
  const { sid } = useParams<{ sid: string }>();
  const navigate = useNavigate();
  const { detail, loading, error } = useSessionDetail(sid || null);

  const lines = detail?.transcription || [];
  const hasSummary = !!(detail && (detail.summary || (detail.key_points && detail.key_points.length)));

  return (
    <div className="min-h-full bg-background-50">
      {/* Header */}
      <div className="px-5 md:px-8 pt-6 md:pt-8 pb-4">
        <BackButton />
        <h1 className="text-lg md:text-2xl font-bold text-foreground-900 truncate">{detail?.title || '课时详情'}</h1>
        <div className="flex items-center gap-3 mt-1.5">
          {detail?.date && (
            <span className="text-xs text-foreground-400 flex items-center gap-1">
              <i className="ri-calendar-line"></i>{detail.date}
            </span>
          )}
          {lines.length > 0 && (
            <span className="text-xs text-foreground-400 flex items-center gap-1">
              <i className="ri-chat-1-line"></i>{lines.length} 句
            </span>
          )}
        </div>

        {/* Actions */}
        {sid && (
          <div className="flex items-center gap-2 mt-4">
            <button
              onClick={() => navigate(`/summary/${encodeURIComponent(sid)}`)}
              className="flex-1 md:flex-none md:px-5 py-2.5 bg-accent-500 text-background-50 rounded-lg text-xs md:text-sm font-medium cursor-pointer hover:bg-accent-600 transition-colors whitespace-nowrap flex items-center justify-center gap-1.5"
            >
              <i className="ri-magic-line"></i>
              {hasSummary ? '查看 AI 摘要' : '生成 AI 摘要'}
            </button>
            <button
              onClick={() => navigate(`/study?sid=${encodeURIComponent(sid)}`)}
              className="flex-1 md:flex-none md:px-5 py-2.5 bg-background-100 text-foreground-600 rounded-lg text-xs md:text-sm font-medium cursor-pointer hover:bg-background-200 transition-colors whitespace-nowrap flex items-center justify-center gap-1.5"
            >
              <i className="ri-brain-line"></i>
              复习
            </button>
          </div>
        )}
      </div>

      <div className="px-5 md:px-8 pb-8 max-w-5xl">
        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-16">
            <i className="ri-loader-4-line animate-spin text-accent-500 text-2xl"></i>
          </div>
        )}

        {/* Error */}
        {!loading && error && (
          <div className="flex flex-col items-center py-16 text-center">
            <div className="w-12 h-12 flex items-center justify-center bg-red-50 rounded-xl mb-2">
              <i className="ri-error-warning-line text-red-400 text-xl"></i>
            </div>
            <p className="text-sm text-red-500">{error}</p>
            <p className="text-xs text-foreground-400 mt-1">请检查后端服务是否运行</p>
          </div>
        )}

        {/* Empty */}
        {!loading && !error && lines.length === 0 && (
          <div className="flex flex-col items-center py-16 text-center">
            <div className="w-12 h-12 flex items-center justify-center bg-background-100 rounded-xl mb-3">
              <i className="ri-file-text-line text-foreground-300 text-xl"></i>
            </div>
            <p className="text-sm text-foreground-400">本节课暂无转写内容</p>
          </div>
        )}

        {/* Summary preview */}
        {!loading && !error && detail?.summary && (
          <div
            onClick={() => sid && navigate(`/summary/${encodeURIComponent(sid)}`)}
            className="mb-4 bg-accent-50/60 rounded-xl p-4 border border-accent-200 cursor-pointer hover:border-accent-300 transition-colors"
          >
            <div className="flex items-center gap-2 mb-2">
              <i className="ri-magic-line text-accent-600"></i>
              <span className="text-xs font-semibold text-accent-700">AI 摘要</span>
              <i className="ri-arrow-right-s-line text-accent-500 ml-auto"></i>
            </div>
            <p className="text-xs text-foreground-600 leading-relaxed line-clamp-3">{detail.summary}</p>
          </div>
        )}

        {/* Transcript */}
        {lines.length > 0 && (
          <div className="bg-background-50 rounded-xl p-4 md:p-5 border border-background-200">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 flex items-center justify-center bg-accent-100 rounded-lg">
                <i className="ri-file-text-line text-accent-600"></i>
              </div>
              <h3 className="text-sm font-semibold text-foreground-800">课堂转写</h3>
            </div>
            <div className="space-y-1">
              {lines.map((line) => (
                <div key={line.line_id} className="flex gap-3 p-2 rounded-lg hover:bg-background-100 transition-colors">
                  <span className="text-[11px] text-foreground-400 font-mono whitespace-nowrap mt-0.5">{line.ts}</span>
                  <div className="min-w-0">
                    {line.speaker && <span className="text-xs font-medium text-accent-600 mr-2">{line.speaker}</span>}
                    <span className="text-sm text-foreground-700 leading-relaxed">{line.text}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
