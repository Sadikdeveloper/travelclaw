import type { HealthReport, SessionRecord } from '@travelclaw/shared';
import { Menu, Plus, Search, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useLiveRevision } from '../App';
import { api } from '../api';
import { useAuth } from '../auth';
import { mirrorGuestSessions } from '../guestChatCache';

export function Shell() {
  const revision = useLiveRevision();
  const { user, logout } = useAuth();
  // Keyed by id, not by the account object: a refreshed session must not tear down the
  // live socket or refetch the chat list, or a failing request can feed itself.
  const userId = user?.id;
  const userIsGuest = user?.isGuest === true;
  const navigate = useNavigate();
  const [health, setHealth] = useState<HealthReport | null>(null);
  const [down, setDown] = useState(false);
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [signingOut, setSigningOut] = useState(false);
  const [query, setQuery] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);

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
    if (userId && userIsGuest) {
      // Instant paint from this device's own cache while the network round trip is
      // still in flight — a guest's chats otherwise have nowhere else to come from.
      setSessions(mirrorGuestSessions(userId));
    }
    api<SessionRecord[]>('/api/sessions')
      .then((fetched) => {
        setSessions(fetched);
        if (userId && userIsGuest) mirrorGuestSessions(userId, fetched);
      })
      .catch(() => setSessions([]));
  }, [revision, userId, userIsGuest]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((session) => session.title.toLowerCase().includes(q));
  }, [sessions, query]);

  async function signOut() {
    setSigningOut(true);
    try {
      await logout();
      navigate('/login', { replace: true });
    } finally {
      setSigningOut(false);
      setMenuOpen(false);
    }
  }

  const initial = (user?.displayName || '?').trim().charAt(0).toUpperCase();

  return (
    <div className="shell">
      <header className="mobile-topbar">
        <button
          type="button"
          className="mobile-menu-btn"
          aria-label="Open menu"
          onClick={() => setMenuOpen(true)}
        >
          <Menu size={20} aria-hidden="true" />
        </button>
        <div className="mobile-topbar-brand">
          <img src="/mark.svg" alt="" />
          <strong>TravelClaw</strong>
        </div>
        <NavLink to="/" end className="mobile-new" aria-label="New chat">
          <Plus size={18} aria-hidden="true" />
        </NavLink>
      </header>

      {menuOpen ? (
        <button
          type="button"
          className="sidebar-backdrop"
          aria-label="Close menu"
          onClick={() => setMenuOpen(false)}
        />
      ) : null}

      <aside className={menuOpen ? 'sidebar open' : 'sidebar'}>
        <div className="brand">
          <img src="/mark.svg" alt="" />
          <div>
            <strong>TravelClaw</strong>
            <em>Agentic Chat</em>
          </div>
        </div>

        <NavLink to="/" end className="btn side-new" onClick={() => setMenuOpen(false)}>
          <Plus size={16} aria-hidden="true" />
          New chat
        </NavLink>

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
              <NavLink
                key={session.id}
                to={`/chat/${session.id}`}
                onClick={() => setMenuOpen(false)}
              >
                {session.title}
              </NavLink>
            ))}
          </nav>
        </div>

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
                <Link className="btn-ghost" to="/login" onClick={() => setMenuOpen(false)}>
                  Sign in
                </Link>
                <Link
                  className="btn copper"
                  to="/register"
                  onClick={() => setMenuOpen(false)}
                >
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

        <button
          type="button"
          className="sidebar-close"
          aria-label="Close menu"
          onClick={() => setMenuOpen(false)}
        >
          <X size={18} aria-hidden="true" />
        </button>
      </aside>
      <main className="canvas">
        <Outlet />
      </main>
    </div>
  );
}
