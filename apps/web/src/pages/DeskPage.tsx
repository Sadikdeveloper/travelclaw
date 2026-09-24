import type { DeskSnapshot, HeartbeatRecord } from '@travelclaw/shared';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveRevision } from '../App';
import { api, ApiError } from '../api';
import { Banner, StatusTag } from '../components/Status';
import { formatDate, formatWhen } from '../format';

export function DeskPage() {
  const revision = useLiveRevision();
  const [desk, setDesk] = useState<DeskSnapshot | null>(null);
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);

  useEffect(() => {
    let stop = false;
    api<DeskSnapshot>('/api/desk')
      .then((snapshot) => {
        if (!stop) setDesk(snapshot);
      })
      .catch((err: unknown) => {
        if (!stop)
          setError(err instanceof ApiError ? err.message : 'Gateway is not answering.');
      });
    return () => {
      stop = true;
    };
  }, [revision]);

  async function runHeartbeat(job: HeartbeatRecord) {
    setRunning(true);
    try {
      await api(`/api/heartbeats/${job.id}/run`, { method: 'POST' });
      const snapshot = await api<DeskSnapshot>('/api/desk');
      setDesk(snapshot);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Heartbeat failed');
    } finally {
      setRunning(false);
    }
  }

  if (error && !desk) return <Banner message={error} tone="bad" />;
  if (!desk) return <p className="muted">Opening the desk…</p>;

  const openTrips = desk.trips.filter((trip) => trip.status !== 'done');
  const next = openTrips[0];
  const beat = desk.heartbeats[0];

  return (
    <section>
      <p className="kicker">Gateway</p>
      <h1>The desk is open.</h1>
      <p className="lede">
        {desk.agent.name} keeps the trip, the memory, and webchat in one process. Nothing on
        this desk is a booking.
      </p>
      {error ? <Banner message={error} tone="bad" /> : null}
      <div className="grid-stats">
        <article className="card stat">
          <span>Open trips</span>
          <strong>{openTrips.length}</strong>
        </article>
        <article className="card stat">
          <span>Sessions</span>
          <strong>{desk.sessions.length}</strong>
        </article>
        <article className="card stat">
          <span>Skills</span>
          <strong>{desk.skills.length}</strong>
        </article>
        <article className="card stat">
          <span>Memory</span>
          <strong>{desk.memoryCount}</strong>
        </article>
      </div>
      <div className="grid-2">
        <article className="ticket">
          <div className="top">
            <div className="row">
              <span className="kicker" style={{ margin: 0 }}>
                Next departure
              </span>
              {next ? <StatusTag status={next.status} /> : null}
            </div>
            {next ? (
              <>
                <div className="destination">{next.destination}</div>
                <p className="muted">
                  {formatDate(next.startDate)} – {formatDate(next.endDate)} ·{' '}
                  {next.travelers} traveler{next.travelers === 1 ? '' : 's'} · {next.pace}
                </p>
              </>
            ) : (
              <p>No open trip. Add one when you have a city and two dates.</p>
            )}
          </div>
          <div className="perf" />
          <div className="bottom row">
            {next ? (
              <Link className="btn" to={`/trips/${next.id}`}>
                Open trip
              </Link>
            ) : (
              <Link className="btn" to="/trips">
                New trip
              </Link>
            )}
            <Link className="btn-ghost" to="/chat">
              Ask {desk.agent.name}
            </Link>
          </div>
        </article>
        <article className="panel">
          <h2>Heartbeat</h2>
          {beat ? (
            <>
              <p className="muted">
                {beat.name} · every {beat.every}
              </p>
              <p>{beat.lastResult || 'Has not run yet.'}</p>
              <p className="mono">last {formatWhen(beat.lastRunAt)}</p>
              <button
                className="btn-ghost"
                type="button"
                disabled={running}
                onClick={() => runHeartbeat(beat)}
              >
                {running ? 'Running…' : 'Run now'}
              </button>
            </>
          ) : (
            <p>No jobs seeded.</p>
          )}
          <h3 style={{ marginTop: 18 }}>Channels</h3>
          <ul className="list">
            {desk.channels.map((channel) => (
              <li key={channel.id} className="row">
                <StatusTag status={channel.status} />
                <span>{channel.label}</span>
              </li>
            ))}
          </ul>
        </article>
      </div>
      <h2 style={{ marginTop: 28 }}>Recent chats</h2>
      <ul className="list">
        {desk.sessions.length === 0 ? <li className="muted">No sessions yet.</li> : null}
        {desk.sessions.slice(0, 5).map((session) => (
          <li key={session.id}>
            <Link to={`/chat/${session.id}`}>
              <strong>{session.title}</strong>
              <div className="mono">{session.key}</div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
