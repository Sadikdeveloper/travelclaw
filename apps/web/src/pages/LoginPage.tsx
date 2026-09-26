import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import { Banner } from '../components/Status';
import { GoogleButton } from '../components/GoogleButton';
import { clearGuestCache } from '../guestChatCache';
import type { UserRecord } from '@travelclaw/shared';

export function LoginPage() {
  const { setUser, googleClientId, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const next = new URLSearchParams(location.search).get('next') || '/';

  useEffect(() => {
    // A guest is not "signed in" for this purpose — it must still be able to reach this
    // form. Only bounce away once a real account is present.
    if (user && !user.isGuest) navigate(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  function onSignedIn(account: UserRecord) {
    // This browser's cached guest chats have either moved server-side onto `account`
    // already, or belonged to a different guest that just got left behind — either
    // way, the local mirror for that old guest id is no longer useful.
    if (user?.isGuest) clearGuestCache(user.id);
    setUser(account);
    navigate(next, { replace: true });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const account = await api<UserRecord>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      onSignedIn(account);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sign in');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="auth-page">
      <div className="auth-card">
        <p className="kicker">TravelClaw</p>
        <h1>Sign in</h1>
        <p className="lede">
          Your chats live on this account. Sign in to see them
          {user?.isGuest ? ' — any chat you started as a guest moves over too' : ''}.
        </p>
        {error ? <Banner message={error} tone="bad" /> : null}
        <form className="form" onSubmit={submit}>
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <button className="btn copper" type="submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        {googleClientId ? (
          <div className="auth-divider">
            <span>or</span>
          </div>
        ) : null}
        <GoogleButton
          clientId={googleClientId}
          onSignedIn={onSignedIn}
          onError={setError}
        />
        <p className="muted auth-switch">
          New here? <Link to={`/register${location.search}`}>Create an account</Link>
        </p>
      </div>
    </section>
  );
}
