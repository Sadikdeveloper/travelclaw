import type { MemoryKind, MemoryRecord } from '@travelclaw/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError } from '../api';
import { Banner } from '../components/Status';
import { formatWhen } from '../format';

export function MemoryPage() {
  const [notes, setNotes] = useState<MemoryRecord[]>([]);
  const [kind, setKind] = useState<MemoryKind>('preference');
  const [body, setBody] = useState('');
  const [error, setError] = useState('');

  async function load() {
    const list = await api<MemoryRecord[]>('/api/memory');
    setNotes(list);
  }

  useEffect(() => {
    load().catch((err: unknown) =>
      setError(err instanceof ApiError ? err.message : 'Could not load memory'),
    );
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    setError('');
    try {
      await api('/api/memory', { method: 'POST', body: JSON.stringify({ kind, body }) });
      setBody('');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not store that note');
    }
  }

  return (
    <section>
      <p className="kicker">Memory</p>
      <h1>What the desk should keep.</h1>
      <p className="lede">
        Preferences stay. One-off logistics can be a fact. The same line is appended to
        MEMORY.md so you can read it outside the UI.
      </p>
      {error ? <Banner message={error} tone="bad" /> : null}
      <div className="grid-2" style={{ marginTop: 18 }}>
        <ul className="list">
          {notes.map((note) => (
            <li key={note.id} className="card">
              <div className="row">
                <span className="tag">{note.kind}</span>
                <span className="mono">{formatWhen(note.createdAt)}</span>
              </div>
              <p>{note.body}</p>
            </li>
          ))}
        </ul>
        <form className="panel form" onSubmit={save}>
          <h2>Remember</h2>
          <label className="field">
            <span>Kind</span>
            <select
              value={kind}
              onChange={(event) => setKind(event.target.value as MemoryKind)}
            >
              <option value="preference">preference</option>
              <option value="fact">fact</option>
              <option value="decision">decision</option>
            </select>
          </label>
          <label className="field">
            <span>Note</span>
            <textarea
              required
              value={body}
              onChange={(event) => setBody(event.target.value)}
            />
          </label>
          <button className="btn" type="submit">
            Store
          </button>
        </form>
      </div>
    </section>
  );
}
