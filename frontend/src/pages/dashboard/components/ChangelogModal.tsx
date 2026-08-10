import Modal from '@/components/base/Modal';
import { useT } from '@/lib/i18n';
import { CHANGELOG } from '@/lib/changelog';

interface ChangelogModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/** Home-page changelog: recent user-facing updates, newest first. Data lives in @/lib/changelog. */
export default function ChangelogModal({ isOpen, onClose }: ChangelogModalProps) {
  const t = useT();
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('更新日志')} width="max-w-lg">
      <div className="overflow-y-auto space-y-6" style={{ maxHeight: '70vh' }}>
        {CHANGELOG.map((rel, ri) => (
          <div key={rel.date}>
            <div className="flex items-center gap-2 mb-2.5">
              <span className="px-2 py-0.5 bg-accent-100 text-accent-700 rounded-full text-xs font-semibold">{rel.date}</span>
              {ri === 0 && (
                <span className="px-2 py-0.5 bg-primary-100 text-primary-700 rounded-full text-[11px] font-medium">{t('最新')}</span>
              )}
            </div>
            <ul className="space-y-1.5">
              {rel.items.map((it, i) => (
                <li key={i} className="flex gap-2 text-sm text-foreground-700 leading-relaxed">
                  <i className="ri-checkbox-circle-line text-accent-500 mt-0.5 flex-shrink-0"></i>
                  <span>{t(it)}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Modal>
  );
}
