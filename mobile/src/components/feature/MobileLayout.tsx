import { useLocation, useNavigate, Outlet } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';

const navItems = [
  { path: '/', icon: 'ri-home-5-line', activeIcon: 'ri-home-5-fill', label: '首页' },
  { path: '/courses', icon: 'ri-book-2-line', activeIcon: 'ri-book-2-fill', label: '课程' },
  { path: '/record', icon: 'ri-mic-line', activeIcon: 'ri-mic-fill', label: '录音', isPrimary: true },
  { path: '/study', icon: 'ri-brain-line', activeIcon: 'ri-brain-fill', label: '复习' },
  { path: '/profile', icon: 'ri-user-line', activeIcon: 'ri-user-fill', label: '我的' },
];

export default function MobileLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, isAuthenticated, isOffline, logout } = useAuth();

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  // ========== iPad Sidebar ==========
  const renderSidebar = () => (
    <aside className="hidden md:flex flex-col w-[220px] h-full bg-background-50 border-r border-background-200 flex-shrink-0 safe-top overflow-y-auto">
      {/* App Brand */}
      <div className="px-5 pt-6 pb-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 flex items-center justify-center bg-accent-100 rounded-xl">
            <i className="ri-book-open-line text-accent-600 text-lg"></i>
          </div>
          <div>
            <h1 className="text-sm font-bold text-foreground-900 leading-tight">课堂纪要</h1>
            <p className="text-[10px] text-foreground-400">2026 秋季学期</p>
          </div>
        </div>
      </div>

      {/* Nav Links */}
      <nav className="flex-1 px-3 space-y-0.5">
        {navItems.map((item) => {
          const active = isActive(item.path);
          return (
            <button
              key={item.path}
              onClick={() => {
                if (!isAuthenticated && item.path !== '/') {
                  navigate('/login');
                  return;
                }
                navigate(item.path);
              }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all cursor-pointer whitespace-nowrap ${
                active
                  ? 'bg-accent-100 text-accent-700'
                  : 'text-foreground-600 hover:bg-background-100 hover:text-foreground-800'
              } ${item.isPrimary ? 'ring-1 ring-accent-200' : ''}`}
            >
              <div className={`w-5 h-5 flex items-center justify-center`}>
                <i className={`${active ? item.activeIcon : item.icon} text-base ${item.isPrimary && !active ? 'text-accent-500' : ''}`}></i>
              </div>
              <span>{item.label}</span>
              {item.isPrimary && (
                <span className="ml-auto w-1.5 h-1.5 rounded-full bg-accent-500"></span>
              )}
            </button>
          );
        })}
      </nav>

      {/* User Section */}
      <div className="px-3 pb-4">
        <div className="border-t border-background-200 pt-3">
          {user ? (
            <div className="flex items-center gap-2.5 px-3 py-2">
              <div className="w-8 h-8 flex items-center justify-center bg-accent-100 rounded-full flex-shrink-0">
                <i className={`${user.role === 'teacher' ? 'ri-user-star-line' : 'ri-user-line'} text-accent-600 text-sm`}></i>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-foreground-800 truncate">{user.name}</p>
                <p className="text-[10px] text-foreground-400 truncate">{user.role === 'teacher' ? '教师' : user.role === 'admin' ? '管理员' : '学生'}</p>
              </div>
            </div>
          ) : (
            <button
              onClick={() => navigate('/login')}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-foreground-500 hover:bg-background-100 transition-colors cursor-pointer"
            >
              <div className="w-5 h-5 flex items-center justify-center">
                <i className="ri-login-box-line"></i>
              </div>
              <span>登录</span>
            </button>
          )}
          {isOffline && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 mt-1 bg-amber-50 border border-amber-200 rounded-lg mx-1">
              <i className="ri-wifi-off-line text-amber-500 text-[10px]"></i>
              <span className="text-[10px] text-amber-600 font-medium">离线体验</span>
            </div>
          )}
        </div>
      </div>
    </aside>
  );

  // ========== Mobile Bottom Nav ==========
  const renderBottomNav = () => (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-background-50/95 backdrop-blur-md border-t border-background-200">
      <div className="flex items-center justify-around h-16 max-w-lg mx-auto px-2">
        {navItems.map((item) => {
          const active = isActive(item.path);
          if (item.isPrimary) {
            return (
              <button
                key={item.path}
                onClick={() => navigate(item.path)}
                className="relative -top-3 flex flex-col items-center justify-center cursor-pointer"
              >
                <div className={`w-14 h-14 flex items-center justify-center rounded-full shadow-lg transition-all ${
                  active
                    ? 'bg-accent-500 text-background-50 scale-105'
                    : 'bg-accent-500 text-background-50 hover:bg-accent-600'
                }`}>
                  <div className="w-6 h-6 flex items-center justify-center">
                    <i className={`${active ? item.activeIcon : item.icon} text-xl`}></i>
                  </div>
                </div>
                <span className={`text-[10px] mt-0.5 font-medium ${active ? 'text-accent-600' : 'text-foreground-400'}`}>
                  {item.label}
                </span>
              </button>
            );
          }
          return (
            <button
              key={item.path}
              onClick={() => {
                if (!isAuthenticated && item.path !== '/') {
                  navigate('/login');
                  return;
                }
                navigate(item.path);
              }}
              className="flex flex-col items-center justify-center gap-0.5 w-16 h-14 cursor-pointer"
            >
              <div className={`w-6 h-6 flex items-center justify-center transition-colors ${
                active ? 'text-accent-600' : 'text-foreground-400'
              }`}>
                <i className={`${active ? item.activeIcon : item.icon} text-xl`}></i>
              </div>
              <span className={`text-[10px] font-medium ${active ? 'text-accent-600' : 'text-foreground-400'}`}>
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
      <div className="h-safe-area-inset-bottom bg-background-50/95" />
    </nav>
  );

  return (
    <div className="h-screen bg-background-50 flex overflow-hidden">
      {/* 顶部状态栏不透明遮罩:挡住滚动内容,避免露进状态栏那条安全区(inline 保证高度)*/}
      <div className="fixed top-0 left-0 right-0 z-[60] bg-background-50" style={{ height: 'env(safe-area-inset-top)' }}></div>

      {/* Sidebar — iPad only(固定不滚)*/}
      {renderSidebar()}

      {/* Content Area(只有这里滚动)*/}
      <main className="flex-1 h-full overflow-y-auto pb-24 md:pb-0 safe-top">
        <Outlet />
      </main>

      {/* Bottom Nav — Mobile only */}
      {renderBottomNav()}
    </div>
  );
}