/**
 * Glossary and correction table for a course.
 * Glossary = hotwords used during recognition (calculus and physics terms are entirely different and shouldn't share one list).
 * Correction table = fixed errors like 「格林公司 -> 格林公式」, replaced immediately after recognition.
 */
import { useEffect, useState } from 'react';
import Modal from '@/components/base/Modal';
import type { Correction, Course } from '@/hooks/useLibrary';
import { useT } from '@/lib/i18n';

interface CoursePanelProps {
  course: Course | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (id: string, patch: { name?: string; hotwords?: string; corrections?: Correction[] }) => Promise<Course>;
}

export default function CoursePanel({ course, isOpen, onClose, onSave }: CoursePanelProps) {
  const t = useT();
  const [name, setName] = useState('');
  const [hotwords, setHotwords] = useState('');
  const [rules, setRules] = useState<Correction[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!course) return;
    setName(course.name);
    setHotwords(course.hotwords || '');
    setRules(course.corrections || []);
    setError('');
  }, [course]);

  const save = async () => {
    if (!course) return;
    setBusy(true);
    setError('');
    try {
      await onSave(course.id, {
        name: name.trim() || course.name,
        hotwords: hotwords.trim(),
        corrections: rules.filter((r) => r.from.trim()),
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('课程设置')} width="max-w-2xl">
      <div className="space-y-5">
        <label className="block">
          <span className="text-xs font-semibold text-foreground-600">{t('课程名称')}</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1.5 w-full text-sm px-3 py-2 rounded-lg border border-background-200 bg-background-50"
          />
        </label>

        <label className="block">
          <span className="text-xs font-semibold text-foreground-600">{t('专业术语表')}</span>
          <p className="text-xs text-foreground-400 mt-1">
            {t('空格分隔。识别时会优先往这些词上靠——「格林公式」「傅里叶」这种词不加进来很容易听错。')}
          </p>
          <textarea
            value={hotwords}
            onChange={(e) => setHotwords(e.target.value)}
            rows={3}
            placeholder={t('格林公式 高斯公式 散度 旋度 单连通区域')}
            className="mt-1.5 w-full text-sm px-3 py-2 rounded-lg border border-background-200 bg-background-50"
          />
        </label>

        <div>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-foreground-600">{t('常见错字纠正')}</span>
            <button
              onClick={() => setRules((r) => [...r, { from: '', to: '', enabled: true }])}
              className="text-xs text-accent-600 hover:text-accent-700 cursor-pointer"
            >
              <i className="ri-add-line mr-0.5"></i>{t('加一条')}
            </button>
          </div>
          <p className="text-xs text-foreground-400 mt-1">{t('识别完立刻替换，写进文档和记录的都是纠正后的。')}</p>

          <div className="mt-2 space-y-2">
            {rules.length === 0 && (
              <p className="text-xs text-foreground-300 py-3 text-center">{t('还没有纠错规则')}</p>
            )}
            {rules.map((r, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  value={r.from}
                  onChange={(e) =>
                    setRules((rs) => rs.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)))
                  }
                  placeholder={t('听成了')}
                  className="flex-1 text-sm px-2.5 py-1.5 rounded border border-background-200 bg-background-50"
                />
                <i className="ri-arrow-right-line text-foreground-400"></i>
                <input
                  value={r.to}
                  onChange={(e) =>
                    setRules((rs) => rs.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)))
                  }
                  placeholder={t('应该是')}
                  className="flex-1 text-sm px-2.5 py-1.5 rounded border border-background-200 bg-background-50"
                />
                <label className="flex items-center gap-1 text-xs text-foreground-500 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={r.enabled}
                    onChange={(e) =>
                      setRules((rs) => rs.map((x, j) => (j === i ? { ...x, enabled: e.target.checked } : x)))
                    }
                    className="cursor-pointer"
                  />
                  {t('启用')}
                </label>
                <button
                  onClick={() => setRules((rs) => rs.filter((_, j) => j !== i))}
                  className="w-7 h-7 flex items-center justify-center rounded hover:bg-background-100 text-foreground-400 cursor-pointer"
                >
                  <i className="ri-delete-bin-line"></i>
                </button>
              </div>
            ))}
          </div>
        </div>

        {error && <p className="text-xs text-red-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-background-100 text-foreground-600 rounded-full text-sm cursor-pointer"
          >
            {t('取消')}
          </button>
          <button
            onClick={() => void save()}
            disabled={busy}
            className="px-5 py-2 bg-primary-500 text-background-50 rounded-full text-sm font-semibold cursor-pointer disabled:opacity-50"
          >
            {busy ? t('保存中…') : t('保存')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
