import { useState, useCallback } from 'react';
import Modal from '@/components/base/Modal';
import { type Course, type CorrectionRule } from '@/hooks/useRecords';

interface GlossaryModalProps {
  isOpen: boolean;
  onClose: () => void;
  course: Course;
  onSave: (patch: { hotwords?: string; corrections?: CorrectionRule[] }) => void;
}

export default function GlossaryModal({ isOpen, onClose, course, onSave }: GlossaryModalProps) {
  const [hotwords, setHotwords] = useState(course.hotwords || '');
  const [corrections, setCorrections] = useState<CorrectionRule[]>([...course.corrections || []]);

  const addRow = () => {
    setCorrections((prev) => [...prev, { from: '', to: '', enabled: true }]);
  };

  const removeRow = (idx: number) => {
    setCorrections((prev) => prev.filter((_, i) => i !== idx));
  };

  const updateRow = (idx: number, field: 'from' | 'to' | 'enabled', value: string | boolean) => {
    setCorrections((prev) =>
      prev.map((r, i) => (i === idx ? { ...r, [field]: value } : r))
    );
  };

  const handleSave = () => {
    onSave({
      hotwords: hotwords.trim(),
      corrections,
    });
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`${course.name} · 术语表`} width="max-w-lg">
      <div className="space-y-5">
        {/* Hotwords */}
        <div>
          <label className="text-xs font-semibold text-foreground-500 uppercase tracking-wider mb-2 block">专业术语（空格分隔）</label>
          <textarea
            value={hotwords}
            onChange={(e) => setHotwords(e.target.value)}
            placeholder="例如：格林公式 高斯公式 散度 旋度"
            rows={3}
            maxLength={500}
            className="w-full px-3 py-2.5 bg-background-100 border border-background-200 rounded-lg text-sm text-foreground-800 placeholder:text-foreground-400 outline-none focus:border-accent-300 resize-none"
          ></textarea>
        </div>

        {/* Corrections */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-foreground-500 uppercase tracking-wider">常见错字纠正</span>
            <button
              onClick={addRow}
              className="flex items-center gap-1 text-xs text-accent-600 hover:text-accent-700 cursor-pointer whitespace-nowrap"
            >
              <div className="w-3.5 h-3.5 flex items-center justify-center">
                <i className="ri-add-line"></i>
              </div>
              添加
            </button>
          </div>

          {corrections.length === 0 ? (
            <p className="text-xs text-foreground-400 py-3 text-center">暂无纠错规则</p>
          ) : (
            <div className="space-y-2">
              {corrections.map((rule, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={rule.from}
                    onChange={(e) => updateRow(idx, 'from', e.target.value)}
                    placeholder="听成"
                    className="flex-1 px-2.5 py-1.5 bg-background-100 border border-background-200 rounded text-xs text-foreground-800 placeholder:text-foreground-400 outline-none focus:border-accent-300"
                  />
                  <span className="text-xs text-foreground-400 flex-shrink-0">→</span>
                  <input
                    type="text"
                    value={rule.to}
                    onChange={(e) => updateRow(idx, 'to', e.target.value)}
                    placeholder="应为"
                    className="flex-1 px-2.5 py-1.5 bg-background-100 border border-background-200 rounded text-xs text-foreground-800 placeholder:text-foreground-400 outline-none focus:border-accent-300"
                  />
                  <button
                    onClick={() => updateRow(idx, 'enabled', !rule.enabled)}
                    className={`relative w-9 h-5 rounded-full transition-colors cursor-pointer flex-shrink-0 ${
                      rule.enabled ? 'bg-accent-500' : 'bg-background-300'
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 w-4 h-4 rounded-full bg-background-50 transition-transform ${
                        rule.enabled ? 'left-[17px]' : 'left-0.5'
                      }`}
                    ></span>
                  </button>
                  <button
                    onClick={() => removeRow(idx)}
                    className="w-6 h-6 flex items-center justify-center rounded text-foreground-400 hover:text-red-500 cursor-pointer flex-shrink-0"
                  >
                    <i className="ri-delete-bin-line text-xs"></i>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="pt-4 border-t border-background-200">
          <button
            onClick={handleSave}
            className="w-full py-2.5 bg-accent-500 text-background-50 rounded-full text-sm font-semibold hover:bg-accent-600 transition-colors cursor-pointer whitespace-nowrap"
          >
            保存
          </button>
        </div>
      </div>
    </Modal>
  );
}