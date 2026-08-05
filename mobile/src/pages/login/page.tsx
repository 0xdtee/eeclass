import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { apiFetch, getServerUrl } from '@/lib/api';

export default function LoginPage() {
  const navigate = useNavigate();
  const { login, error: authError } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [serverStatus, setServerStatus] = useState<'checking' | 'online' | 'offline'>('checking');
  const [serverMsg, setServerMsg] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        const data = await apiFetch<{ ok?: boolean; error?: string }>('/health');
        if (!cancelled) {
          if (data.error) {
            setServerStatus('offline');
            setServerMsg(data.error);
          } else {
            setServerStatus('online');
            setServerMsg('');
          }
        }
      } catch (e) {
        if (!cancelled) {
          setServerStatus('offline');
          setServerMsg(e instanceof Error ? e.message : '无法连接');
        }
      }
    }
    check();
    return () => { cancelled = true; };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    setLoading(true);
    setError('');
    const ok = await login(email, password);
    setLoading(false);
    if (ok) {
      navigate('/');
    } else {
      setError(authError || '登录失败');
    }
  };

  const handleOfflineMode = () => {
    try {
      localStorage.setItem('eeclass_offline', '1');
      localStorage.setItem('eeclass_user', JSON.stringify({ name: '访客', email: 'guest@local', role: 'student' }));
    } catch { /* ignore */ }
    window.location.href = '/';
  };

  const handleGoConfig = () => {
    navigate('/server-config');
  };

  const currentUrl = getServerUrl();

  return (
    <div className="min-h-screen bg-background-50 flex">
      {/* Left brand panel — iPad only */}
      <div className="hidden md:flex md:w-[45%] bg-accent-500 flex-col items-center justify-center px-10 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-accent-500/80 via-accent-500 to-accent-600/90"></div>
        <div className="relative z-10 text-center">
          <div className="w-20 h-20 flex items-center justify-center bg-background-50/20 backdrop-blur rounded-3xl mx-auto mb-6">
            <i className="ri-book-open-line text-background-50 text-3xl"></i>
          </div>
          <h1 className="text-2xl lg:text-3xl font-bold text-background-50 mb-3">课堂纪要</h1>
          <p className="text-sm lg:text-base text-background-50/80 max-w-xs mx-auto leading-relaxed">
            实时语音转写 · AI 摘要 · 闪卡复习 · 板书截屏
          </p>
          <div className="flex items-center gap-4 justify-center mt-8">
            <div className="text-center">
              <p className="text-2xl font-bold text-background-50">86K+</p>
              <p className="text-xs text-background-50/60">活跃用户</p>
            </div>
            <div className="w-px h-8 bg-background-50/20"></div>
            <div className="text-center">
              <p className="text-2xl font-bold text-background-50">12K+</p>
              <p className="text-xs text-background-50/60">日均课时</p>
            </div>
          </div>
        </div>
        {/* Decorative circles */}
        <div className="absolute -bottom-20 -right-20 w-64 h-64 rounded-full bg-background-50/5"></div>
        <div className="absolute -top-16 -left-16 w-48 h-48 rounded-full bg-background-50/5"></div>
      </div>

      {/* Right form panel */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm md:max-w-md">
          {/* Mobile logo */}
          <div className="mb-6 text-center md:hidden">
            <div className="w-14 h-14 flex items-center justify-center bg-accent-100 rounded-2xl mx-auto mb-4">
              <i className="ri-book-open-line text-accent-600 text-2xl"></i>
            </div>
            <h1 className="text-xl font-bold text-foreground-900">课堂纪要</h1>
          </div>

          {/* iPad form title */}
          <div className="hidden md:block mb-8">
            <p className="text-xs text-foreground-400 uppercase tracking-wider font-medium">欢迎回来</p>
            <h2 className="text-xl font-bold text-foreground-900 mt-1">登录到你的账户</h2>
          </div>

          <p className="text-sm text-foreground-400 mb-6 md:hidden">登录到你的账户</p>

          {/* Server status banner */}
          {serverStatus === 'checking' && (
            <div className="flex items-center gap-2 px-4 py-3 mb-4 bg-background-100 border border-background-200 rounded-xl text-sm text-foreground-500">
              <i className="ri-loader-4-line animate-spin text-accent-500"></i>
              正在检测后端连接…
            </div>
          )}

          {serverStatus === 'offline' && (
            <div className="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-xl">
              <div className="flex items-start gap-2.5">
                <div className="w-5 h-5 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <i className="ri-error-warning-line text-amber-600 text-lg"></i>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-amber-800">服务器未连接</p>
                  <p className="text-xs text-amber-600 mt-1">{serverMsg}</p>
                  <p className="text-xs text-amber-500 mt-1">当前地址：{currentUrl}</p>
                  <div className="flex flex-col gap-2 mt-3">
                    <button
                      onClick={handleGoConfig}
                      className="w-full py-2.5 bg-accent-500 text-background-50 rounded-lg text-xs font-medium hover:bg-accent-600 transition-colors cursor-pointer whitespace-nowrap"
                    >
                      <span className="flex items-center justify-center gap-1.5">
                        <i className="ri-settings-3-line"></i>
                        配置服务器地址
                      </span>
                    </button>
                    <button
                      onClick={handleOfflineMode}
                      className="w-full py-2.5 bg-background-100 border border-background-200 text-foreground-600 rounded-lg text-xs font-medium hover:bg-background-200 transition-colors cursor-pointer whitespace-nowrap"
                    >
                      <span className="flex items-center justify-center gap-1.5">
                        <i className="ri-eye-line"></i>
                        离线体验（浏览界面效果）
                      </span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {serverStatus === 'online' && (
            <div className="flex items-center gap-2 px-4 py-2.5 mb-4 bg-accent-50 border border-accent-200 rounded-xl text-sm text-accent-700">
              <i className="ri-wifi-line text-accent-500"></i>
              后端已连接 · {currentUrl}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4 md:space-y-5">
            <div>
              <label className="block text-xs font-medium text-foreground-600 mb-1.5">邮箱地址</label>
              <div className="relative">
                <div className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center">
                  <i className="ri-mail-line text-foreground-400 text-sm"></i>
                </div>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setError(''); }}
                  placeholder="your@university.edu.cn"
                  className="w-full pl-10 pr-4 py-3 md:py-3.5 bg-background-100 border border-background-200 rounded-xl text-sm text-foreground-800 placeholder:text-foreground-300 focus:outline-none focus:border-accent-400 focus:ring-2 focus:ring-accent-100 transition-all"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-foreground-600 mb-1.5">密码</label>
              <div className="relative">
                <div className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center">
                  <i className="ri-lock-line text-foreground-400 text-sm"></i>
                </div>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setError(''); }}
                  placeholder="输入密码"
                  className="w-full pl-10 pr-10 py-3 md:py-3.5 bg-background-100 border border-background-200 rounded-xl text-sm text-foreground-800 placeholder:text-foreground-300 focus:outline-none focus:border-accent-400 focus:ring-2 focus:ring-accent-100 transition-all"
                  required
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

            {error && (
              <div className="flex items-center gap-2 px-3 py-2.5 bg-red-50 border border-red-200 rounded-xl text-xs text-red-600">
                <i className="ri-error-warning-line"></i>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || serverStatus === 'offline'}
              className="w-full py-3 md:py-3.5 bg-accent-500 text-background-50 rounded-xl text-sm font-semibold hover:bg-accent-600 transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <i className="ri-loader-4-line animate-spin"></i>
                  登录中…
                </span>
              ) : (
                '登录'
              )
              }
            </button>

            <p className="text-center text-sm text-foreground-400">
              还没有账户？{' '}
              <button
                type="button"
                onClick={() => navigate('/register')}
                className="text-accent-600 font-medium hover:text-accent-700 cursor-pointer"
              >
                立即注册
              </button>
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}