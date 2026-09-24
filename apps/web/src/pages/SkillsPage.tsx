import type { SkillRecord, SkillRunRecord } from '@travelclaw/shared';
import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { Banner } from '../components/Status';
import { formatWhen } from '../format';

export function SkillsPage() {
  const [skills, setSkills] = useState<SkillRecord[]>([]);
  const [runs, setRuns] = useState<SkillRunRecord[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([
      api<SkillRecord[]>('/api/skills'),
      api<SkillRunRecord[]>('/api/skills/runs'),
    ])
      .then(([catalog, recent]) => {
        setSkills(catalog);
        setRuns(recent);
      })
      .catch((err: unknown) =>
        setError(err instanceof ApiError ? err.message : 'Could not load skills'),
      );
  }, []);

  return (
    <section>
      <p className="kicker">Skills</p>
      <h1>Procedures, then code.</h1>
      <p className="lede">
        A SKILL.md file says when to run. The function in agent-core does the work. Markdown
        never executes.
      </p>
      {error ? <Banner message={error} tone="bad" /> : null}
      <div className="card-grid" style={{ marginTop: 18 }}>
        {skills.map((skill) => (
          <article key={skill.name} className="card">
            <div className="row">
              <h3>{skill.name}</h3>
              <span className={skill.implemented ? 'pill' : 'pill bad'}>
                {skill.implemented ? 'runner' : 'notes only'}
              </span>
            </div>
            <p>{skill.description}</p>
            <div className="row">
              {skill.triggers.map((trigger) => (
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
        {runs.length === 0 ? <li className="muted">No skill has run yet.</li> : null}
        {runs.map((run) => (
          <li key={run.id} className="card">
            <strong>{run.skill}</strong>
            <div>{run.summary}</div>
            <div className="mono">{formatWhen(run.createdAt)}</div>
          </li>
        ))}
      </ul>
    </section>
  );
}
