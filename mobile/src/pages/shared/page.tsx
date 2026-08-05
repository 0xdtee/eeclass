import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useSessionDetail, type TranscriptionLine } from '@/hooks/useRecords';

export default function SharedPage() {
  const { sid } = useParams<{ sid: string }>();
  const { detail, loading, error } = useSessionDetail(sid || null);

  if (loading) {
    return (
      <div className="min-h-screen bg-background-100 flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 mx-auto mb-4 flex items-center justify-center">
            <i className="ri-loader-4-line animate-spin text-foreground-400 text-2xl"></i>
          </div>
          <p className="text-sm text-foreground-400">加载中...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background-100 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-4 flex items-center justify-center">
            <i className="ri-error-warning-line text-foreground-300 text-3xl"></i>
          </div>
          <p className="text-sm text-foreground-500">{error}</p>
        </div>
      </div>
    );
  }

  if (!detail) return null;

  return (
    <div className="min-h-screen bg-background-100">
      <nav className="sticky top-0 z-30 bg-background-50/95 backdrop-blur-sm border-b border-background-200">
        <div className="flex items-center h-14 px-6 gap-3">
          <div className="w-8 h-8 flex items-center justify-center bg-accent-100 rounded-lg flex-shrink-0">
            <i className="ri-book-open-line text-accent-600"></i>
          </div>
          <div className="min-w-0">
            <h1 className="text-sm font-semibold text-foreground-900 truncate">{detail.title}</h1>
            <p className="text-xs text-foreground-400">{detail.date} · {detail.duration}</p>
          </div>
          <span className="ml-auto px-2 py-1 bg-secondary-100 text-secondary-700 text-xs rounded-full font-medium">只读共享</span>
        </div>
      </nav>

      <div className="max-w-3xl mx-auto px-6 py-8">
        {detail.summary && (
          <div className="bg-accent-50 border border-accent-200 rounded-xl p-5 mb-6">
            <h3 className="text-xs font-semibold text-accent-700 uppercase tracking-wider mb-2">AI 摘要</h3>
            <p className="text-sm text-foreground-700 leading-relaxed">{detail.summary}</p>
          </div>
        )}

        <div className="bg-background-50 border border-background-200 rounded-xl p-6">
          <h3 className="text-sm font-semibold text-foreground-800 mb-4">课堂转写</h3>
          <div className="space-y-2">
            {detail.transcription.map((line: TranscriptionLine) => (
              <div key={line.line_id} className="flex gap-3 text-sm">
                <span className="text-xs font-mono text-foreground-400 whitespace-nowrap pt-0.5">{line.ts}</span>
                <span className="text-xs font-medium text-foreground-500 whitespace-nowrap pt-0.5">{line.speaker}</span>
                <span className="text-foreground-700">{line.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}