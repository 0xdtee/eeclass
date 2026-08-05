interface SummaryTabProps {
  summary: string;
  keyPoints: string[];
  sessionTitle: string;
  onExportPDF: () => void;
}

export default function SummaryTab({ summary, keyPoints, sessionTitle, onExportPDF }: SummaryTabProps) {
  return (
    <div className="space-y-5">
      <div className="bg-background-50 border border-background-200 rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 flex items-center justify-center">
              <i className="ri-ai-generate text-foreground-500 text-lg"></i>
            </div>
            <h3 className="text-sm font-semibold text-foreground-800">AI 摘要预览</h3>
          </div>
          <button
            onClick={onExportPDF}
            className="flex items-center gap-1.5 px-4 py-2 bg-primary-500 text-background-50 rounded-full text-xs font-semibold hover:bg-primary-600 transition-colors cursor-pointer whitespace-nowrap"
          >
            <i className="ri-file-pdf-2-line text-sm"></i>
            导出PDF
          </button>
        </div>

        {summary ? (
          <div className="space-y-4">
            <div className="p-4 bg-accent-50 rounded-lg border border-accent-100">
              <p className="text-sm leading-relaxed text-foreground-700">{summary}</p>
            </div>

            {keyPoints.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-foreground-500 uppercase tracking-wider mb-3">
                  重点知识点
                </h4>
                <div className="space-y-2">
                  {keyPoints.map((point, idx) => (
                    <div key={idx} className="flex items-start gap-3 p-3 bg-background-100 rounded-lg">
                      <span className="w-6 h-6 flex items-center justify-center flex-shrink-0 bg-primary-500 text-background-50 rounded-full text-xs font-bold">
                        {idx + 1}
                      </span>
                      <p className="text-sm text-foreground-700 pt-0.5">{point}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-16 h-16 flex items-center justify-center mb-4">
              <i className="ri-magic-line text-foreground-300 text-3xl"></i>
            </div>
            <p className="text-sm text-foreground-400">暂无摘要内容</p>
            <p className="text-xs text-foreground-300 mt-1">请在「实时转写」标签页中点击「生成AI摘要」按钮</p>
          </div>
        )}
      </div>
    </div>
  );
}