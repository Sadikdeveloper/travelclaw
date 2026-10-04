import type { BrowserRunRecord } from '@travelclaw/shared';
import { formatWhen } from '../format';

export function BrowserResearch({
  run,
  onStop,
}: {
  run: BrowserRunRecord;
  onStop: () => void;
}) {
  return (
    <section className="provider-offers browser-research" aria-label="Browser research">
      <h3>Website research · {run.status === 'running' ? 'in progress' : run.status}</h3>
      <p role="status">{run.message}</p>
      {run.reason ? (
        <p className="provider-offers-note">Reason: {run.reason.replaceAll('_', ' ')}</p>
      ) : null}
      {run.status === 'running' ? (
        <button className="btn-ghost" type="button" onClick={onStop}>
          Stop browser search
        </button>
      ) : null}
      {run.steps.length ? (
        <details>
          <summary>{run.steps.length} browser steps</summary>
          <ol>
            {run.steps.map((step, i) => (
              <li key={i}>
                {step.action.replace('browser_', '')} · {step.status} ·{' '}
                {formatWhen(step.at)}
              </li>
            ))}
          </ol>
        </details>
      ) : null}
      {run.observations.map((observation) => (
        <article className="provider-offer" key={observation.snapshotId}>
          <header className="provider-offer-head">
            <strong>{observation.title}</strong>
            <span className="offer-state">Page observed · not bookable here</span>
          </header>
          <p className="provider-offer-price">
            {observation.displayedPrice}{' '}
            <small>Currency shown: {observation.displayedCurrency}</small>
          </p>
          <p className="provider-offer-meta">
            {observation.sourceName} · observed {formatWhen(observation.observedAt)}
          </p>
          {observation.visibleConditions.length ? (
            <ul>
              {observation.visibleConditions.map((condition, i) => (
                <li key={i}>{condition}</li>
              ))}
            </ul>
          ) : (
            <p>No conditions captured. This does not mean there are no restrictions.</p>
          )}
          <details>
            <summary>Visible page evidence</summary>
            <blockquote>{observation.evidence}</blockquote>
          </details>
          <p className="provider-offers-note">
            Not a provider-confirmed offer or hold. Conditions may be incomplete;
            availability and the checkout price can change. Verify with the source before
            proceeding.
          </p>
        </article>
      ))}
      {run.sourceUrl && /^https?:\/\//i.test(run.sourceUrl) ? (
        <p>
          <a href={run.sourceUrl} target="_blank" rel="noopener noreferrer">
            Open source to verify or continue yourself ↗
          </a>
        </p>
      ) : null}
      {run.status === 'handoff' ? (
        <p className="provider-offers-note">
          This opens the source in your own browser, not the worker session. Do not paste
          passwords or verification codes into chat.
        </p>
      ) : null}
    </section>
  );
}
