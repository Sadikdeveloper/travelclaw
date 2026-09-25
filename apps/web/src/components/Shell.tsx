import type { HealthReport, SessionRecord } from '@travelclaw/shared';
import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useLiveRevision } from '../App';
import { api } from '../api';

export function Shell() {
  const revision = useLiveRevision();
  const [health, setHealth] = useState<HealthReport | null>(null);
  const [down, setDown] = useState(false);
  const [sessions, setSessions] = useState<SessionRecord[]>([]);

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
    api<SessionRecord[]>('/api/sessions')
      .then(setSessions)
      .catch(() => setSessions([]));
  }, [revision]);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <img src="/mark.svg" alt="" />
          <div>
            <strong>TravelClaw</strong>
            <em>Your chats</em>
          </div>
        </div>
        <NavLink to="/" end className="btn side-new">
          New chat
        </NavLink>
        <nav className="nav chat-scroll" aria-label="Your chats">
          {sessions.length === 0 ? <p className="side-empty">No chats yet.</p> : null}
          {sessions.map((session) => (
            <NavLink key={session.id} to={`/chat/${session.id}`}>
              {session.title}
            </NavLink>
          ))}
        </nav>
        <div className="side-foot">
          <div>
            <span className={down ? 'dot bad' : 'dot ok'} />
            {down ? 'Gateway quiet' : 'Gateway up'}
          </div>
          <p className="account-note">
            Sign-in is next. Email first, then Google. Until then, chats stay on this desk.
          </p>
          <div>{health ? health.version : 'checking'}</div>
        </div>
      </aside>
      <main className="canvas">
        <Outlet />
      </main>
    </div>
  );
}
