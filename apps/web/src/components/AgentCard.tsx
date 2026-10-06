import type { AgentTaskRecord, OfferRecord } from '@travelclaw/shared';
import { Building2, Clock3, Hotel, Plane } from 'lucide-react';
import { BrowserResearch } from './BrowserResearch';
import { formatWhen } from '../format';
import { offerRow } from '../offerDisplay';

const label: Record<AgentTaskRecord['status'], string> = {
  working: 'Searching',
  awaiting: 'Needs your input',
  completed: 'Search finished',
  accepted: 'Complete',
  rejected: 'Sent back',
};

/**
 * A desk this message woke, as it moves: working, then waiting on the traveler's
 * call. Provider offers, if any, are shown separately from the desk's brief; an
 * offer does not become a hold until the traveler asks and the provider confirms.
 */
export function AgentCard({
  task,
  holdingOfferId,
  onHold,
  onStopBrowser,
}: {
  task: AgentTaskRecord;
  holdingOfferId: string;
  onHold: (offerId: string) => void;
  onStopBrowser: () => void;
}) {
  const Icon = task.kind === 'flight' ? Plane : Hotel;
  const offers = task.offers ?? [];
  return (
    <article className="agent-card" aria-live="polite">
      <header>
        <span className="agent-card-name">
          <span className="agent-card-icon" aria-hidden="true">
            <Icon size={14} />
          </span>
          {task.agentName}
        </span>
        <span className={task.status === 'working' ? 'status-chip working' : 'status-chip'}>
          {task.status === 'working' ? <span className="pulse" aria-hidden="true" /> : null}
          {label[task.status]}
        </span>
      </header>
      <p>
        {task.status === 'working' ? 'Working on it. Nothing is booked.' : task.summary}
      </p>
      {offers.length ? (
        <section className="provider-offers" aria-label={`${task.agentName} offers`}>
          <h3>
            {task.kind === 'flight' ? 'Flight options' : 'Places to stay'}
            <span className="provider-offers-count">
              {offers.length} {offers.length === 1 ? 'offer' : 'offers'}
            </span>
          </h3>
          <p className="provider-offers-note">
            Offers, not bookings. Prices and availability may change; nothing is purchased
            here.
          </p>
          {offers.map((offer) => (
            <ProviderOffer
              key={offer.id}
              offer={offer}
              busy={holdingOfferId === offer.id}
              onHold={() => onHold(offer.id)}
            />
          ))}
        </section>
      ) : null}
      {task.browser ? <BrowserResearch run={task.browser} onStop={onStopBrowser} /> : null}
      {task.status === 'awaiting' ? (
        <p className="agent-card-followup">
          Reply in chat with the requested detail or a change. The desk will not repeat this
          search until there is a new request to run.
        </p>
      ) : null}
    </article>
  );
}

/**
 * One offer as a row: who, where, when, how long, how much. Facts the source sent
 * are laid out as columns — the same numbers, just readable — and a source that
 * sent only prose keeps its sentence. The hold state and the hold ask stay on the
 * row, because an offer the traveler cannot act on is only half the answer.
 */
function ProviderOffer({
  offer,
  busy,
  onHold,
}: {
  offer: OfferRecord;
  busy: boolean;
  onHold: () => void;
}) {
  const price = new Intl.NumberFormat('en', { maximumFractionDigits: 3 }).format(
    offer.totalAmount,
  );
  const held = offer.hold === 'confirmed';
  const row = offerRow(offer);
  const Icon = offer.kind === 'flight' ? Plane : Building2;
  return (
    <article className="provider-offer">
      <div className="offer-row">
        <span className="offer-row-icon" aria-hidden="true">
          <Icon size={15} />
        </span>
        <div className="offer-row-body">
          <p className="offer-row-lead">
            <strong>{row?.lead ?? offer.title}</strong>
            {row?.qualifier ? <span className="offer-route">{row.qualifier}</span> : null}
          </p>
          {row?.when ? <p className="offer-row-when">{row.when}</p> : null}
          {row?.facts ? <p className="offer-row-facts">{row.facts}</p> : null}
          {!row && offer.detail ? <p className="offer-row-detail">{offer.detail}</p> : null}
        </div>
        <div className="offer-row-price">
          <strong>
            {offer.currency} {price}
          </strong>
          <span className={held ? 'offer-state confirmed' : 'offer-state'}>
            {held ? 'Hold confirmed by provider' : 'Offer · no hold confirmed'}
          </span>
        </div>
      </div>
      <p className="provider-offer-meta">
        {offer.provider} · retrieved {formatWhen(offer.retrievedAt)}
      </p>
      {held ? (
        <p className="provider-offer-hold" role="status">
          {offer.holdRef ? `Reference ${offer.holdRef}. ` : ''}
          {offer.holdExpiresAt ? `Until ${offer.holdExpiresAt}. ` : ''}
          Nothing was purchased.
        </p>
      ) : (
        <>
          {offer.holdNote ? (
            <p className="provider-offer-hold" role="status">
              {offer.holdNote}
            </p>
          ) : null}
          {offer.holdSupport === 'unsupported' ? (
            // The source quotes prices and has no hold endpoint. A button here
            // would promise an action the vendor cannot perform.
            <p className="provider-offer-hold" role="status">
              This source quotes prices and does not hold them. Book it with the airline,
              the hotel, or an agent. Nothing is purchased here.
            </p>
          ) : (
            <div className="provider-offer-actions">
              <button type="button" className="btn-ghost" disabled={busy} onClick={onHold}>
                <Clock3 size={14} aria-hidden="true" />
                {busy ? 'Asking provider…' : 'Ask provider to hold'}
              </button>
              <span>Nothing will be purchased.</span>
            </div>
          )}
        </>
      )}
    </article>
  );
}
