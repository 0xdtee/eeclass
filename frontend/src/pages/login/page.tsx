import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';

export default function LoginPage() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password || busy) return;
    setErr('');
    setBusy(true);
    try {
      await login(email, password);
      navigate('/');
    } catch (e) {
      setErr(e instanceof Error ? e.message : '登录失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-background-50">
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-accent-500/90 via-accent-600/80 to-accent-800/90"></div>
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_40%,rgba(255,255,255,0.1)_0%,transparent_60%)]"></div>
        <div className="relative z-10 flex flex-col justify-center px-16 text-background-50">
          <div className="w-14 h-14 flex items-center justify-center bg-background-50/20 rounded-2xl mb-8">
            <i className="ri-book-open-line text-3xl"></i>
          </div>
          <h1 className="text-4xl font-bold leading-tight mb-4">课堂纪要</h1>
          <p className="text-lg opacity-90 leading-relaxed max-w-md">
            智能录音转写、AI摘要生成、师生共享协作——让每一堂课都留下清晰的印记。
          </p>
          <div className="mt-12 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 flex items-center justify-center bg-background-50/15 rounded-lg">
                <i className="ri-mic-line text-xl"></i>
              </div>
              <div>
                <p className="font-semibold text-sm">实时语音转写</p>
                <p className="text-xs opacity-75">课堂内容即时转换为文字</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 flex items-center justify-center bg-background-50/15 rounded-lg">
                <i className="ri-magic-line text-xl"></i>
              </div>
              <div>
                <p className="font-semibold text-sm">AI智能摘要</p>
                <p className="text-xs opacity-75">一键提取课堂重点知识</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 flex items-center justify-center bg-background-50/15 rounded-lg">
                <i className="ri-share-line text-xl"></i>
              </div>
              <div>
                <p className="font-semibold text-sm">师生共享协作</p>
                <p className="text-xs opacity-75">灵活设置访问与编辑权限</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center px-8">
        <div className="w-full max-w-sm">
          <div className="lg:hidden mb-10 text-center">
            <div className="w-12 h-12 flex items-center justify-center bg-accent-100 rounded-xl mx-auto mb-4">
              <i className="ri-book-open-line text-accent-600 text-2xl"></i>
            </div>
            <h1 className="text-2xl font-bold text-foreground-900">课堂纪要</h1>
          </div>

          <div className="mb-8">
            <h2 className="text-xl font-bold text-foreground-900">欢迎回来</h2>
            <p className="text-sm text-foreground-400 mt-1">登录到你的课堂纪要账户</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-xs font-medium text-foreground-600 mb-1.5">邮箱地址</label>
              <div className="relative">
                <div className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center">
                  <i className="ri-mail-line text-foreground-400 text-sm"></i>
                </div>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your@university.edu.cn"
                  className="w-full pl-10 pr-4 py-2.5 bg-background-100 border border-background-200 rounded-lg text-sm text-foreground-800 placeholder:text-foreground-300 focus:outline-none focus:border-accent-400 focus:ring-2 focus:ring-accent-100 transition-all"
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
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="输入密码"
                  className="w-full pl-10 pr-10 py-2.5 bg-background-100 border border-background-200 rounded-lg text-sm text-foreground-800 placeholder:text-foreground-300 focus:outline-none focus:border-accent-400 focus:ring-2 focus:ring-accent-100 transition-all"
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

            {err && (
              <p className="text-sm text-red-500 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {err}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full py-2.5 bg-accent-500 text-background-50 rounded-lg text-sm font-semibold hover:bg-accent-600 transition-colors cursor-pointer whitespace-nowrap disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {busy ? '登录中…' : '登录'}
            </button>

            <p className="text-center text-sm text-foreground-400">
              还没有账户？{' '}
              <Link to="/register" className="text-accent-600 font-medium hover:text-accent-700">
                立即注册
              </Link>
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}