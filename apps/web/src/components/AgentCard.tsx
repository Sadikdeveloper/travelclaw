import type { AgentTaskRecord, OfferRecord, TaskDecision } from '@travelclaw/shared';
import { Check, Clock3, Hotel, Plane, Undo2 } from 'lucide-react';
import { formatWhen } from '../format';

const label: Record<AgentTaskRecord['status'], string> = {
  working: 'Working',
  awaiting: 'Ready for you',
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
  busy,
  holdingOfferId,
  onDecide,
  onHold,
}: {
  task: AgentTaskRecord;
  busy: boolean;
  holdingOfferId: string;
  onDecide: (decision: TaskDecision) => void;
  onHold: (offerId: string) => void;
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
          <h3>Provider offers</h3>
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
      {task.status === 'awaiting' ? (
        <div className="row agent-card-actions">
          <button
            className="btn copper"
            type="button"
            disabled={busy}
            onClick={() => onDecide('complete')}
          >
            <Check size={15} aria-hidden="true" />
            Yes, complete
          </button>
          <button
            className="btn-ghost"
            type="button"
            disabled={busy}
            onClick={() => onDecide('no')}
          >
            No
          </button>
          <button
            className="btn-ghost"
            type="button"
            disabled={busy}
            onClick={() => onDecide('still_working')}
          >
            <Undo2 size={14} aria-hidden="true" />
            Still working
          </button>
        </div>
      ) : null}
    </article>
  );
}

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
  return (
    <article className="provider-offer">
      <header className="provider-offer-head">
        <strong>{offer.title}</strong>
        <span className={held ? 'offer-state confirmed' : 'offer-state'}>
          {held ? 'Hold confirmed by provider' : 'Offer · no hold confirmed'}
        </span>
      </header>
      <p className="provider-offer-price">
        {offer.currency} {price}
      </p>
      {offer.detail ? <p className="provider-offer-detail">{offer.detail}</p> : null}
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
          <div className="provider-offer-actions">
            <button type="button" className="btn-ghost" disabled={busy} onClick={onHold}>
              <Clock3 size={14} aria-hidden="true" />
              {busy ? 'Asking provider…' : 'Ask provider to hold'}
            </button>
            <span>Nothing will be purchased.</span>
          </div>
        </>
      )}
    </article>
  );
}
