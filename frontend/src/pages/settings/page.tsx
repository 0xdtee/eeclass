import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import BackButton from '@/components/feature/BackButton';
import { loadSettings, saveSettings, DEFAULT_SETTINGS, type AppSettings } from '@/lib/settings';
import { useAuth } from '@/hooks/useAuth';
import { SERVICE_ORIGIN, getToken } from '@/hooks/useLiveCaption';
import { t, useLang, setLang, LANGS } from '@/lib/i18n';
import { TRANS_LANGS } from '@/lib/translateLangs';
import Select from '@/components/base/Select';

// Labels/hints are stored as their Simplified source string and translated at render via t(),
// so switching language updates them live (don't pre-translate at module load).
const TOGGLES: { k: 'aiCorrect' | 'smartSeg' | 'autoSummary'; label: string; hint: string }[] = [
  { k: 'aiCorrect', label: '✨ AI 实时纠错', hint: '出字后让 DeepSeek 异步改同音错字(如 影射→映射);选「方言」时改为把方言直出的文字润色成规范普通话。消耗少量 API 额度。' },
  { k: 'smartSeg', label: '🧩 AI 智能分句', hint: '让 DeepSeek 按语意把停顿切碎的句子合并成完整句再断句(整句模式生效)。' },
  { k: 'autoSummary', label: '📝 结束录制自动生成概要', hint: '停止录制后自动整理这节课的 AI 概要;关掉则需手动点生成。' },
];

const IMPORT_TAG_TOGGLES: { k: 'importTagSimilar' | 'importTagNew'; label: string; hint: string }[] = [
  { k: 'importTagSimilar', label: '相似的归到已有标签', hint: '导入的课程名和已有标签相近时,归到那个标签,不重复建。' },
  { k: 'importTagNew', label: '没有相似的就新建标签', hint: '导入的课程没有相近标签时,按课程名自动建一个新标签。' },
];

const SEGS: { k: 'model' | 'sensitivity' | 'device'; label: string; hint: string; options: { value: string; label: string; admin?: boolean }[] }[] = [
  { k: 'model', label: '识别模型', hint: '',
    options: [{ value: 'aliyun', label: '普通话/英语' }, { value: 'aliyun_wu', label: '方言' }, { value: 'aliyun_multi', label: '多语言' }, { value: 'sensevoice', label: 'SenseVoice', admin: true }, { value: 'paraformer', label: 'Paraformer', admin: true }, { value: 'stream', label: '流式', admin: true }, { value: 'shanghainese', label: '上海话(本地)', admin: true }] },
  { k: 'sensitivity', label: '拾音灵敏度', hint: '老师声音较小或距离较远时,可调高灵敏度。',
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
  const lang = useLang();   // subscribe so the whole page re-translates on language change
  const isAdmin = user?.role === 'admin';   // Local/technical models are admin-only
  const [s, setS] = useState<AppSettings>(() => loadSettings());
  const [cat, setCat] = useState<Cat>('ai');

  const set = (k: keyof AppSettings, v: AppSettings[keyof AppSettings]) => {
    setS((prev) => ({ ...prev, [k]: v }));
    saveSettings({ [k]: v } as Partial<AppSettings>);
  };

  // Delete account (irreversible): confirm with the password, wipe all data, then sign out.
  const [showDel, setShowDel] = useState(false);
  const [delPw, setDelPw] = useState('');
  const [delBusy, setDelBusy] = useState(false);
  const [delErr, setDelErr] = useState('');
  const doDelete = async () => {
    setDelBusy(true); setDelErr('');
    try {
      const r = await fetch(SERVICE_ORIGIN + '/api/account/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Token': getToken() },
        body: JSON.stringify({ password: delPw }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || t('注销失败'));
      logout();
      navigate('/');
    } catch (e) {
      setDelErr(e instanceof Error ? e.message : t('注销失败'));
    } finally {
      setDelBusy(false);
    }
  };

  const segBtn = (active: boolean) =>
    `flex-1 text-xs sm:text-sm py-2 px-1 rounded-lg cursor-pointer whitespace-nowrap transition-all active:scale-95 ${active ? 'bg-accent-500 text-background-50 font-semibold shadow-sm' : 'text-foreground-500 hover:text-foreground-800'}`;

  return (
    <div className="min-h-screen bg-background-100">
      <nav className="sticky top-0 z-30 bg-background-50/95 backdrop-blur-sm border-b border-background-200">
        <div className="flex items-center gap-3 h-14 px-6 max-w-4xl mx-auto">
          <BackButton className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-background-100 text-foreground-500 cursor-pointer" />
          <h1 className="text-sm font-semibold text-foreground-900 flex items-center gap-2"><i className="ri-settings-3-line"></i>{t('设置')}</h1>
        </div>
      </nav>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 flex flex-col md:flex-row gap-5 items-start">
        {/* Left: top-level categories */}
        <aside className="w-full md:w-52 flex-shrink-0 flex md:flex-col gap-1.5 overflow-x-auto">
          {CATS.map((c) => (
            <button
              key={c.id}
              data-guide={`set-cat-${c.id}`}
              onClick={() => setCat(c.id)}
              className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-sm whitespace-nowrap cursor-pointer transition-colors flex-shrink-0 md:w-full ${cat === c.id ? 'bg-accent-500 text-background-50 font-semibold shadow-sm' : 'text-foreground-600 hover:bg-background-50'}`}
            >
              <i className={`${c.icon} text-base`}></i>{t(c.label)}
            </button>
          ))}
        </aside>

        {/* Right: sub-categories under this top-level category */}
        <div className="flex-1 min-w-0 w-full">
          {cat === 'ai' && (
            <section className="bg-background-50 border border-background-200 rounded-2xl overflow-hidden">
              <div className="px-5 pt-4 pb-1">
                <h2 className="text-sm font-bold text-foreground-900">{t('AI 处理')}</h2>
                <p className="text-xs text-foreground-400 mt-0.5">{t('选择录音时默认开启哪些 AI 处理(每次开录音自动带上)。')}</p>
              </div>
              <div data-guide="set-ai" className="px-3 pb-2 divide-y divide-background-100">
                {TOGGLES.map((tg) => {
                  const on = !!s[tg.k];
                  return (
                    <button
                      key={tg.k}
                      type="button"
                      onClick={() => set(tg.k, !on)}
                      className="w-full flex items-center justify-between gap-4 py-4 px-2 text-left cursor-pointer rounded-xl hover:bg-background-100/60 transition-colors active:bg-background-100"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground-800">{t(tg.label)}</p>
                        <p className="text-xs text-foreground-400 mt-1 leading-relaxed">{t(tg.hint)}</p>
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
                <h2 className="text-sm font-bold text-foreground-900">{t('录音')}</h2>
                <p className="text-xs text-foreground-400 mt-0.5">{t('录音的默认参数,开录音时自动套用。')}</p>
              </div>
              <div data-guide="set-record" className="px-5 pb-3 divide-y divide-background-100">
                {SEGS.map((g) => (
                  <div key={g.k} className="py-4">
                    <p className="text-sm font-medium text-foreground-800">{t(g.label)}</p>
                    {g.hint && <p className="text-xs text-foreground-400 mt-1 mb-2.5 leading-relaxed">{t(g.hint)}</p>}
                    <div className="flex gap-1.5 p-1 bg-background-100 rounded-xl">
                      {g.options.filter((o) => isAdmin || !o.admin).map((o) => (
                        <button
                          key={o.value}
                          type="button"
                          onClick={() => set(g.k, o.value as AppSettings[keyof AppSettings])}
                          className={segBtn(s[g.k] === o.value)}
                        >
                          {t(o.label)}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
                {/* Live translation default: [source 原文] ⇄ [target 译文]; off when equal. Coupled to the UI language switcher. */}
                <div className="py-4">
                  <p className="text-sm font-medium text-foreground-800">{t('翻译字幕')}</p>
                  <p className="text-xs text-foreground-400 mt-1 mb-2.5 leading-relaxed">{t('给字幕加一行翻译:左边说的语言,右边译成的语言,相同则不翻译。切换界面语言会自动设为对应方向。')}</p>
                  <div className="flex items-center gap-2">
                    <Select
                      variant="block" className="flex-1 min-w-0"
                      value={s.translateFrom} onChange={(v) => set('translateFrom', v as AppSettings['translateFrom'])}
                      options={TRANS_LANGS.map((l) => ({ value: l.code, label: t(l.label) }))}
                    />
                    <button type="button" onClick={() => { const f = s.translateFrom; set('translateFrom', s.translateTo); set('translateTo', f); }} title={t('交换原文和译文')} className="w-9 h-9 flex items-center justify-center rounded-full text-foreground-500 hover:bg-background-200 cursor-pointer flex-shrink-0">
                      <i className="ri-arrow-left-right-line"></i>
                    </button>
                    <Select
                      variant="block" className="flex-1 min-w-0"
                      value={s.translateTo} onChange={(v) => set('translateTo', v as AppSettings['translateTo'])}
                      options={TRANS_LANGS.map((l) => ({ value: l.code, label: t(l.label) }))}
                    />
                  </div>
                </div>
              </div>
            </section>
          )}

          {cat === 'record' && (
            <section className="bg-background-50 border border-background-200 rounded-2xl overflow-hidden mt-5">
              <div className="px-5 pt-4 pb-1">
                <h2 className="text-sm font-bold text-foreground-900">{t('导入课程时自动打标签')}</h2>
                <p className="text-xs text-foreground-400 mt-0.5">{t('课表截图识别课程、加进日历后,自动给这些课打上标签。')}</p>
              </div>
              <div className="px-3 pb-2 divide-y divide-background-100">
                {IMPORT_TAG_TOGGLES.map((tg) => {
                  const on = !!s[tg.k];
                  return (
                    <button
                      key={tg.k}
                      type="button"
                      onClick={() => set(tg.k, !on)}
                      className="w-full flex items-center justify-between gap-4 py-4 px-2 text-left cursor-pointer rounded-xl hover:bg-background-100/60 transition-colors active:bg-background-100"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground-800">{t(tg.label)}</p>
                        <p className="text-xs text-foreground-400 mt-1 leading-relaxed">{t(tg.hint)}</p>
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
                <h2 className="text-sm font-bold text-foreground-900">{t('账户')}</h2>
              </div>
              <div className="px-5 py-4 space-y-4">
                {/* Language switcher */}
                <div>
                  <p className="text-sm font-medium text-foreground-800 mb-2">{t('界面语言')}</p>
                  <div className="flex gap-1.5 p-1 bg-background-100 rounded-xl">
                    {LANGS.map((l) => (
                      <button key={l.value} type="button" onClick={() => { setLang(l.value); if (l.value === 'en') { set('translateFrom', 'zh'); set('translateTo', 'en'); } else { set('translateFrom', 'en'); set('translateTo', 'zh'); } }} className={segBtn(lang === l.value)}>
                        {l.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-3 border-t border-background-100 pt-4">
                  <div className="w-11 h-11 flex items-center justify-center bg-accent-100 rounded-full">
                    <i className={`${user?.role === 'teacher' ? 'ri-user-star-line' : 'ri-user-line'} text-accent-600 text-lg`}></i>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground-900">{user?.name || t('用户')}</p>
                    <p className="text-xs text-foreground-400">{user?.role === 'teacher' ? t('教师') : t('学生')}{user?.email ? ' · ' + user.email : ''}</p>
                  </div>
                </div>
                <div className="text-xs text-foreground-400 border-t border-background-100 pt-3">
                  {t('服务地址:')}<a href={`${SERVICE_ORIGIN}/health`} target="_blank" rel="noreferrer" className="text-primary-500 hover:underline break-all">{SERVICE_ORIGIN}</a>
                </div>
                <button
                  data-guide="set-logout"
                  onClick={() => { logout(); navigate('/'); }}
                  className="flex items-center gap-2 px-4 py-2 bg-red-50 text-red-600 rounded-full text-sm font-medium hover:bg-red-100 cursor-pointer"
                >
                  <i className="ri-logout-box-line"></i>{t('退出登录')}
                </button>
                <div className="border-t border-background-100 pt-3 mt-1">
                  <button
                    onClick={() => { setDelErr(''); setDelPw(''); setShowDel(true); }}
                    className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-full text-sm font-medium hover:bg-red-700 cursor-pointer"
                  >
                    <i className="ri-delete-bin-line"></i>{t('注销账号')}
                  </button>
                  <p className="text-xs text-foreground-400 mt-2">{t('永久删除账号及全部数据,不可恢复。')}</p>
                </div>
              </div>
            </section>
          )}

          <button
            onClick={() => { saveSettings(DEFAULT_SETTINGS); setS({ ...DEFAULT_SETTINGS }); }}
            className="text-xs text-foreground-400 hover:text-foreground-600 cursor-pointer px-2 mt-4 inline-block"
          >
            <i className="ri-refresh-line mr-1"></i>{t('恢复默认设置')}
          </button>
        </div>
      </div>

      {showDel && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => { if (!delBusy) setShowDel(false); }}
        >
          <div className="bg-background-50 rounded-2xl shadow-xl max-w-sm w-full p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-red-600 flex items-center gap-2">
              <i className="ri-error-warning-line"></i>{t('注销账号')}
            </h3>
            <p className="text-sm text-foreground-600 mt-3 leading-relaxed">
              {t('此操作不可恢复。将永久删除你的账号,以及全部录音、转写、概要、标签、声纹与设置。')}
            </p>
            <p className="text-xs text-red-500 mt-2">{t('注销后,同一邮箱 3 天内无法重新注册。')}</p>
            <input
              type="password"
              value={delPw}
              onChange={(e) => setDelPw(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && delPw && !delBusy) void doDelete(); }}
              placeholder={t('请输入登录密码以确认')}
              className="mt-4 w-full h-10 px-3 bg-background-100 border border-background-300 rounded-lg text-sm text-foreground-800 focus:outline-none focus:border-red-400"
            />
            {delErr && <p className="text-xs text-red-500 mt-2">{delErr}</p>}
            <div className="flex gap-2 mt-5">
              <button
                disabled={delBusy || !delPw}
                onClick={() => void doDelete()}
                className="flex-1 h-10 bg-red-600 text-white rounded-lg text-sm font-semibold hover:bg-red-700 disabled:opacity-50 cursor-pointer"
              >
                {delBusy ? t('注销中…') : t('确认注销')}
              </button>
              <button
                disabled={delBusy}
                onClick={() => setShowDel(false)}
                className="flex-1 h-10 bg-background-100 text-foreground-600 rounded-lg text-sm font-semibold hover:bg-background-200 cursor-pointer"
              >
                {t('取消')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
