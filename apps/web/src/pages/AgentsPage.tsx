import type { AgentRecord, WorkspaceFiles } from '@travelclaw/shared';
import { Compass } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError } from '../api';
import { Banner } from '../components/Status';

export function AgentsPage() {
  const [agents, setAgents] = useState<AgentRecord[]>([]);
  const [files, setFiles] = useState<WorkspaceFiles | null>(null);
  const [userFile, setUserFile] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [form, setForm] = useState({ name: '', role: 'Specialist', description: '' });

  useEffect(() => {
    Promise.all([api<AgentRecord[]>('/api/agents'), api<WorkspaceFiles>('/api/workspace')])
      .then(([list, workspace]) => {
        setAgents(list);
        setFiles(workspace);
        setUserFile(workspace.user);
      })
      .catch((err: unknown) =>
        setError(err instanceof ApiError ? err.message : 'Could not load agents'),
      );
  }, []);

  async function saveUser(event: FormEvent) {
    event.preventDefault();
    setSaved(false);
    const next = await api<WorkspaceFiles>('/api/workspace', {
      method: 'PATCH',
      body: JSON.stringify({ file: 'USER.md', content: userFile }),
    });
    setFiles(next);
    setSaved(true);
  }

  async function createAgent(event: FormEvent) {
    event.preventDefault();
    setError('');
    try {
      const created = await api<AgentRecord>('/api/agents', {
        method: 'POST',
        body: JSON.stringify({
          name: form.name,
          role: form.role,
          description: form.description,
          emoji: 'compass',
        }),
      });
      setAgents((current) => [...current, created]);
      setForm({ name: '', role: 'Specialist', description: '' });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add that agent');
    }
  }

  return (
    <section>
      <p className="kicker">Agents</p>
      <h1>One desk, a named voice.</h1>
      <p className="lede">
        Extra agents share the workspace files for now. Per-agent folders are the next
        split, on purpose, so persona edits stay visible.
      </p>
      {error ? <Banner message={error} tone="bad" /> : null}
      <div className="card-grid" style={{ marginTop: 18 }}>
        {agents.map((agent) => (
          <article key={agent.id} className="card">
            <div className="row">
              <Compass size={18} aria-hidden="true" />
              <h3>
                {agent.name} {agent.isDefault ? '· default' : ''}
              </h3>
            </div>
            <p>{agent.role}</p>
            <p className="muted">{agent.description}</p>
            <div className="mono">{agent.id}</div>
          </article>
        ))}
      </div>
      <div className="grid-2" style={{ marginTop: 22 }}>
        <article className="panel">
          <h2>Soul</h2>
          <pre className="manuscript">{files?.soul || 'Loading…'}</pre>
        </article>
        <form className="panel form" onSubmit={saveUser}>
          <h2>Traveler file</h2>
          <label className="field">
            <span>USER.md</span>
            <textarea
              value={userFile}
              onChange={(event) => setUserFile(event.target.value)}
            />
          </label>
          <button className="btn" type="submit">
            Save traveler file
          </button>
          {saved ? <p className="muted">Saved. The next turn will read it.</p> : null}
        </form>
      </div>
      <form className="panel form" style={{ marginTop: 16 }} onSubmit={createAgent}>
        <h2>Add an agent row</h2>
        <div className="split">
          <label className="field">
            <span>Name</span>
            <input
              required
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
          </label>
          <label className="field">
            <span>Role</span>
            <input
              required
              value={form.role}
              onChange={(event) => setForm({ ...form, role: event.target.value })}
            />
          </label>
        </div>
        <label className="field">
          <span>Description</span>
          <input
            required
            value={form.description}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
          />
        </label>
        <button className="btn-ghost" type="submit">
          Add agent
        </button>
      </form>
    </section>
  );
}
