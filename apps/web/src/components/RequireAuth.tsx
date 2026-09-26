import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth';

/** Account-owned pages redirect a signed-out visitor to /login instead of rendering. */
export function RequireAuth() {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <p className="muted auth-loading">Checking your session…</p>;
  if (!user) {
    const next = encodeURIComponent(`${location.pathname}${location.search}`);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  return <Outlet />;
}
