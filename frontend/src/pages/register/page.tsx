import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useT } from '@/lib/i18n';

export default function RegisterPage() {
  const navigate = useNavigate();
  const t = useT();
  const { register, sendRegisterCode } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [code, setCode] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [err, setErr] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [cooldown, setCooldown] = useState(0);   // Countdown after sending the verification code (seconds)

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((n) => n - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  const handleSendCode = async () => {
    if (sending || cooldown > 0) return;
    if (!emailOk) { setErr(t('先填写正确的邮箱')); return; }
    setErr(''); setInfo('');
    setSending(true);
    try {
      await sendRegisterCode(email);
      setInfo(t('验证码已发送,请查收邮箱(可能在垃圾箱)'));
      setCooldown(60);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('发送失败'));
    } finally {
      setSending(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!name || !email || !password || !code) {
      setErr(t('请填写姓名、邮箱、密码和验证码'));
      return;
    }
    if (password !== confirmPassword) {
      setErr(t('两次输入的密码不一致'));
      return;
    }
    if (password.length < 6) {
      setErr(t('密码至少 6 位'));
      return;
    }
    setErr('');
    setBusy(true);
    try {
      await register(name, email, password, code);
      navigate('/');
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('注册失败'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-background-50">
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary-500/90 via-primary-600/80 to-primary-800/90"></div>
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_60%,rgba(255,255,255,0.1)_0%,transparent_60%)]"></div>
        <div className="relative z-10 flex flex-col justify-center px-16 text-background-50">
          <div className="w-14 h-14 flex items-center justify-center bg-background-50/20 rounded-2xl mb-8">
            <i className="ri-user-add-line text-3xl"></i>
          </div>
          <h1 className="text-4xl font-bold leading-tight mb-4">{t('加入课堂纪要')}</h1>
          <p className="text-lg opacity-90 leading-relaxed max-w-md">
            {t('创建你的账户，开始高效记录每一堂课的精彩内容。')}
          </p>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center px-8">
        <div className="w-full max-w-sm">
          <div className="lg:hidden mb-10 text-center">
            <div className="w-12 h-12 flex items-center justify-center bg-primary-100 rounded-xl mx-auto mb-4">
              <i className="ri-user-add-line text-primary-600 text-2xl"></i>
            </div>
            <h1 className="text-2xl font-bold text-foreground-900">{t('课堂纪要')}</h1>
          </div>

          <div className="mb-8">
            <h2 className="text-xl font-bold text-foreground-900">{t('创建账户')}</h2>
            <p className="text-sm text-foreground-400 mt-1">{t('注册后即可使用全部功能')}</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-foreground-600 mb-1.5">{t('姓名')}</label>
              <div className="relative">
                <div className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center">
                  <i className="ri-user-line text-foreground-400 text-sm"></i>
                </div>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t('你的姓名')}
                  className="w-full pl-10 pr-4 py-2.5 bg-background-100 border border-background-200 rounded-lg text-sm text-foreground-800 placeholder:text-foreground-300 focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100 transition-all"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-foreground-600 mb-1.5">{t('邮箱地址')}</label>
              <div className="relative">
                <div className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center">
                  <i className="ri-mail-line text-foreground-400 text-sm"></i>
                </div>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your@university.edu.cn"
                  className="w-full pl-10 pr-4 py-2.5 bg-background-100 border border-background-200 rounded-lg text-sm text-foreground-800 placeholder:text-foreground-300 focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100 transition-all"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-foreground-600 mb-1.5">{t('密码')}</label>
              <div className="relative">
                <div className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center">
                  <i className="ri-lock-line text-foreground-400 text-sm"></i>
                </div>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t('至少6位密码')}
                  className="w-full pl-10 pr-10 py-2.5 bg-background-100 border border-background-200 rounded-lg text-sm text-foreground-800 placeholder:text-foreground-300 focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100 transition-all"
                  required
                  minLength={6}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center cursor-pointer"
                >
                  <i className={`${showPassword ? 'ri-eye-off-line' : 'ri-eye-line'} text-foreground-400 text-sm`}></i>
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-foreground-600 mb-1.5">{t('确认密码')}</label>
              <div className="relative">
                <div className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center">
                  <i className="ri-lock-line text-foreground-400 text-sm"></i>
                </div>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder={t('再次输入密码')}
                  className={`w-full pl-10 pr-4 py-2.5 bg-background-100 border rounded-lg text-sm text-foreground-800 placeholder:text-foreground-300 focus:outline-none focus:ring-2 transition-all ${
                    confirmPassword && password !== confirmPassword
                      ? 'border-red-300 focus:border-red-400 focus:ring-red-100'
                      : 'border-background-200 focus:border-primary-400 focus:ring-primary-100'
                  }`}
                  required
                />
              </div>
              {confirmPassword && password !== confirmPassword && (
                <p className="text-xs text-red-500 mt-1">{t('两次输入的密码不一致')}</p>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-foreground-600 mb-1.5">{t('邮箱验证码')}</label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <div className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center">
                    <i className="ri-shield-check-line text-foreground-400 text-sm"></i>
                  </div>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder={t('6 位验证码')}
                    className="w-full pl-10 pr-4 py-2.5 bg-background-100 border border-background-200 rounded-lg text-sm tracking-widest text-foreground-800 placeholder:text-foreground-300 placeholder:tracking-normal focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100 transition-all"
                    required
                  />
                </div>
                <button
                  type="button"
                  onClick={handleSendCode}
                  disabled={sending || cooldown > 0 || !emailOk}
                  className="px-3 py-2.5 bg-primary-100 text-primary-700 rounded-lg text-xs font-semibold hover:bg-primary-200 transition-colors cursor-pointer whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
                >
                  {sending ? t('发送中…') : cooldown > 0 ? t('{n}s 后重发', { n: cooldown }) : t('发送验证码')}
                </button>
              </div>
              <p className="text-[11px] text-foreground-400 mt-1">{t('验证码将发送至上方填写的邮箱,10 分钟内有效。')}</p>
            </div>

            {info && (
              <p className="text-sm text-primary-600 bg-primary-50 border border-primary-200 rounded-lg px-3 py-2">
                {info}
              </p>
            )}
            {err && (
              <p className="text-sm text-red-500 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {err}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full py-2.5 bg-primary-500 text-background-50 rounded-lg text-sm font-semibold hover:bg-primary-600 transition-colors cursor-pointer whitespace-nowrap disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {busy ? t('注册中…') : t('注册')}
            </button>

            <p className="text-center text-sm text-foreground-400">
              {t('已有账户？')}{' '}
              <Link to="/login" className="text-primary-600 font-medium hover:text-primary-700">
                {t('立即登录')}
              </Link>
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
