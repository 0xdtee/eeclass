import { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { hasServerUrl } from '@/lib/api';

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const { isAuthenticated, loading, isOffline } = useAuth();

  useEffect(() => {
    if (loading) return;

    if (!isOffline && !hasServerUrl()) {
      navigate('/server-config', { replace: true });
      return;
    }

    if (!isAuthenticated) {
      navigate('/login', { replace: true });
      return;
    }
  }, [isAuthenticated, loading, isOffline, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background-50 flex items-center justify-center">
        <i className="ri-loader-4-line animate-spin text-accent-500 text-2xl"></i>
      </div>
    );
  }

  if (!isOffline && !hasServerUrl()) {
    return null;
  }

  if (!isAuthenticated) {
    return null;
  }

  return <>{children}</>;
}