import type { HealthReport } from '@travelclaw/shared';
import { BookOpen, Compass, Map, MessageSquare, Sparkles, UserRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { api } from '../api';

const links = [
  { to: '/', label: 'Desk', icon: Compass, end: true },
  { to: '/chat', label: 'Chat', icon: MessageSquare, end: false },
  { to: '/trips', label: 'Trips', icon: Map, end: false },
  { to: '/skills', label: 'Skills', icon: Sparkles, end: false },
  { to: '/memory', label: 'Memory', icon: BookOpen, end: false },
  { to: '/agents', label: 'Agents', icon: UserRound, end: false },
];

export function Shell() {
  const [health, setHealth] = useState<HealthReport | null>(null);
  const [down, setDown] = useState(false);

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

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <img src="/mark.svg" alt="" />
          <div>
            <strong>TravelClaw</strong>
            <em>Field desk</em>
          </div>
        </div>
        <nav className="nav" aria-label="Desk">
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.end}
              className={({ isActive }) => (isActive ? 'active' : '')}
            >
              <link.icon size={16} aria-hidden="true" />
              {link.label}
            </NavLink>
          ))}
        </nav>
        <div className="side-foot">
          <div>
            <span className={down ? 'dot bad' : 'dot ok'} />
            {down ? 'Gateway quiet' : 'Gateway up'}
          </div>
          <div>{health ? `${health.model.provider} · ${health.version}` : 'checking'}</div>
          <a href="/docs" target="_blank" rel="noreferrer">
            API docs
          </a>
        </div>
      </aside>
      <main className="canvas">
        <Outlet />
      </main>
    </div>
  );
}
