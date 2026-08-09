import { useCallback, useEffect, useState } from 'react';
import type { EditRecord } from '@/hooks/useRecords';
import { useT } from '@/lib/i18n';

interface EditHistoryPanelProps {
  sessionId: string;
  isOpen: boolean;
  onClose: () => void;
  onLoad: (sid: string) => Promise<{ edits: EditRecord[] }>;
  onRevert: (lineId: number, text: string) => Promise<void>;
}

export default function EditHistoryPanel({
  sessionId,
  isOpen,
  onClose,
  onLoad,
  onRevert,
}: EditHistoryPanelProps) {
  const t = useT();
  const [edits, setEdits] = useState<EditRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!sessionId) {
      setEdits([]);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const j = await onLoad(sessionId);
      setEdits(j.edits);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [sessionId, onLoad]);

  useEffect(() => {
    if (isOpen) void load();
  }, [isOpen, load]);

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose}></div>
      <div className="fixed right-0 top-0 bottom-0 z-50 w-96 max-w-full bg-background-50 border-l border-background-200 flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-background-100">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 flex items-center justify-center">
              <i className="ri-history-line text-foreground-600"></i>
            </div>
            <h3 className="text-sm font-semibold text-foreground-800">{t('编辑历史')}</h3>
            {loading && <i className="ri-loader-4-line animate-spin text-foreground-400"></i>}
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-background-100 text-foreground-500 cursor-pointer"
          >
            <i className="ri-close-line"></i>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {error && <p className="text-xs text-red-600">{error}</p>}

          {!error && edits.length === 0 && !loading && (
            <div className="text-center py-12">
              <i className="ri-edit-line text-foreground-300 text-2xl"></i>
              <p className="text-sm text-foreground-400 mt-3">{t('这节课还没有改动')}</p>
              <p className="text-xs text-foreground-300 mt-1">
                {t('在转写内容里点任意一句就能修改，改动会记在这里')}
              </p>
            </div>
          )}

          {edits.map((e, i) => (
            <div key={i} className="p-3 bg-background-100 rounded-lg space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-foreground-500">
                  {e.by} · {e.at}
                </span>
                <span className="text-xs text-foreground-400 font-mono">{e.ts}</span>
              </div>
              <p className="text-xs text-foreground-400 line-through break-words">{e.before}</p>
              <p className="text-sm text-foreground-700 break-words">{e.after}</p>
              <button
                onClick={async () => {
                  await onRevert(e.line_id, e.before);
                  void load();
                }}
                className="text-xs text-accent-600 hover:text-accent-700 cursor-pointer"
              >
                <i className="ri-arrow-go-back-line mr-1"></i>
                {t('恢复成改之前')}
              </button>
            </div>
          ))}
        </div>

        <div className="px-5 py-3 border-t border-background-100">
          <p className="text-xs text-foreground-400">
            {t('原始转写文件永远不会被覆盖，改动单独记录，随时可以回退。')}
          </p>
        </div>
      </div>
    </>
  );
}
