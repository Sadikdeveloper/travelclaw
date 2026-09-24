import type { TripRecord, TripStatus } from '@travelclaw/shared';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import { Banner, StatusTag } from '../components/Status';
import { formatDate } from '../format';

const statuses: TripStatus[] = ['draft', 'planning', 'booked', 'traveling', 'done'];

export function TripPage() {
  const { tripId } = useParams();
  const navigate = useNavigate();
  const [trip, setTrip] = useState<TripRecord | null>(null);
  const [error, setError] = useState('');
  const [planning, setPlanning] = useState(false);

  useEffect(() => {
    if (!tripId) return;
    api<TripRecord>(`/api/trips/${tripId}`)
      .then(setTrip)
      .catch((err: unknown) =>
        setError(err instanceof ApiError ? err.message : 'Trip not found'),
      );
  }, [tripId]);

  async function plan() {
    if (!trip) return;
    setPlanning(true);
    setError('');
    try {
      const planned = await api<TripRecord>(`/api/trips/${trip.id}/plan`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setTrip(planned);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not outline this trip');
    } finally {
      setPlanning(false);
    }
  }

  async function setStatus(status: TripStatus) {
    if (!trip) return;
    const updated = await api<TripRecord>(`/api/trips/${trip.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    setTrip(updated);
  }

  async function remove() {
    if (!trip) return;
    if (!window.confirm(`Delete ${trip.title}?`)) return;
    await api(`/api/trips/${trip.id}`, { method: 'DELETE' });
    navigate('/trips');
  }

  if (error && !trip) return <Banner message={error} tone="bad" />;
  if (!trip) return <p className="muted">Fetching the trip…</p>;

  return (
    <section>
      <p className="kicker">
        <Link to="/trips">Trips</Link>
      </p>
      <div className="page-head">
        <div>
          <h1>{trip.destination}</h1>
          <p className="lede">
            {formatDate(trip.startDate)} – {formatDate(trip.endDate)} · {trip.travelers}{' '}
            traveler
            {trip.travelers === 1 ? '' : 's'} · {trip.pace}. Availability was not checked.
          </p>
        </div>
        <div className="row">
          <StatusTag status={trip.status} />
          <label className="field">
            <span className="sr-only">Status</span>
            <select
              value={trip.status}
              onChange={(event) => setStatus(event.target.value as TripStatus)}
            >
              {statuses.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
      {error ? <Banner message={error} tone="bad" /> : null}
      <div className="row" style={{ marginBottom: 16 }}>
        <button className="btn copper" type="button" onClick={plan} disabled={planning}>
          {planning ? 'Outlining…' : 'Plan the days'}
        </button>
        <Link
          className="btn-ghost"
          to={`/chat?draft=${encodeURIComponent(`Tighten the ${trip.destination} trip from ${trip.startDate} to ${trip.endDate}`)}`}
        >
          Ask Marlow
        </Link>
        <button className="btn-ghost" type="button" onClick={remove}>
          Delete
        </button>
      </div>
      {trip.notes ? <p className="muted">{trip.notes}</p> : null}
      <div className="timeline">
        {(trip.days ?? []).length === 0 ? (
          <p className="empty">No days yet. Plan the outline when the dates feel right.</p>
        ) : null}
        {(trip.days ?? []).map((day) => (
          <article key={day.id} className="day">
            <time dateTime={day.date}>{formatDate(day.date)}</time>
            <div>
              <h3>{day.title}</h3>
              <p>{day.summary}</p>
              <ul className="places">
                {day.places.map((place) => (
                  <li key={place}>{place}</li>
                ))}
              </ul>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
