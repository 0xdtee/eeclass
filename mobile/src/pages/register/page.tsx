import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';

export default function RegisterPage() {
  const navigate = useNavigate();
  const { register, error: authError } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !email || !password) return;
    if (password !== confirmPassword) {
      setError('两次输入的密码不一致');
      return;
    }
    setLoading(true);
    setError('');
    const ok = await register(name, email, password, inviteCode || undefined);
    setLoading(false);
    if (ok) {
      navigate('/');
    } else {
      setError(authError || '注册失败');
    }
  };

  return (
    <div className="min-h-screen bg-background-50 flex">
      {/* Left brand panel — iPad only */}
      <div className="hidden md:flex md:w-[45%] bg-primary-500 flex-col items-center justify-center px-10 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary-500/80 via-primary-500 to-primary-600/90"></div>
        <div className="relative z-10 text-center">
          <div className="w-20 h-20 flex items-center justify-center bg-background-50/20 backdrop-blur rounded-3xl mx-auto mb-6">
            <i className="ri-user-add-line text-background-50 text-3xl"></i>
          </div>
          <h1 className="text-2xl lg:text-3xl font-bold text-background-50 mb-3">加入课堂纪要</h1>
          <p className="text-sm lg:text-base text-background-50/80 max-w-xs mx-auto leading-relaxed">
            注册后即可使用实时转写、AI 摘要、闪卡复习等全部功能
          </p>
        </div>
        <div className="absolute -bottom-20 -right-20 w-64 h-64 rounded-full bg-background-50/5"></div>
        <div className="absolute -top-16 -left-16 w-48 h-48 rounded-full bg-background-50/5"></div>
      </div>

      {/* Right form panel */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm md:max-w-md">
          {/* Mobile header */}
          <div className="mb-8 text-center md:hidden">
            <div className="w-14 h-14 flex items-center justify-center bg-primary-100 rounded-2xl mx-auto mb-4">
              <i className="ri-user-add-line text-primary-600 text-2xl"></i>
            </div>
            <h1 className="text-xl font-bold text-foreground-900">创建账户</h1>
            <p className="text-sm text-foreground-400 mt-1">注册后即可使用全部功能</p>
          </div>

          {/* iPad form title */}
          <div className="hidden md:block mb-8">
            <p className="text-xs text-foreground-400 uppercase tracking-wider font-medium">新用户</p>
            <h2 className="text-xl font-bold text-foreground-900 mt-1">创建你的账户</h2>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4 md:space-y-5">
            <div>
              <label className="block text-xs font-medium text-foreground-600 mb-1.5">姓名</label>
              <div className="relative">
                <div className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center">
                  <i className="ri-user-line text-foreground-400 text-sm"></i>
                </div>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => { setName(e.target.value); setError(''); }}
                  placeholder="你的姓名"
                  className="w-full pl-10 pr-4 py-3 md:py-3.5 bg-background-100 border border-background-200 rounded-xl text-sm text-foreground-800 placeholder:text-foreground-300 focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100 transition-all"
                  required
                />
              </div>
            </div>

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
                  className="w-full pl-10 pr-4 py-3 md:py-3.5 bg-background-100 border border-background-200 rounded-xl text-sm text-foreground-800 placeholder:text-foreground-300 focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100 transition-all"
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
                  placeholder="至少6位密码"
                  className="w-full pl-10 pr-10 py-3 md:py-3.5 bg-background-100 border border-background-200 rounded-xl text-sm text-foreground-800 placeholder:text-foreground-300 focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100 transition-all"
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
              <label className="block text-xs font-medium text-foreground-600 mb-1.5">确认密码</label>
              <div className="relative">
                <div className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center">
                  <i className="ri-lock-line text-foreground-400 text-sm"></i>
                </div>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => { setConfirmPassword(e.target.value); setError(''); }}
                  placeholder="再次输入密码"
                  className={`w-full pl-10 pr-4 py-3 md:py-3.5 bg-background-100 border rounded-xl text-sm text-foreground-800 placeholder:text-foreground-300 focus:outline-none focus:ring-2 transition-all ${
                    confirmPassword && password !== confirmPassword
                      ? 'border-red-300 focus:border-red-400 focus:ring-red-100'
                      : 'border-background-200 focus:border-primary-400 focus:ring-primary-100'
                  }`}
                  required
                />
              </div>
              {confirmPassword && password !== confirmPassword && (
                <p className="text-xs text-red-500 mt-1">两次输入的密码不一致</p>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-foreground-600 mb-1.5">
                邀请码（可选）
              </label>
              <div className="relative">
                <div className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center">
                  <i className="ri-vip-crown-line text-foreground-400 text-sm"></i>
                </div>
                <input
                  type="text"
                  value={inviteCode}
                  onChange={(e) => { setInviteCode(e.target.value); setError(''); }}
                  placeholder="如有邀请码请填写"
                  className="w-full pl-10 pr-4 py-3 md:py-3.5 bg-background-100 border border-background-200 rounded-xl text-sm text-foreground-800 placeholder:text-foreground-300 focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100 transition-all"
                />
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
              disabled={loading}
              className="w-full py-3 md:py-3.5 bg-primary-500 text-background-50 rounded-xl text-sm font-semibold hover:bg-primary-600 transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <i className="ri-loader-4-line animate-spin"></i>
                  注册中…
                </span>
              ) : (
                '注册'
              )}
            </button>

            <p className="text-center text-sm text-foreground-400">
              已有账户？{' '}
              <button
                type="button"
                onClick={() => navigate('/login')}
                className="text-primary-600 font-medium hover:text-primary-700 cursor-pointer"
              >
                立即登录
              </button>
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}