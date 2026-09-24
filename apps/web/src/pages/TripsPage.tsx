import type { CreateTripInput, Pace, TripRecord } from '@travelclaw/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api';
import { Banner, StatusTag } from '../components/Status';
import { addDays, formatDate, todayIso } from '../format';

export function TripsPage() {
  const navigate = useNavigate();
  const [trips, setTrips] = useState<TripRecord[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const start = addDays(todayIso(), 30);
  const [form, setForm] = useState({
    destination: '',
    origin: '',
    startDate: start,
    endDate: addDays(start, 4),
    travelers: 1,
    pace: 'steady' as Pace,
    interests: 'food, walking',
    notes: '',
  });

  useEffect(() => {
    api<TripRecord[]>('/api/trips')
      .then(setTrips)
      .catch((err: unknown) =>
        setError(err instanceof ApiError ? err.message : 'Could not load trips'),
      );
  }, []);

  async function createTrip(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError('');
    const body: CreateTripInput = {
      destination: form.destination,
      origin: form.origin || undefined,
      startDate: form.startDate,
      endDate: form.endDate,
      travelers: Number(form.travelers),
      pace: form.pace,
      currency: 'USD',
      interests: form.interests
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
      notes: form.notes || undefined,
    };
    try {
      const trip = await api<TripRecord>('/api/trips', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      navigate(`/trips/${trip.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the trip');
      setSaving(false);
    }
  }

  return (
    <section>
      <div className="page-head">
        <div>
          <p className="kicker">Trips</p>
          <h1>Routes, not reservations.</h1>
        </div>
      </div>
      {error ? <Banner message={error} tone="bad" /> : null}
      <div className="grid-2">
        <div className="card-grid">
          {trips.map((trip) => (
            <Link
              key={trip.id}
              to={`/trips/${trip.id}`}
              className="ticket"
              style={{ textDecoration: 'none' }}
            >
              <div className="top">
                <StatusTag status={trip.status} />
                <div className="destination">{trip.destination}</div>
                <p className="muted">
                  {formatDate(trip.startDate)} – {formatDate(trip.endDate)}
                </p>
              </div>
              <div className="perf" />
              <div className="bottom muted">{trip.title}</div>
            </Link>
          ))}
          {trips.length === 0 ? <p className="muted">No trips yet.</p> : null}
        </div>
        <form className="panel form" onSubmit={createTrip}>
          <h2>New trip</h2>
          <label className="field">
            <span>Destination</span>
            <input
              required
              value={form.destination}
              onChange={(event) => setForm({ ...form, destination: event.target.value })}
            />
          </label>
          <label className="field">
            <span>Origin</span>
            <input
              value={form.origin}
              onChange={(event) => setForm({ ...form, origin: event.target.value })}
            />
          </label>
          <div className="split">
            <label className="field">
              <span>Start</span>
              <input
                type="date"
                required
                value={form.startDate}
                onChange={(event) => setForm({ ...form, startDate: event.target.value })}
              />
            </label>
            <label className="field">
              <span>End</span>
              <input
                type="date"
                required
                value={form.endDate}
                onChange={(event) => setForm({ ...form, endDate: event.target.value })}
              />
            </label>
          </div>
          <div className="split">
            <label className="field">
              <span>Travelers</span>
              <input
                type="number"
                min={1}
                max={12}
                value={form.travelers}
                onChange={(event) =>
                  setForm({ ...form, travelers: Number(event.target.value) })
                }
              />
            </label>
            <label className="field">
              <span>Pace</span>
              <select
                value={form.pace}
                onChange={(event) => setForm({ ...form, pace: event.target.value as Pace })}
              >
                <option value="relaxed">relaxed</option>
                <option value="steady">steady</option>
                <option value="packed">packed</option>
              </select>
            </label>
          </div>
          <label className="field">
            <span>Interests</span>
            <input
              value={form.interests}
              onChange={(event) => setForm({ ...form, interests: event.target.value })}
            />
          </label>
          <label className="field">
            <span>Notes</span>
            <textarea
              value={form.notes}
              onChange={(event) => setForm({ ...form, notes: event.target.value })}
            />
          </label>
          <button className="btn" type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Create trip'}
          </button>
        </form>
      </div>
    </section>
  );
}
