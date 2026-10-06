import type { HealthReport, SessionRecord } from '@travelclaw/shared';
import {
  Menu,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useLiveRevision } from '../App';
import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import { forgetGuestMessages, mirrorGuestSessions } from '../guestChatCache';

export function Shell() {
  const revision = useLiveRevision();
  const { user, logout } = useAuth();
  // Keyed by id, not by the account object: a refreshed session must not tear down the
  // live socket or refetch the chat list, or a failing request can feed itself.
  const userId = user?.id;
  const userIsGuest = user?.isGuest === true;
  const navigate = useNavigate();
  const location = useLocation();
  const [health, setHealth] = useState<HealthReport | null>(null);
  const [down, setDown] = useState(false);
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [signingOut, setSigningOut] = useState(false);
  const [deletingSessionId, setDeletingSessionId] = useState('');
  const [sessionError, setSessionError] = useState('');
  const [query, setQuery] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarCollapsed);
  const deletedSessionIds = useRef(new Set<string>());

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
    try {
      window.localStorage.setItem(
        'travelclaw:sidebar-collapsed',
        sidebarCollapsed ? '1' : '0',
      );
    } catch {
      // The preference is optional when storage is disabled.
    }
  }, [sidebarCollapsed]);

  useEffect(() => {
    deletedSessionIds.current.clear();
  }, [userId]);

  useEffect(() => {
    if (userId && userIsGuest) {
      // Instant paint from this device's own cache while the network round trip is
      // still in flight — a guest's chats otherwise have nowhere else to come from.
      setSessions(
        mirrorGuestSessions(userId).filter(
          (session) => !deletedSessionIds.current.has(session.id),
        ),
      );
    }
    api<SessionRecord[]>('/api/sessions')
      .then((fetched) => {
        const visible = fetched.filter(
          (session) => !deletedSessionIds.current.has(session.id),
        );
        setSessions(visible);
        if (userId && userIsGuest) mirrorGuestSessions(userId, visible);
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

  async function deleteChat(session: SessionRecord) {
    if (deletingSessionId) return;
    const confirmed = window.confirm(
      `Delete “${session.title}”? This permanently removes the chat and its history.`,
    );
    if (!confirmed) return;

    setSessionError('');
    setDeletingSessionId(session.id);
    deletedSessionIds.current.add(session.id);
    try {
      await api<void>(`/api/sessions/${session.id}`, { method: 'DELETE' });
      const remaining = sessions.filter((item) => item.id !== session.id);
      setSessions(remaining);
      if (userId && userIsGuest) {
        mirrorGuestSessions(userId, remaining);
        forgetGuestMessages(userId, session.id);
      }
      if (location.pathname === `/chat/${session.id}`) {
        navigate('/', { replace: true });
      }
    } catch (err) {
      deletedSessionIds.current.delete(session.id);
      setSessionError(
        err instanceof ApiError
          ? err.message
          : 'Could not delete this chat. Please try again.',
      );
      const refreshed = await api<SessionRecord[]>('/api/sessions').catch(() => null);
      if (refreshed) {
        setSessions(refreshed);
        if (userId && userIsGuest) mirrorGuestSessions(userId, refreshed);
      }
    } finally {
      setDeletingSessionId('');
    }
  }

  const initial = (user?.displayName || '?').trim().charAt(0).toUpperCase();

  return (
    <div className={sidebarCollapsed ? 'shell sidebar-collapsed' : 'shell'}>
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
            <em>Agent mode</em>
          </div>
          <button
            type="button"
            className="sidebar-toggle"
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
          >
            {sidebarCollapsed ? (
              <PanelLeftOpen size={17} aria-hidden="true" />
            ) : (
              <PanelLeftClose size={17} aria-hidden="true" />
            )}
          </button>
        </div>

        <NavLink
          to="/"
          end
          className="btn side-new"
          onClick={() => setMenuOpen(false)}
          title="New chat"
        >
          <Plus size={16} aria-hidden="true" />
          <span>New chat</span>
        </NavLink>

        <div className="side-section chats-section">
          <div className="side-section-head chat-section-head">
            <span>Chats</span>
          </div>
          <button
            type="button"
            className="sidebar-rail-action"
            aria-label="Expand sidebar to see chats"
            title="Show chats"
            onClick={() => setSidebarCollapsed(false)}
          >
            <MessageSquare size={18} aria-hidden="true" />
          </button>
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
          {sessionError ? (
            <p className="side-error" role="alert">
              {sessionError}
            </p>
          ) : null}
          <nav className="nav chat-scroll" aria-label="Your chats">
            {filtered.length === 0 ? (
              <p className="side-empty">
                {sessions.length === 0 ? 'No chats yet.' : 'No chats match that search.'}
              </p>
            ) : null}
            {filtered.map((session) => (
              <div className="chat-list-item" key={session.id}>
                <NavLink
                  className="chat-link"
                  to={`/chat/${session.id}`}
                  onClick={() => setMenuOpen(false)}
                  title={session.title}
                >
                  <span>{session.title}</span>
                </NavLink>
                <button
                  type="button"
                  className="chat-delete"
                  aria-label={`Delete chat: ${session.title}`}
                  title="Delete chat"
                  disabled={Boolean(deletingSessionId)}
                  onClick={() => void deleteChat(session)}
                >
                  {deletingSessionId === session.id ? (
                    <span className="delete-spinner" aria-hidden="true" />
                  ) : (
                    <Trash2 size={14} aria-hidden="true" />
                  )}
                </button>
              </div>
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

function readSidebarCollapsed(): boolean {
  try {
    return window.localStorage.getItem('travelclaw:sidebar-collapsed') === '1';
  } catch {
    return false;
  }
}
