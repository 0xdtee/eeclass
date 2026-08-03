import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';

export default function RegisterPage() {
  const navigate = useNavigate();
  const { register } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [invite, setInvite] = useState('');
  const [role, setRole] = useState<'teacher' | 'student'>('student');
  const [showPassword, setShowPassword] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!name || !email || !password) return;
    if (password !== confirmPassword) {
      setErr('两次输入的密码不一致');
      return;
    }
    if (password.length < 6) {
      setErr('密码至少 6 位');
      return;
    }
    setErr('');
    setBusy(true);
    try {
      await register(name, email, password, role, invite);
      navigate('/');
    } catch (e) {
      setErr(e instanceof Error ? e.message : '注册失败');
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
          <h1 className="text-4xl font-bold leading-tight mb-4">加入课堂纪要</h1>
          <p className="text-lg opacity-90 leading-relaxed max-w-md">
            创建你的账户，开始高效记录每一堂课的精彩内容。支持教师和学生两种角色。
          </p>
          <div className="mt-10 p-6 bg-background-50/10 rounded-xl border border-background-50/15">
            <p className="text-sm font-semibold mb-2">角色说明</p>
            <div className="space-y-2 text-sm opacity-85">
              <p><strong>教师</strong> — 创建课程、录制课堂、生成摘要并共享给学生</p>
              <p><strong>学生</strong> — 查看共享的课程纪要、评论互动、导出学习资料</p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center px-8">
        <div className="w-full max-w-sm">
          <div className="lg:hidden mb-10 text-center">
            <div className="w-12 h-12 flex items-center justify-center bg-primary-100 rounded-xl mx-auto mb-4">
              <i className="ri-user-add-line text-primary-600 text-2xl"></i>
            </div>
            <h1 className="text-2xl font-bold text-foreground-900">课堂纪要</h1>
          </div>

          <div className="mb-8">
            <h2 className="text-xl font-bold text-foreground-900">创建账户</h2>
            <p className="text-sm text-foreground-400 mt-1">注册后即可使用全部功能</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="flex bg-background-100 rounded-xl p-1">
              <button
                type="button"
                onClick={() => setRole('student')}
                className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all cursor-pointer whitespace-nowrap ${
                  role === 'student'
                    ? 'bg-background-50 text-foreground-900'
                    : 'text-foreground-400 hover:text-foreground-600'
                }`}
              >
                <i className="ri-user-line mr-1.5"></i>学生
              </button>
              <button
                type="button"
                onClick={() => setRole('teacher')}
                className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all cursor-pointer whitespace-nowrap ${
                  role === 'teacher'
                    ? 'bg-background-50 text-foreground-900'
                    : 'text-foreground-400 hover:text-foreground-600'
                }`}
              >
                <i className="ri-user-star-line mr-1.5"></i>教师
              </button>
            </div>

            <div>
              <label className="block text-xs font-medium text-foreground-600 mb-1.5">姓名</label>
              <div className="relative">
                <div className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center">
                  <i className="ri-user-line text-foreground-400 text-sm"></i>
                </div>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="你的姓名"
                  className="w-full pl-10 pr-4 py-2.5 bg-background-100 border border-background-200 rounded-lg text-sm text-foreground-800 placeholder:text-foreground-300 focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100 transition-all"
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
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your@university.edu.cn"
                  className="w-full pl-10 pr-4 py-2.5 bg-background-100 border border-background-200 rounded-lg text-sm text-foreground-800 placeholder:text-foreground-300 focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100 transition-all"
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
                  placeholder="至少6位密码"
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
              <label className="block text-xs font-medium text-foreground-600 mb-1.5">确认密码</label>
              <div className="relative">
                <div className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center">
                  <i className="ri-lock-line text-foreground-400 text-sm"></i>
                </div>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="再次输入密码"
                  className={`w-full pl-10 pr-4 py-2.5 bg-background-100 border rounded-lg text-sm text-foreground-800 placeholder:text-foreground-300 focus:outline-none focus:ring-2 transition-all ${
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
              <label className="block text-xs font-medium text-foreground-600 mb-1.5">邀请码</label>
              <div className="relative">
                <div className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center">
                  <i className="ri-ticket-2-line text-foreground-400 text-sm"></i>
                </div>
                <input
                  type="text"
                  value={invite}
                  onChange={(e) => setInvite(e.target.value)}
                  placeholder="向管理员索取邀请码"
                  className="w-full pl-10 pr-4 py-2.5 bg-background-100 border border-background-200 rounded-lg text-sm text-foreground-800 placeholder:text-foreground-300 focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100 transition-all"
                  required
                />
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
              className="w-full py-2.5 bg-primary-500 text-background-50 rounded-lg text-sm font-semibold hover:bg-primary-600 transition-colors cursor-pointer whitespace-nowrap disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {busy ? '注册中…' : '注册'}
            </button>

            <p className="text-center text-sm text-foreground-400">
              已有账户？{' '}
              <Link to="/login" className="text-primary-600 font-medium hover:text-primary-700">
                立即登录
              </Link>
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}