import { useState } from 'react';
import Modal from '@/components/base/Modal';
import { getServerUrl, getToken } from '@/lib/api';

interface SessionItem {
  id: string;
  title: string;
  date: string;
  time: string;
  duration: string;
}

interface AudioListModalProps {
  isOpen: boolean;
  onClose: () => void;
  sessions: SessionItem[];
}

// Backend /api/audio/{sid} returns the raw audio.wav directly and accepts a token query param (cross-origin <audio> can't send headers, only query).
const audioUrl = (sid: string) =>
  `${getServerUrl()}/api/audio/${encodeURIComponent(sid)}?token=${encodeURIComponent(getToken())}`;

// Download the raw recording: pass download=filename so the server returns it as an attachment.
const audioDownloadUrl = (sid: string, filename: string) =>
  `${audioUrl(sid)}&download=${encodeURIComponent(filename)}`;

export default function AudioListModal({ isOpen, onClose, sessions }: AudioListModalProps) {
  const [search, setSearch] = useState('');
  const filtered = sessions.filter(
    (s) => !search.trim() || s.title.toLowerCase().includes(search.trim().toLowerCase())
  );

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="录音回放" width="max-w-2xl">
      <div className="flex flex-col" style={{ maxHeight: '70vh' }}>
        {/* Top stats + search */}
        <div className="flex items-center justify-between px-1 pb-4 border-b border-background-100 mb-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 flex items-center justify-center bg-primary-100 rounded-lg">
              <i className="ri-mic-line text-primary-600"></i>
            </div>
            <div>
              <p className="text-xs text-foreground-400">共有录音</p>
              <p className="text-lg font-bold text-foreground-900">{sessions.length} 段</p>
            </div>
          </div>
          <div className="relative">
            <div className="w-4 h-4 flex items-center justify-center absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
              <i className="ri-search-line text-foreground-400 text-xs"></i>
            </div>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索课程…"
              className="h-8 pl-8 pr-3 w-44 bg-background-100 border border-background-200 rounded-lg text-xs text-foreground-700 placeholder:text-foreground-300 focus:outline-none focus:border-primary-400 focus:ring-1 focus:ring-primary-100 transition-all"
            />
          </div>
        </div>

        <div className="flex items-center gap-2 px-1 mb-3">
          <i className="ri-information-line text-foreground-300 text-xs"></i>
          <p className="text-[11px] text-foreground-300">点播放条即可听这节课的原始录音;可拖动进度、变速。</p>
        </div>

        {/* Recording list */}
        <div className="overflow-y-auto flex-1">
          {filtered.length === 0 ? (
            <div className="py-12 text-center">
              <div className="w-12 h-12 mx-auto flex items-center justify-center bg-background-100 rounded-full mb-3">
                <i className="ri-mic-off-line text-foreground-300 text-xl"></i>
              </div>
              <p className="text-sm text-foreground-400">
                {sessions.length === 0 ? '暂无录音。请先录制一节课。' : '未找到匹配的课程'}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.map((s) => (
                <div key={s.id} className="p-4 bg-background-50 border border-background-100 rounded-xl">
                  <div className="flex items-center gap-3 mb-2.5">
                    <div className="w-8 h-8 flex items-center justify-center bg-primary-100 rounded-lg flex-shrink-0">
                      <i className="ri-file-music-line text-primary-600 text-sm"></i>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-foreground-800 truncate">{s.title}</p>
                      <div className="flex items-center gap-3 mt-0.5 text-xs text-foreground-400">
                        <span className="flex items-center gap-1">
                          <i className="ri-calendar-line text-[11px]"></i>
                          {s.date} {s.time}
                        </span>
                        <span className="flex items-center gap-1">
                          <i className="ri-time-line text-[11px]"></i>
                          {s.duration}
                        </span>
                      </div>
                    </div>
                    {/* Export recording: download the raw audio.wav directly */}
                    <a
                      href={audioDownloadUrl(s.id, `${(s.title || '录音').replace(/[\\/:*?"<>|]/g, '_')}.wav`)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-primary-100 text-primary-700 rounded-full text-xs font-medium hover:bg-primary-200 cursor-pointer whitespace-nowrap flex-shrink-0"
                      title="下载这节课的原始录音"
                    >
                      <i className="ri-download-2-line"></i>
                      导出录音
                    </a>
                  </div>
                  {/* Raw recording: native player, preload=none to avoid fetching all metadata at once */}
                  <audio
                    controls
                    preload="none"
                    src={audioUrl(s.id)}
                    className="w-full h-9"
                  >
                    你的浏览器不支持音频播放。
                  </audio>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
