import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth';

/**
 * A visitor is bootstrapped into a guest session automatically (see auth.tsx), so this
 * almost always just renders its children — guest or real account, both count. It only
 * redirects to /login when that bootstrap itself failed (e.g. the gateway is down or
 * every request from this browser is being rate-limited), which a plain sign-in retries.
 */
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
