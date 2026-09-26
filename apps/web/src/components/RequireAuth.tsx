import { useState } from 'react';
import { Link, Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth, type AuthProblem } from '../auth';
import { Banner } from './Status';

/**
 * A visitor is bootstrapped into a guest session automatically (see auth.tsx), so this
 * almost always just renders its children — guest or real account, both count. Signing in
 * is optional on this desk, so a failed bootstrap is never answered with a sign-in page:
 * it renders the reason and a retry. `/login` is still one link away for someone who
 * actually has an account.
 */
export function RequireAuth() {
  const { user, loading, problem, refresh } = useAuth();
  const location = useLocation();

  if (loading && !user) return <p className="muted auth-loading">Checking your session…</p>;
  if (!user && problem) return <SessionNotice problem={problem} onRetry={refresh} />;
  if (!user) {
    const next = encodeURIComponent(`${location.pathname}${location.search}`);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  return <Outlet />;
}

function SessionNotice({
  problem,
  onRetry,
}: {
  problem: AuthProblem;
  onRetry: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const paced = problem.kind === 'rate_limited';

  return (
    <section className="auth-page">
      <div className="auth-card">
        <p className="kicker">TravelClaw</p>
        <h1>
          {paced
            ? 'The desk is not starting a new guest session yet'
            : 'The gateway is not answering'}
        </h1>
        <p className="lede">
          {paced
            ? 'You do not need an account to chat here. The gateway is pacing how fast new guest sessions start from one address, and this browser just caught the limit.'
            : 'Chat runs on the local gateway. Nothing is lost — this page only needs a retry.'}
        </p>
        <Banner message={problem.message} tone="bad" />
        <div className="row session-notice-actions">
          <button
            className="btn copper"
            type="button"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void onRetry().finally(() => setBusy(false));
            }}
          >
            {busy ? 'Trying…' : 'Try again'}
          </button>
          {paced ? (
            <Link className="btn-ghost" to="/login">
              Sign in instead
            </Link>
          ) : null}
        </div>
      </div>
    </section>
  );
}
