import { useState, useEffect } from 'react';
import Modal from '@/components/base/Modal';
import { tags as allTags } from '@/mocks/courseData';
import TagBadge from '@/components/base/TagBadge';
import { useT } from '@/lib/i18n';

interface NewSessionModalProps {
  isOpen: boolean;
  onClose: () => void;
  preselectedDate: string;
  dateLocked?: boolean;
  onConfirm: (data: { title: string; date: string; time: string; duration: string; tags: string[]; description: string }) => void;
}

export default function NewSessionModal({ isOpen, onClose, preselectedDate, dateLocked = false, onConfirm }: NewSessionModalProps) {
  const t = useT();
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(preselectedDate);
  const [timeHour, setTimeHour] = useState('08');
  const [timeMinute, setTimeMinute] = useState('30');
  const [durationHours, setDurationHours] = useState('1');
  const [durationMinutes, setDurationMinutes] = useState('30');
  const [description, setDescription] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  useEffect(() => {
    if (isOpen) {
      setDate(preselectedDate);
      setTitle('');
      setDescription('');
      setSelectedTags([]);
      setTimeHour('08');
      setTimeMinute('30');
      setDurationHours('1');
      setDurationMinutes('30');
    }
  }, [isOpen, preselectedDate]);

  const toggleTag = (tagId: string) => {
    if (selectedTags.includes(tagId)) {
      setSelectedTags(selectedTags.filter((t) => t !== tagId));
    } else {
      setSelectedTags([...selectedTags, tagId]);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !date) return;
    const time = `${timeHour}:${timeMinute}`;
    const duration = `${durationHours}小时${durationMinutes}分`;
    onConfirm({ title: title.trim(), date, time, duration, tags: selectedTags, description: description.trim() });
    onClose();
  };

  const handleClose = () => {
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={t('新建课时记录')} width="max-w-md">
      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className="block text-xs font-medium text-foreground-600 mb-1.5">{t('课时标题')}</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('例如：第8讲：图的遍历算法')}
            className="w-full px-3 py-2.5 bg-background-100 border border-background-200 rounded-lg text-sm text-foreground-800 placeholder:text-foreground-300 focus:outline-none focus:border-accent-400 focus:ring-2 focus:ring-accent-100 transition-all"
            required
            autoFocus
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-foreground-600 mb-1.5">{t('日期')}</label>
          {dateLocked && date ? (
            <div className="w-full px-3 py-2.5 bg-background-100 border border-background-200 rounded-lg text-sm text-foreground-700 font-medium flex items-center gap-2">
              <div className="w-4 h-4 flex items-center justify-center">
                <i className="ri-calendar-line text-accent-500 text-sm"></i>
              </div>
              {date}
            </div>
          ) : (
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full px-3 py-2.5 bg-background-100 border border-background-200 rounded-lg text-sm text-foreground-800 focus:outline-none focus:border-accent-400 focus:ring-2 focus:ring-accent-100 transition-all"
              required
            />
          )}
        </div>

        <div>
          <label className="block text-xs font-medium text-foreground-600 mb-1.5">{t('上课时间')}</label>
          <div className="flex items-center gap-2">
            <select
              value={timeHour}
              onChange={(e) => setTimeHour(e.target.value)}
              className="flex-1 px-3 py-2.5 bg-background-100 border border-background-200 rounded-lg text-sm text-foreground-800 focus:outline-none focus:border-accent-400 focus:ring-2 focus:ring-accent-100 transition-all cursor-pointer"
            >
              {['08', '09', '10', '13', '14', '15', '16', '18', '19'].map((h) => (
                <option key={h} value={h}>{h}:00</option>
              ))}
            </select>
            <span className="text-foreground-400 text-sm">—</span>
            <select
              value={timeMinute}
              onChange={(e) => setTimeMinute(e.target.value)}
              className="flex-1 px-3 py-2.5 bg-background-100 border border-background-200 rounded-lg text-sm text-foreground-800 focus:outline-none focus:border-accent-400 focus:ring-2 focus:ring-accent-100 transition-all cursor-pointer"
            >
              {['00', '15', '30', '45'].map((m) => (
                <option key={m} value={m}>:{m}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-foreground-600 mb-1.5">{t('预计时长')}</label>
          <div className="flex items-center gap-2">
            <select
              value={durationHours}
              onChange={(e) => setDurationHours(e.target.value)}
              className="flex-1 px-3 py-2.5 bg-background-100 border border-background-200 rounded-lg text-sm text-foreground-800 focus:outline-none focus:border-accent-400 focus:ring-2 focus:ring-accent-100 transition-all cursor-pointer"
            >
              {['0', '1', '2', '3'].map((h) => (
                <option key={h} value={h}>{t('{h} 小时', { h })}</option>
              ))}
            </select>
            <select
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(e.target.value)}
              className="flex-1 px-3 py-2.5 bg-background-100 border border-background-200 rounded-lg text-sm text-foreground-800 focus:outline-none focus:border-accent-400 focus:ring-2 focus:ring-accent-100 transition-all cursor-pointer"
            >
              {['00', '15', '30', '45'].map((m) => (
                <option key={m} value={m}>{t('{m} 分', { m })}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-foreground-600 mb-1.5">{t('简要描述')}</label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t('例如：Dijkstra算法、堆优化')}
            className="w-full px-3 py-2.5 bg-background-100 border border-background-200 rounded-lg text-sm text-foreground-800 placeholder:text-foreground-300 focus:outline-none focus:border-accent-400 focus:ring-2 focus:ring-accent-100 transition-all"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-foreground-600 mb-2">{t('章节标签')}</label>
          <div className="flex flex-wrap gap-2">
            {allTags.map((tag) => (
              <TagBadge
                key={tag.id}
                label={tag.label}
                active={selectedTags.includes(tag.id)}
                onClick={() => toggleTag(tag.id)}
                color="accent"
                size="sm"
              />
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button
            type="button"
            onClick={handleClose}
            className="flex-1 py-2.5 bg-background-100 text-foreground-600 rounded-lg text-sm font-medium hover:bg-background-200 transition-colors cursor-pointer whitespace-nowrap"
          >
            {t('取消')}
          </button>
          <button
            type="submit"
            className="flex-1 py-2.5 bg-accent-500 text-background-50 rounded-lg text-sm font-semibold hover:bg-accent-600 transition-colors cursor-pointer whitespace-nowrap"
          >
            {t('创建课时')}
          </button>
        </div>
      </form>
    </Modal>
  );
}