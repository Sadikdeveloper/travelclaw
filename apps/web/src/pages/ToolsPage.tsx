import type { ToolRecord, ToolRunRecord } from '@travelclaw/shared';
import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { Banner } from '../components/Status';
import { formatWhen } from '../format';

export function ToolsPage() {
  const [tools, setTools] = useState<ToolRecord[]>([]);
  const [runs, setRuns] = useState<ToolRunRecord[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([api<ToolRecord[]>('/api/tools'), api<ToolRunRecord[]>('/api/tools/runs')])
      .then(([catalog, recent]) => {
        setTools(catalog);
        setRuns(recent);
      })
      .catch((err: unknown) =>
        setError(err instanceof ApiError ? err.message : 'Could not load tools'),
      );
  }, []);

  return (
    <section>
      <p className="kicker">Tools</p>
      <h1>What the desk can run.</h1>
      <p className="lede">
        A tool is a function in agent-core. The turn loop picks at most three from the
        traveler's message, runs them, then the reply has to follow those results.
      </p>
      {error ? <Banner message={error} tone="bad" /> : null}
      <div className="card-grid" style={{ marginTop: 18 }}>
        {tools.map((tool) => (
          <article key={tool.name} className="card">
            <h3>{tool.name}</h3>
            <p>{tool.description}</p>
            <div className="row">
              {tool.triggers.map((trigger) => (
                <span key={trigger} className="tag">
                  {trigger}
                </span>
              ))}
            </div>
          </article>
        ))}
      </div>
      <h2 style={{ marginTop: 28 }}>Recent runs</h2>
      <ul className="list">
        {runs.length === 0 ? <li className="muted">No tool has run yet.</li> : null}
        {runs.map((run) => (
          <li key={run.id} className="card">
            <strong>{run.tool}</strong>
            <div>{run.summary}</div>
            <div className="mono">{formatWhen(run.createdAt)}</div>
          </li>
        ))}
      </ul>
    </section>
  );
}
