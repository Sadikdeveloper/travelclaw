import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import { Banner } from '../components/Status';
import { GoogleButton } from '../components/GoogleButton';
import { clearGuestCache } from '../guestChatCache';
import type { AuthSessionResponse, UserRecord } from '@travelclaw/shared';

export function RegisterPage() {
  const { setUser, googleClientId, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
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
    setError('');
    if (password.length < 8) {
      setError('Use at least 8 characters');
      return;
    }
    if (password !== confirm) {
      setError('Those passwords do not match');
      return;
    }
    setBusy(true);
    try {
      const account = await api<AuthSessionResponse>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, password, displayName: displayName || undefined }),
      });
      onSignedIn(account);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create that account');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="auth-page">
      <div className="auth-card">
        <p className="kicker">TravelClaw</p>
        <h1>Create an account</h1>
        <p className="lede">
          Email and a password. Chats you start belong to this account
          {user?.isGuest ? ' — including any chat you already started as a guest' : ''}.
        </p>
        {error ? <Banner message={error} tone="bad" /> : null}
        <form className="form" onSubmit={submit}>
          <label className="field">
            <span>Name (optional)</span>
            <input
              autoComplete="name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </label>
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
              autoComplete="new-password"
              minLength={8}
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <label className="field">
            <span>Confirm password</span>
            <input
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
            />
          </label>
          <button className="btn copper" type="submit" disabled={busy}>
            {busy ? 'Creating…' : 'Create account'}
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
          Already have an account? <Link to={`/login${location.search}`}>Sign in</Link>
        </p>
      </div>
    </section>
  );
}
