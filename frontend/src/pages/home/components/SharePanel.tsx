import { useCallback, useEffect, useState } from 'react';
import Modal from '@/components/base/Modal';
import Select from '@/components/base/Select';
import { shareUrl } from '@/hooks/useRecords';
import type { ShareInfo } from '@/hooks/useRecords';
import { useT } from '@/lib/i18n';

interface SharePanelProps {
  isOpen: boolean;
  onClose: () => void;
  sessionId: string;
  sessionTitle: string;
  sessions: { id: string; title: string }[];
  onCreate: (sid: string, allowDownload: boolean) => Promise<ShareInfo>;
  onRevoke: (key: string) => Promise<{ ok: boolean }>;
}

export default function SharePanel({
  isOpen,
  onClose,
  sessionId,
  sessions,
  onCreate,
  onRevoke,
}: SharePanelProps) {
  const t = useT();
  const [share, setShare] = useState<ShareInfo | null>(null);
  const [allowDownload, setAllowDownload] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  // Pick which session to share within the panel (defaults to the one selected outside, or the first if none)
  const [selectedSid, setSelectedSid] = useState('');

  useEffect(() => {
    if (isOpen) {
      setSelectedSid(sessionId || sessions[0]?.id || '');
    } else {
      setShare(null);
      setError('');
      setCopied(false);
    }
  }, [isOpen, sessionId, sessions]);

  const create = useCallback(async () => {
    if (!selectedSid) {
      setError(t('先选一节已录好的课'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      setShare(await onCreate(selectedSid, allowDownload));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [selectedSid, allowDownload, onCreate]);

  const revoke = useCallback(async () => {
    if (!share) return;
    setBusy(true);
    try {
      await onRevoke(share.id);
      setShare(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [share, onRevoke]);

  const copy = useCallback(async () => {
    if (!share) return;
    try {
      await navigator.clipboard.writeText(shareUrl(share.id));
    } catch {
      // Clipboard is unavailable in old browsers or non-secure contexts, so fall back to selecting the text for the user to copy manually
      (document.getElementById('share-url') as HTMLInputElement | null)?.select();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [share]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('共享这节课')} width="max-w-lg">
      <div className="space-y-4">
        <p className="text-xs text-foreground-500 leading-relaxed">
          {t('生成一个')}<b>{t('只读链接')}</b>{t('，同一 WiFi 下的同学无需令牌即可打开查看本节课的文字记录。')}
          {t('他们无法查看其他课程、无法录音、无法修改。')}
        </p>

        {/* Choose which session to share */}
        <div>
          <label className="block text-xs font-medium text-foreground-600 mb-1.5">{t('选择要共享的课')}</label>
          {sessions.length === 0 ? (
            <div className="p-3 bg-background-100 rounded-lg text-xs text-foreground-400">
              {t('暂无可共享的课程。请先录制一节课。')}
            </div>
          ) : (
            <Select
              variant="block"
              value={selectedSid}
              onChange={(v) => { setSelectedSid(v); setShare(null); }}
              disabled={!!share}
              options={sessions.map((s) => ({ value: s.id, label: s.title }))}
            />
          )}
        </div>

        {!share ? (
          <>
            <label className="flex items-center gap-2 text-xs text-foreground-600 cursor-pointer">
              <input
                type="checkbox"
                checked={allowDownload}
                onChange={(e) => setAllowDownload(e.target.checked)}
                className="cursor-pointer"
              />
              {t('允许对方导出文本 / PDF')}
            </label>
            <button
              onClick={create}
              disabled={busy || !selectedSid}
              className="w-full px-4 py-2.5 bg-primary-500 text-background-50 rounded-full text-sm font-semibold hover:bg-primary-600 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {busy ? t('生成中…') : t('生成共享链接')}
            </button>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <input
                id="share-url"
                readOnly
                value={shareUrl(share.id)}
                className="flex-1 text-xs px-3 py-2 rounded-lg border border-background-200 bg-background-100 text-foreground-700"
              />
              <button
                onClick={copy}
                className="px-3 py-2 bg-accent-500 text-background-50 rounded-lg text-xs font-semibold hover:bg-accent-600 cursor-pointer whitespace-nowrap"
              >
                {copied ? t('已复制') : t('复制')}
              </button>
            </div>
            <p className="text-xs text-foreground-400 leading-relaxed">
              {t('创建于 {created}。对方需与您处于同一 WiFi；首次打开时会提示证书不受信任,选择「继续访问」即可。', { created: share.created })}
            </p>
            <button
              onClick={revoke}
              disabled={busy}
              className="w-full px-4 py-2 bg-red-50 text-red-600 rounded-full text-xs font-semibold hover:bg-red-100 transition-colors cursor-pointer disabled:opacity-50"
            >
              {busy ? t('处理中…') : t('停止共享（链接立即失效）')}
            </button>
          </>
        )}

        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    </Modal>
  );
}
