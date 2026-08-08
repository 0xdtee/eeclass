import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import BackButton from '@/components/feature/BackButton';
import { loadSettings, saveSettings, DEFAULT_SETTINGS, type AppSettings } from '@/lib/settings';
import { useAuth } from '@/hooks/useAuth';
import { SERVICE_ORIGIN } from '@/hooks/useLiveCaption';

// 直接用常量数组渲染(不套内部组件),避免每次 setState 重新挂载把点击吞掉。
const TOGGLES: { k: 'aiCorrect' | 'smartSeg' | 'translateEn' | 'autoSummary'; label: string; hint: string }[] = [
  { k: 'aiCorrect', label: '✨ AI 实时纠错', hint: '出字后让 DeepSeek 异步改同音错字(如 影射→映射),消耗少量 API 额度。' },
  { k: 'smartSeg', label: '🧩 AI 智能分句', hint: '让 DeepSeek 按语意把停顿切碎的句子合并成完整句再断句(整句模式生效)。' },
  { k: 'translateEn', label: '🌐 英文自动翻译', hint: '识别到英文句(或英语课)时,在该句下面自动加一行中文字幕。消耗少量 API 额度。' },
  { k: 'autoSummary', label: '📝 结束录制自动生成概要', hint: '停止录制后自动整理这节课的 AI 概要;关掉则需手动点生成。' },
];

// 导入课程时自动打标签
const IMPORT_TAG_TOGGLES: { k: 'importTagSimilar' | 'importTagNew'; label: string; hint: string }[] = [
  { k: 'importTagSimilar', label: '相似的归到已有标签', hint: '导入的课程名和已有标签相近时,归到那个标签,不重复建。' },
  { k: 'importTagNew', label: '没有相似的就新建标签', hint: '导入的课程没有相近标签时,按课程名自动建一个新标签。' },
];

const SEGS: { k: 'model' | 'sensitivity' | 'device'; label: string; hint: string; options: { value: string; label: string }[] }[] = [
  { k: 'model', label: '识别模型', hint: '整句更准、流式边说边出字。',
    options: [{ value: 'sensevoice', label: 'SenseVoice' }, { value: 'paraformer', label: 'Paraformer' }, { value: 'stream', label: '流式' }, { value: 'shanghainese', label: '上海话' }, { value: 'aliyun', label: '☁️ 阿里云·普通话' }, { value: 'aliyun_wu', label: '☁️ 阿里云·上海话' }] },
  { k: 'sensitivity', label: '拾音灵敏度', hint: '老师声音小或坐得远就调高。',
    options: [{ value: 'std', label: '标准' }, { value: 'high', label: '灵敏' }, { value: 'max', label: '最灵敏' }] },
  { k: 'device', label: '默认音源', hint: '系统声音用于网课(仅电脑 Chrome/Edge)。',
    options: [{ value: 'auto', label: '自动' }, { value: 'browser', label: '麦克风' }, { value: 'browser-system', label: '系统声音' }] },
];

type Cat = 'ai' | 'record' | 'account';
const CATS: { id: Cat; label: string; icon: string }[] = [
  { id: 'ai', label: 'AI 处理', icon: 'ri-sparkling-2-line' },
  { id: 'record', label: '录音', icon: 'ri-mic-line' },
  { id: 'account', label: '账户', icon: 'ri-user-line' },
];

export default function SettingsPage() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [s, setS] = useState<AppSettings>(() => loadSettings());
  const [cat, setCat] = useState<Cat>('ai');

  const set = (k: keyof AppSettings, v: AppSettings[keyof AppSettings]) => {
    setS((prev) => ({ ...prev, [k]: v }));
    saveSettings({ [k]: v } as Partial<AppSettings>);
  };

  return (
    <div className="min-h-screen bg-background-100">
      <nav className="sticky top-0 z-30 bg-background-50/95 backdrop-blur-sm border-b border-background-200">
        <div className="flex items-center gap-3 h-14 px-6 max-w-4xl mx-auto">
          <BackButton className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-background-100 text-foreground-500 cursor-pointer" />
          <h1 className="text-sm font-semibold text-foreground-900 flex items-center gap-2"><i className="ri-settings-3-line"></i>设置</h1>
        </div>
      </nav>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 flex flex-col md:flex-row gap-5 items-start">
        {/* 左:大类 */}
        <aside className="w-full md:w-52 flex-shrink-0 flex md:flex-col gap-1.5 overflow-x-auto">
          {CATS.map((c) => (
            <button
              key={c.id}
              data-guide={`set-cat-${c.id}`}
              onClick={() => setCat(c.id)}
              className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-sm whitespace-nowrap cursor-pointer transition-colors flex-shrink-0 md:w-full ${cat === c.id ? 'bg-accent-500 text-background-50 font-semibold shadow-sm' : 'text-foreground-600 hover:bg-background-50'}`}
            >
              <i className={`${c.icon} text-base`}></i>{c.label}
            </button>
          ))}
        </aside>

        {/* 右:该大类下的小类 */}
        <div className="flex-1 min-w-0 w-full">
          {cat === 'ai' && (
            <section className="bg-background-50 border border-background-200 rounded-2xl overflow-hidden">
              <div className="px-5 pt-4 pb-1">
                <h2 className="text-sm font-bold text-foreground-900">AI 处理</h2>
                <p className="text-xs text-foreground-400 mt-0.5">选择录音时默认开启哪些 AI 处理(每次开录音自动带上)。</p>
              </div>
              <div data-guide="set-ai" className="px-3 pb-2 divide-y divide-background-100">
                {TOGGLES.map((t) => {
                  const on = !!s[t.k];
                  return (
                    <button
                      key={t.k}
                      type="button"
                      onClick={() => set(t.k, !on)}
                      className="w-full flex items-center justify-between gap-4 py-4 px-2 text-left cursor-pointer rounded-xl hover:bg-background-100/60 transition-colors active:bg-background-100"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground-800">{t.label}</p>
                        <p className="text-xs text-foreground-400 mt-1 leading-relaxed">{t.hint}</p>
                      </div>
                      <span className={`relative w-12 h-7 rounded-full flex-shrink-0 transition-colors duration-200 ${on ? 'bg-accent-500' : 'bg-background-300'}`}>
                        <span className={`absolute top-1 left-1 w-5 h-5 rounded-full bg-white shadow-md transition-transform duration-200 ${on ? 'translate-x-5' : ''}`}></span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {cat === 'record' && (
            <section className="bg-background-50 border border-background-200 rounded-2xl overflow-hidden">
              <div className="px-5 pt-4 pb-1">
                <h2 className="text-sm font-bold text-foreground-900">录音</h2>
                <p className="text-xs text-foreground-400 mt-0.5">录音的默认参数,开录音时自动套用。</p>
              </div>
              <div data-guide="set-record" className="px-5 pb-3 divide-y divide-background-100">
                {SEGS.map((g) => (
                  <div key={g.k} className="py-4">
                    <p className="text-sm font-medium text-foreground-800">{g.label}</p>
                    <p className="text-xs text-foreground-400 mt-1 mb-2.5 leading-relaxed">{g.hint}</p>
                    <div className="flex gap-1.5 p-1 bg-background-100 rounded-xl">
                      {g.options.map((o) => {
                        const active = s[g.k] === o.value;
                        return (
                          <button
                            key={o.value}
                            type="button"
                            onClick={() => set(g.k, o.value as AppSettings[keyof AppSettings])}
                            className={`flex-1 text-xs sm:text-sm py-2 px-1 rounded-lg cursor-pointer whitespace-nowrap transition-all active:scale-95 ${active ? 'bg-accent-500 text-background-50 font-semibold shadow-sm' : 'text-foreground-500 hover:text-foreground-800'}`}
                          >
                            {o.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {cat === 'record' && (
            <section className="bg-background-50 border border-background-200 rounded-2xl overflow-hidden mt-5">
              <div className="px-5 pt-4 pb-1">
                <h2 className="text-sm font-bold text-foreground-900">导入课程时自动打标签</h2>
                <p className="text-xs text-foreground-400 mt-0.5">课表截图识别课程、加进日历后,自动给这些课打上标签。</p>
              </div>
              <div className="px-3 pb-2 divide-y divide-background-100">
                {IMPORT_TAG_TOGGLES.map((t) => {
                  const on = !!s[t.k];
                  return (
                    <button
                      key={t.k}
                      type="button"
                      onClick={() => set(t.k, !on)}
                      className="w-full flex items-center justify-between gap-4 py-4 px-2 text-left cursor-pointer rounded-xl hover:bg-background-100/60 transition-colors active:bg-background-100"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground-800">{t.label}</p>
                        <p className="text-xs text-foreground-400 mt-1 leading-relaxed">{t.hint}</p>
                      </div>
                      <span className={`relative w-12 h-7 rounded-full flex-shrink-0 transition-colors duration-200 ${on ? 'bg-accent-500' : 'bg-background-300'}`}>
                        <span className={`absolute top-1 left-1 w-5 h-5 rounded-full bg-white shadow-md transition-transform duration-200 ${on ? 'translate-x-5' : ''}`}></span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {cat === 'account' && (
            <section className="bg-background-50 border border-background-200 rounded-2xl overflow-hidden">
              <div className="px-5 pt-4 pb-1">
                <h2 className="text-sm font-bold text-foreground-900">账户</h2>
              </div>
              <div className="px-5 py-4 space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 flex items-center justify-center bg-accent-100 rounded-full">
                    <i className={`${user?.role === 'teacher' ? 'ri-user-star-line' : 'ri-user-line'} text-accent-600 text-lg`}></i>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground-900">{user?.name || '用户'}</p>
                    <p className="text-xs text-foreground-400">{user?.role === 'teacher' ? '教师' : '学生'}{user?.email ? ' · ' + user.email : ''}</p>
                  </div>
                </div>
                <div className="text-xs text-foreground-400 border-t border-background-100 pt-3">
                  服务地址:<a href={`${SERVICE_ORIGIN}/health`} target="_blank" rel="noreferrer" className="text-primary-500 hover:underline break-all">{SERVICE_ORIGIN}</a>
                </div>
                <button
                  data-guide="set-logout"
                  onClick={() => { logout(); navigate('/'); }}
                  className="flex items-center gap-2 px-4 py-2 bg-red-50 text-red-600 rounded-full text-sm font-medium hover:bg-red-100 cursor-pointer"
                >
                  <i className="ri-logout-box-line"></i>退出登录
                </button>
              </div>
            </section>
          )}

          <button
            onClick={() => { saveSettings(DEFAULT_SETTINGS); setS({ ...DEFAULT_SETTINGS }); }}
            className="text-xs text-foreground-400 hover:text-foreground-600 cursor-pointer px-2 mt-4 inline-block"
          >
            <i className="ri-refresh-line mr-1"></i>恢复默认设置
          </button>
        </div>
      </div>
    </div>
  );
}
