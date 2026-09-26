import type { HealthReport, SessionRecord } from '@travelclaw/shared';
import {
  Brain,
  Luggage,
  MessageCircle,
  Plus,
  Search,
  Sparkles,
  Users,
  Wrench,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useLiveRevision } from '../App';
import { api } from '../api';
import { useAuth } from '../auth';
import { mirrorGuestSessions } from '../guestChatCache';

const TIP_DISMISSED_KEY = 'travelclaw:tipDismissed';

const primaryNav = [
  { to: '/', end: true, label: 'Chat', icon: MessageCircle },
  { to: '/trips', end: false, label: 'Trips', icon: Luggage },
  { to: '/tools', end: false, label: 'Tools', icon: Wrench },
  { to: '/memory', end: false, label: 'Memory', icon: Brain },
  { to: '/agents', end: false, label: 'Agents', icon: Users },
];

export function Shell() {
  const revision = useLiveRevision();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [health, setHealth] = useState<HealthReport | null>(null);
  const [down, setDown] = useState(false);
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [signingOut, setSigningOut] = useState(false);
  const [query, setQuery] = useState('');
  const [tipDismissed, setTipDismissed] = useState(
    () => window.localStorage.getItem(TIP_DISMISSED_KEY) === '1',
  );

  useEffect(() => {
    let stop = false;
    const load = () => {
      api<HealthReport>('/health')
        .then((report) => {
          if (stop) return;
          setHealth(report);
          setDown(false);
        })
        .catch(() => {
          if (!stop) setDown(true);
        });
    };
    load();
    const timer = window.setInterval(load, 30_000);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (user?.isGuest) {
      // Instant paint from this device's own cache while the network round trip is
      // still in flight — a guest's chats otherwise have nowhere else to come from.
      setSessions(mirrorGuestSessions(user.id));
    }
    api<SessionRecord[]>('/api/sessions')
      .then((fetched) => {
        setSessions(fetched);
        if (user?.isGuest) mirrorGuestSessions(user.id, fetched);
      })
      .catch(() => setSessions([]));
  }, [revision, user]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((session) => session.title.toLowerCase().includes(q));
  }, [sessions, query]);

  function dismissTip() {
    setTipDismissed(true);
    window.localStorage.setItem(TIP_DISMISSED_KEY, '1');
  }

  async function signOut() {
    setSigningOut(true);
    try {
      await logout();
      navigate('/login', { replace: true });
    } finally {
      setSigningOut(false);
    }
  }

  const initial = (user?.displayName || '?').trim().charAt(0).toUpperCase();

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <img src="/mark.svg" alt="" />
          <div>
            <strong>TravelClaw</strong>
            <em>Travel desk</em>
          </div>
        </div>

        <NavLink to="/" end className="btn side-new">
          <Plus size={16} aria-hidden="true" />
          New chat
        </NavLink>

        <nav className="nav primary-nav" aria-label="Desk">
          {primaryNav.map(({ to, end, label, icon: Icon }) => (
            <NavLink key={to} to={to} end={end}>
              <Icon size={16} aria-hidden="true" />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="side-section chats-section">
          <div className="side-section-head">
            <span>Chats</span>
          </div>
          {sessions.length > 3 ? (
            <label className="side-search">
              <Search size={14} aria-hidden="true" />
              <input
                type="search"
                placeholder="Search chats"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
          ) : null}
          <nav className="nav chat-scroll" aria-label="Your chats">
            {filtered.length === 0 ? (
              <p className="side-empty">
                {sessions.length === 0 ? 'No chats yet.' : 'No chats match that search.'}
              </p>
            ) : null}
            {filtered.map((session) => (
              <NavLink key={session.id} to={`/chat/${session.id}`}>
                {session.title}
              </NavLink>
            ))}
          </nav>
        </div>

        {tipDismissed ? null : (
          <div className="tip-card">
            <Sparkles size={16} aria-hidden="true" />
            <p>Ask for a flight, a hotel, or both. Nothing books until you say so.</p>
            <button
              type="button"
              className="tip-dismiss"
              aria-label="Dismiss tip"
              onClick={dismissTip}
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        )}

        <div className="side-foot">
          <div className="gateway-status">
            <span className={down ? 'dot bad' : 'dot ok'} />
            {down ? 'Gateway quiet' : 'Gateway up'}
          </div>
          {user?.isGuest ? (
            <div className="account-box account-box-guest">
              <div className="account-row">
                <span className="avatar avatar-guest" aria-hidden="true">
                  ?
                </span>
                <div className="account-name">Browsing as a guest</div>
              </div>
              <p className="muted account-guest-note">
                Chats stay on this device. Sign in to keep them anywhere.
              </p>
              <div className="row account-guest-actions">
                <Link className="btn-ghost" to="/login">
                  Sign in
                </Link>
                <Link className="btn copper" to="/register">
                  Sign up
                </Link>
              </div>
            </div>
          ) : user ? (
            <div className="account-box">
              <div className="account-row">
                <span className="avatar" aria-hidden="true">
                  {initial}
                </span>
                <div className="account-name" title={user.email}>
                  {user.displayName}
                </div>
              </div>
              <button
                className="btn-ghost account-signout"
                type="button"
                disabled={signingOut}
                onClick={() => void signOut()}
              >
                {signingOut ? 'Signing out…' : 'Sign out'}
              </button>
            </div>
          ) : null}
          <div className="side-version">{health ? health.version : 'checking'}</div>
        </div>
      </aside>
      <main className="canvas">
        <Outlet />
      </main>
    </div>
  );
}
