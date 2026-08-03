import { useAuth } from '@/hooks/useAuth';
import DashboardHome from '@/pages/dashboard/page';
import LandingPage from '@/pages/landing/page';

export default function AuthGate() {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background-50">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-accent-500 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-sm text-foreground-400">加载中...</p>
        </div>
      </div>
    );
  }

  return isAuthenticated ? <DashboardHome /> : <LandingPage />;
}