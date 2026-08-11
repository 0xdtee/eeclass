import { useState, useEffect, useCallback } from 'react';
import BackButton from '@/components/feature/BackButton';
import { apiFetch } from '@/lib/api';

interface Voiceprint { id: string; name: string }

export default function VoiceprintsPage() {
  const [items, setItems] = useState<Voiceprint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    apiFetch<{ voiceprints: Voiceprint[] }>('/api/voiceprints')
      .then((d) => setItems(d.voiceprints || []))
      .catch((e) => setError(e instanceof Error ? e.message : '加载失败'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const remove = async (v: Voiceprint) => {
    if (!window.confirm(`删除声纹「${v.name}」？`)) return;
    setBusyId(v.id);
    try {
      await apiFetch(`/api/voiceprints/${encodeURIComponent(v.id)}`, { method: 'DELETE' });
      setItems((prev) => prev.filter((x) => x.id !== v.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除失败');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="min-h-full bg-background-50">
      {/* Header */}
      <div className="px-5 md:px-8 pt-6 md:pt-8 pb-4">
        <BackButton />
        <h1 className="text-lg md:text-2xl font-bold text-foreground-900">声纹库</h1>
        <p className="text-xs md:text-sm text-foreground-400 mt-1">已入库的说话人声纹，仅管理员可管理</p>
      </div>

      <div className="px-5 md:px-8 pb-8 max-w-5xl">
        {loading && (
          <div className="flex items-center justify-center py-16">
            <i className="ri-loader-4-line animate-spin text-accent-500 text-2xl"></i>
          </div>
        )}

        {!loading && error && (
          <div className="flex flex-col items-center py-16 text-center">
            <div className="w-12 h-12 flex items-center justify-center bg-red-50 rounded-xl mb-2">
              <i className="ri-error-warning-line text-red-400 text-xl"></i>
            </div>
            <p className="text-sm text-red-500">{error}</p>
          </div>
        )}

        {!loading && !error && items.length === 0 && (
          <div className="flex flex-col items-center py-16 text-center">
            <div className="w-16 h-16 flex items-center justify-center bg-primary-100 rounded-2xl mb-4">
              <i className="ri-fingerprint-line text-primary-600 text-2xl"></i>
            </div>
            <p className="text-sm text-foreground-400 max-w-xs leading-relaxed">
              声纹库暂为空。在课时详情中为说话人命名后，其声纹会自动入库。
            </p>
          </div>
        )}

        <div className="space-y-2">
          {items.map((v) => (
            <div key={v.id} className="bg-background-50 rounded-xl border border-background-200 flex items-center gap-3 px-4 py-3.5">
              <div className="w-9 h-9 flex items-center justify-center bg-primary-100 rounded-full flex-shrink-0">
                <i className="ri-user-voice-line text-primary-600"></i>
              </div>
              <span className="flex-1 text-sm font-medium text-foreground-800 truncate">{v.name}</span>
              <button
                onClick={() => remove(v)}
                disabled={busyId === v.id}
                className="w-8 h-8 flex items-center justify-center rounded-lg text-foreground-400 hover:text-red-500 hover:bg-red-50 transition-colors cursor-pointer disabled:opacity-50"
              >
                {busyId === v.id
                  ? <i className="ri-loader-4-line animate-spin"></i>
                  : <i className="ri-delete-bin-line"></i>}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
