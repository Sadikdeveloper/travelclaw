import type { BrowserRunRecord } from '@travelclaw/shared';
import { formatWhen } from '../format';

/**
 * What the observed page exposes, in the traveler's words.
 *
 * The values describe the page and nothing else, so the copy is careful not to
 * imply an outcome: `reachable` says this run was allowed to reach a
 * passenger-details step, not that anything was filled or reserved.
 */
const eligibilityCopy: Record<
  BrowserRunRecord['observations'][number]['bookingEligibility'],
  string
> = {
  no_booking_step_seen: 'Page observed · no booking step seen here',
  booking_step_blocked:
    'Page observed · a booking step exists here but this run is not authorized for it',
  booking_step_reachable:
    'Page observed · this run was authorized to reach a booking step. Nothing was submitted',
};

export function BrowserResearch({
  run,
  onStop,
  onApproveBooking,
  onRevokeBooking,
  busy,
}: {
  run: BrowserRunRecord;
  onStop: () => void;
  onApproveBooking: () => void;
  onRevokeBooking: () => void;
  busy?: boolean;
}) {
  /**
   * The worker stopped at a passenger-details step and said so. That is the only
   * moment an approval is offered: it names the site, states that payment never
   * happens here, and gives a way out that is not a refusal of the whole search.
   */
  const askingApproval = run.reason === 'confirmation_required' && !!run.siteId;
  const bookingLive = !!run.booking && run.status === 'running';
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
      {askingApproval ? (
        <section
          className="browser-approval"
          aria-label={`Approve filling your details on ${run.siteName || run.siteId}`}
        >
          <h4>
            The browser reached a passenger-details step on {run.siteName || run.siteId}
          </h4>
          <p>
            Approving lets it fill{' '}
            <strong>only the details you already stated in this chat</strong> — names,
            contact email and phone. It will not invent a value, and it stops before any
            payment step.
          </p>
          <p className="provider-offers-note">
            TravelClaw never takes payment. Checkout stays with {run.siteName || run.siteId}
            , and this approval covers one run on this site only.
          </p>
          <div className="browser-approval-actions">
            <button
              className="btn copper"
              type="button"
              disabled={busy}
              onClick={onApproveBooking}
            >
              Approve and fill my details
            </button>
            <button className="btn-ghost" type="button" disabled={busy} onClick={onStop}>
              No — I&apos;ll continue at the source
            </button>
          </div>
        </section>
      ) : null}
      {bookingLive ? (
        <button
          className="btn-ghost"
          type="button"
          disabled={busy}
          onClick={onRevokeBooking}
        >
          Withdraw approval and stop
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
            <span className="offer-state">
              {eligibilityCopy[observation.bookingEligibility]}
            </span>
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
