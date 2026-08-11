import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { getServerUrl, setServerUrl, apiFetch } from '@/lib/api';
import {
  getAiDefault, setAiDefault,
  getMicGain, setMicGain, MIC_GAIN_MIN, MIC_GAIN_MAX,
  getTheme, setTheme as saveTheme, type Theme,
} from '@/lib/settings';
import { CHANGELOG } from '@/lib/changelog';

export default function ProfilePage() {
  const navigate = useNavigate();
  const { user, logout, isAdmin, isOffline } = useAuth();
  const [serverUrl, setServerUrlState] = useState(getServerUrl());
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState('');
  const [showServerEdit, setShowServerEdit] = useState(false);

  // Settings panel toggles
  const [showAiDefaults, setShowAiDefaults] = useState(false);
  const [showTheme, setShowTheme] = useState(false);
  const [showMicGain, setShowMicGain] = useState(false);
  const [showChangelog, setShowChangelog] = useState(false);

  // AI default toggles
  const [aiCorrect, setAiCorrect] = useState(() => getAiDefault('aiCorrect'));
  const [smartSeg, setSmartSeg] = useState(() => getAiDefault('smartSeg'));
  const [translateEn, setTranslateEn] = useState(() => getAiDefault('translateEn'));

  // Theme
  const [theme, setThemeState] = useState<Theme>(() => getTheme());

  // Mic sensitivity
  const [micGain, setMicGainState] = useState<number>(() => getMicGain());

  const handleTest = async () => {
    setTesting(true);
    setTestMsg('');
    try {
      const data = await apiFetch<{ ok?: boolean; error?: string }>('/health');
      setTestMsg(data.error || '连接成功');
    } catch (e) {
      setTestMsg(e instanceof Error ? e.message : '连接失败');
    } finally {
      setTesting(false);
    }
  };

  const handleSaveServer = () => {
    setServerUrl(serverUrl);
    setShowServerEdit(false);
    setTestMsg('');
  };

  const toggleAiDefault = (
    key: 'aiCorrect' | 'smartSeg' | 'translateEn',
    cur: boolean,
    set: (v: boolean) => void,
  ) => {
    const next = !cur;
    set(next);
    setAiDefault(key, next);
  };

  const pickTheme = (t: Theme) => {
    setThemeState(t);
    saveTheme(t); // apply immediately to <html data-theme>
  };

  const onMicGainChange = (v: number) => {
    setMicGainState(v);
    setMicGain(v);
  };

  const AiSwitch = ({ on, set, label, desc, icon }: { on: boolean; set: () => void; label: string; desc: string; icon: string }) => (
    <button
      onClick={set}
      className="w-full flex items-center gap-3 p-3 rounded-xl bg-background-100 border border-background-200 text-left"
    >
      <i className={`${icon} text-lg ${on ? 'text-accent-600' : 'text-foreground-300'}`}></i>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground-800">{label}</p>
        <p className="text-xs text-foreground-400 truncate">{desc}</p>
      </div>
      <span className={`relative w-10 h-6 rounded-full transition-colors flex-shrink-0 ${on ? 'bg-accent-500' : 'bg-background-300'}`}>
        <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${on ? 'left-[18px]' : 'left-0.5'}`}></span>
      </span>
    </button>
  );

  const menuItems = [
    { icon: 'ri-megaphone-line', label: '更新日志', action: () => setShowChangelog(true) },
    { icon: 'ri-book-2-line', label: '使用说明', action: () => navigate('/help') },
    { icon: 'ri-settings-3-line', label: 'AI 处理默认开关', action: () => setShowAiDefaults(true) },
    { icon: 'ri-palette-line', label: '深浅色主题', action: () => setShowTheme(true) },
    { icon: 'ri-mic-line', label: '拾音灵敏度', action: () => setShowMicGain(true) },
    { icon: 'ri-price-tag-3-line', label: '标签管理', action: () => navigate('/tags') },
    ...(isAdmin ? [{ icon: 'ri-fingerprint-line', label: '声纹库（管理员）', action: () => navigate('/voiceprints') }] : []),
    { icon: 'ri-book-open-line', label: '参考资料', action: () => navigate('/syllabus') },
    { icon: 'ri-server-line', label: '服务器配置', action: () => setShowServerEdit(true) },
  ];

  return (
    <div className="min-h-full bg-background-50">
      {/* Header */}
      <div className="px-5 md:px-8 pt-6 md:pt-8 pb-4">
        <h1 className="text-lg md:text-2xl font-bold text-foreground-900">我的</h1>
      </div>

      {/* Content — two sections on iPad */}
      <div className="px-5 md:px-8 pb-8">
        <div className="flex flex-col md:flex-row gap-4 md:gap-6">
          {/* User Card + Logout */}
          <div className="md:w-[300px] flex-shrink-0 space-y-4">
            <div className="bg-background-50 rounded-xl p-5 border border-background-200">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 flex items-center justify-center bg-accent-100 rounded-full">
                  <i className={`${user?.role === 'teacher' ? 'ri-user-star-line' : 'ri-user-line'} text-accent-600 text-xl`}></i>
                </div>
                <div className="flex-1">
                  <p className="text-base font-semibold text-foreground-900">{user?.name || '未登录'}</p>
                  <p className="text-sm text-foreground-400">{user?.email}</p>
                  <div className="flex items-center gap-2 mt-1.5">
                    {user && (
                      <span className="inline-block px-2 py-0.5 bg-accent-100 text-accent-700 text-[10px] font-medium rounded-full">
                        {user.role === 'teacher' ? '教师' : user.role === 'admin' ? '管理员' : '学生'}
                      </span>
                    )}
                    {isOffline && (
                      <span className="inline-block px-2 py-0.5 bg-amber-100 text-amber-700 text-[10px] font-medium rounded-full">
                        离线体验
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <button
              onClick={async () => {
                await logout();
                navigate('/login');
              }}
              className="w-full flex items-center gap-3 px-5 py-3.5 bg-background-50 rounded-xl border border-background-200 hover:border-red-200 hover:bg-red-50 transition-colors cursor-pointer text-left"
            >
              <div className="w-5 h-5 flex items-center justify-center">
                <i className="ri-logout-box-line text-red-400"></i>
              </div>
              <span className="text-sm text-red-500 font-medium">
                {isOffline ? '退出离线模式' : '退出登录'}
              </span>
            </button>
          </div>

          {/* Menu */}
          <div className="flex-1 space-y-1">
            {menuItems.map((item) => (
              <button
                key={item.label}
                onClick={item.action}
                className="w-full flex items-center gap-3 px-5 py-3.5 md:py-4 bg-background-50 rounded-xl border border-background-200 hover:border-accent-200 transition-colors cursor-pointer text-left"
              >
                <div className="w-5 h-5 flex items-center justify-center">
                  <i className={`${item.icon} text-foreground-500`}></i>
                </div>
                <span className="text-sm text-foreground-700 flex-1">{item.label}</span>
                <div className="w-4 h-4 flex items-center justify-center">
                  <i className="ri-arrow-right-s-line text-foreground-300"></i>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Server Config Modal */}
      {showServerEdit && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40">
          <div className="bg-background-50 rounded-t-2xl md:rounded-2xl w-full max-w-sm p-5 m-0 md:m-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-foreground-900">服务器配置</h3>
              <button
                onClick={() => setShowServerEdit(false)}
                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-background-100 cursor-pointer"
              >
                <i className="ri-close-line text-foreground-400"></i>
              </button>
            </div>
            <div className="space-y-3">
              <input
                type="url"
                value={serverUrl}
                onChange={(e) => { setServerUrlState(e.target.value); setTestMsg(''); }}
                placeholder="https://192.168.1.100:5901"
                className="w-full px-4 py-3 bg-background-100 border border-background-200 rounded-xl text-sm text-foreground-800 placeholder:text-foreground-300 focus:outline-none focus:border-accent-400 focus:ring-2 focus:ring-accent-100 transition-all"
              />
              <button
                onClick={handleTest}
                disabled={testing}
                className="w-full py-2.5 bg-background-100 border border-background-200 rounded-xl text-sm text-foreground-600 hover:bg-background-200 transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap"
              >
                {testing ? (
                  <span className="flex items-center justify-center gap-2">
                    <i className="ri-loader-4-line animate-spin"></i>
                    测试中…
                  </span>
                ) : '测试连接'}
              </button>
              {testMsg && (
                <p className={`text-xs ${testMsg.includes('成功') ? 'text-accent-600' : 'text-red-500'}`}>
                  {testMsg}
                </p>
              )}
              <button
                onClick={handleSaveServer}
                className="w-full py-3 bg-accent-500 text-background-50 rounded-xl text-sm font-semibold hover:bg-accent-600 transition-colors cursor-pointer whitespace-nowrap"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI processing defaults toggle Modal */}
      {showAiDefaults && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40">
          <div className="bg-background-50 rounded-t-2xl md:rounded-2xl w-full max-w-sm p-5 m-0 md:m-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-foreground-900">AI 处理默认开关</h3>
              <button
                onClick={() => setShowAiDefaults(false)}
                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-background-100 cursor-pointer"
              >
                <i className="ri-close-line text-foreground-400"></i>
              </button>
            </div>
            <p className="text-xs text-foreground-400 mb-3">新录音默认用这套开关,录音页仍可临时改。</p>
            <div className="space-y-2">
              <AiSwitch on={aiCorrect} set={() => toggleAiDefault('aiCorrect', aiCorrect, setAiCorrect)}
                icon="ri-sparkling-line" label="AI 实时纠错" desc="出字后自动改同音错字" />
              <AiSwitch on={smartSeg} set={() => toggleAiDefault('smartSeg', smartSeg, setSmartSeg)}
                icon="ri-scissors-cut-line" label="AI 智能分句" desc="按语意把碎片合并成完整句" />
              <AiSwitch on={translateEn} set={() => toggleAiDefault('translateEn', translateEn, setTranslateEn)}
                icon="ri-translate-2" label="英文自动翻译" desc="英文句下面加一行中文字幕" />
            </div>
          </div>
        </div>
      )}

      {/* Light/dark theme Modal */}
      {showTheme && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40">
          <div className="bg-background-50 rounded-t-2xl md:rounded-2xl w-full max-w-sm p-5 m-0 md:m-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-foreground-900">深浅色主题</h3>
              <button
                onClick={() => setShowTheme(false)}
                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-background-100 cursor-pointer"
              >
                <i className="ri-close-line text-foreground-400"></i>
              </button>
            </div>
            <div className="space-y-2">
              {([
                { v: 'light' as Theme, label: '浅色', icon: 'ri-sun-line' },
                { v: 'dark' as Theme, label: '深色', icon: 'ri-moon-line' },
                { v: 'auto' as Theme, label: '跟随系统', icon: 'ri-contrast-2-line' },
              ]).map((opt) => (
                <button
                  key={opt.v}
                  onClick={() => pickTheme(opt.v)}
                  className={`w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-colors ${
                    theme === opt.v
                      ? 'bg-accent-100 border-accent-300'
                      : 'bg-background-100 border-background-200'
                  }`}
                >
                  <i className={`${opt.icon} text-lg ${theme === opt.v ? 'text-accent-600' : 'text-foreground-400'}`}></i>
                  <span className={`text-sm flex-1 ${theme === opt.v ? 'text-accent-700 font-medium' : 'text-foreground-700'}`}>{opt.label}</span>
                  {theme === opt.v && <i className="ri-check-line text-accent-600"></i>}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Changelog Modal */}
      {showChangelog && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40">
          <div className="bg-background-50 rounded-t-2xl md:rounded-2xl w-full max-w-md p-5 m-0 md:m-4 max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-foreground-900">更新日志</h3>
              <button
                onClick={() => setShowChangelog(false)}
                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-background-100 cursor-pointer"
              >
                <i className="ri-close-line text-foreground-400"></i>
              </button>
            </div>
            <div className="space-y-5">
              {CHANGELOG.map((rel) => (
                <div key={rel.date}>
                  <span className="px-2 py-0.5 bg-accent-100 text-accent-700 rounded-full text-xs font-semibold">{rel.date}</span>
                  <ul className="mt-2 space-y-1.5">
                    {rel.items.map((it, i) => (
                      <li key={i} className="flex gap-2 text-sm text-foreground-700 leading-relaxed">
                        <i className="ri-checkbox-circle-line text-accent-500 mt-0.5 flex-shrink-0"></i>
                        <span>{it}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Mic sensitivity Modal */}
      {showMicGain && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40">
          <div className="bg-background-50 rounded-t-2xl md:rounded-2xl w-full max-w-sm p-5 m-0 md:m-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-foreground-900">拾音灵敏度</h3>
              <button
                onClick={() => setShowMicGain(false)}
                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-background-100 cursor-pointer"
              >
                <i className="ri-close-line text-foreground-400"></i>
              </button>
            </div>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-foreground-700">拾音灵敏度</span>
                <span className="text-sm font-semibold text-accent-600 font-mono">{micGain.toFixed(1)}×</span>
              </div>
              <input
                type="range"
                min={MIC_GAIN_MIN}
                max={MIC_GAIN_MAX}
                step={0.1}
                value={micGain}
                onChange={(e) => onMicGainChange(parseFloat(e.target.value))}
                className="w-full accent-accent-500"
              />
              <div className="flex justify-between text-[11px] text-foreground-400 font-mono">
                <span>{MIC_GAIN_MIN.toFixed(1)}×</span>
                <span>{MIC_GAIN_MAX.toFixed(1)}×</span>
              </div>
              <p className="text-xs text-foreground-400 leading-relaxed">
                声音太小听不清就调高,爆音/太吵就调低。改动下次开麦生效。
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}