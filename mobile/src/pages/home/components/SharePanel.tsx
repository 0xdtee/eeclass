import { useState } from 'react';
import Modal from '@/components/base/Modal';
import { shareSettings } from '@/mocks/courseData';

interface SharePanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function SharePanel({ isOpen, onClose }: SharePanelProps) {
  const [settings, setSettings] = useState(shareSettings);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="共享设置" width="max-w-md">
      <div className="space-y-6">
        <div className="space-y-4">
          <h4 className="text-xs font-semibold text-foreground-500 uppercase tracking-wider">访问权限</h4>

          <label className="flex items-center justify-between cursor-pointer">
            <div>
              <p className="text-sm font-medium text-foreground-800">公开访问</p>
              <p className="text-xs text-foreground-400 mt-0.5">允许所有人查看课程纪要</p>
            </div>
            <button
              onClick={() => setSettings((s) => ({ ...s, isPublic: !s.isPublic }))}
              className={`relative w-11 h-6 rounded-full transition-colors cursor-pointer ${
                settings.isPublic ? 'bg-accent-500' : 'bg-background-300'
              }`}
            >
              <span
                className={`absolute top-0.5 w-5 h-5 rounded-full bg-background-50 transition-transform ${
                  settings.isPublic ? 'left-[22px]' : 'left-0.5'
                }`}
              ></span>
            </button>
          </label>

          <label className="flex items-center justify-between cursor-pointer">
            <div>
              <p className="text-sm font-medium text-foreground-800">允许评论</p>
              <p className="text-xs text-foreground-400 mt-0.5">学生可在纪要下方发表评论</p>
            </div>
            <button
              onClick={() => setSettings((s) => ({ ...s, allowComment: !s.allowComment }))}
              className={`relative w-11 h-6 rounded-full transition-colors cursor-pointer ${
                settings.allowComment ? 'bg-accent-500' : 'bg-background-300'
              }`}
            >
              <span
                className={`absolute top-0.5 w-5 h-5 rounded-full bg-background-50 transition-transform ${
                  settings.allowComment ? 'left-[22px]' : 'left-0.5'
                }`}
              ></span>
            </button>
          </label>

          <label className="flex items-center justify-between cursor-pointer">
            <div>
              <p className="text-sm font-medium text-foreground-800">允许下载</p>
              <p className="text-xs text-foreground-400 mt-0.5">允许下载PDF版本</p>
            </div>
            <button
              onClick={() => setSettings((s) => ({ ...s, allowDownload: !s.allowDownload }))}
              className={`relative w-11 h-6 rounded-full transition-colors cursor-pointer ${
                settings.allowDownload ? 'bg-accent-500' : 'bg-background-300'
              }`}
            >
              <span
                className={`absolute top-0.5 w-5 h-5 rounded-full bg-background-50 transition-transform ${
                  settings.allowDownload ? 'left-[22px]' : 'left-0.5'
                }`}
              ></span>
            </button>
          </label>
        </div>

        <div className="space-y-3">
          <h4 className="text-xs font-semibold text-foreground-500 uppercase tracking-wider">已共享对象</h4>
          <div className="space-y-2">
            {settings.sharedWith.map((person, idx) => (
              <div key={idx} className="flex items-center justify-between p-3 bg-background-100 rounded-lg">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-accent-100 flex items-center justify-center">
                    <span className="text-xs font-semibold text-accent-700">{person.name[0]}</span>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground-800">{person.name}</p>
                    <p className="text-xs text-foreground-400">{person.email}</p>
                  </div>
                </div>
                <span className="text-xs px-2 py-1 rounded-full bg-secondary-100 text-secondary-700 font-medium">
                  {person.role}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="pt-4 border-t border-background-200">
          <button className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-accent-500 text-background-50 rounded-full text-sm font-semibold hover:bg-accent-600 transition-colors cursor-pointer whitespace-nowrap">
            <i className="ri-user-add-line"></i>
            邀请更多学生
          </button>
        </div>
      </div>
    </Modal>
  );
}