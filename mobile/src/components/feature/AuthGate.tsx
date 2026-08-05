import { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { hasServerUrl } from '@/lib/api';

export default function AuthGate() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated, loading, isOffline } = useAuth();

  useEffect(() => {
    if (loading) return;

    const publicPaths = ['/login', '/register', '/server-config'];
    const isPublic = publicPaths.includes(location.pathname);

    if (!isOffline && !hasServerUrl() && !isPublic) {
      navigate('/server-config', { replace: true });
      return;
    }

    if (!isAuthenticated && !isPublic) {
      navigate('/login', { replace: true });
      return;
    }

    if (isAuthenticated && (location.pathname === '/login' || location.pathname === '/register')) {
      navigate('/', { replace: true });
      return;
    }
  }, [isAuthenticated, loading, isOffline, location.pathname, navigate]);

  return null;
}