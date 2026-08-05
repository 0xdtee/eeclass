import { editHistory } from '@/mocks/courseData';

interface EditHistoryPanelProps {
  sessionId: string;
  isOpen: boolean;
  onClose: () => void;
}

export default function EditHistoryPanel({ sessionId, isOpen, onClose }: EditHistoryPanelProps) {
  const sessionHistory = editHistory.filter((eh) => eh.sessionId === sessionId);

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose}></div>
      <div className="fixed right-0 top-0 bottom-0 z-50 w-80 bg-background-50 border-l border-background-200 flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-background-100">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 flex items-center justify-center">
              <i className="ri-history-line text-foreground-600"></i>
            </div>
            <h3 className="text-sm font-semibold text-foreground-800">编辑历史</h3>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-background-100 text-foreground-400 hover:text-foreground-600 transition-colors cursor-pointer"
          >
            <i className="ri-close-line"></i>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {sessionHistory.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="w-12 h-12 flex items-center justify-center mb-3">
                <i className="ri-inbox-line text-foreground-300 text-2xl"></i>
              </div>
              <p className="text-sm text-foreground-400">暂无编辑记录</p>
            </div>
          ) : (
            <div className="relative pl-6 border-l-2 border-background-200 space-y-5">
              {sessionHistory.map((entry) => (
                <div key={entry.id} className="relative">
                  <span className="absolute -left-[25px] top-1 w-2.5 h-2.5 rounded-full bg-accent-500 border-2 border-background-50"></span>
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-semibold text-accent-700">{entry.action}</span>
                    </div>
                    <p className="text-xs text-foreground-500 leading-relaxed">{entry.detail}</p>
                    <div className="flex items-center gap-2 mt-2 text-xs text-foreground-300">
                      <span>{entry.editor}</span>
                      <span>·</span>
                      <span>{entry.time}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}