import type { AgentTaskRecord, OfferRecord } from '@travelclaw/shared';
import {
  ArrowUpRight,
  Building2,
  Check,
  Clock3,
  ExternalLink,
  Hotel,
  Plane,
  Star,
} from 'lucide-react';
import { BrowserResearch } from './BrowserResearch';
import { formatWhen } from '../format';
import {
  offerDepartureDate,
  offerDurationLabel,
  offerRow,
  offerTimeLabel,
} from '../offerDisplay';

const label: Record<AgentTaskRecord['status'], string> = {
  working: 'Searching',
  awaiting: 'Needs your input',
  completed: 'Search finished',
  accepted: 'Complete',
  rejected: 'Sent back',
};

/**
 * A desk this message woke, as it moves: working, then ready for the traveler's
 * choice. A source may confirm an unpaid reservation/hold; the card reports that
 * status but never takes payment. Checkout and payment remain with the provider.
 */
export function AgentCard({
  task,
  holdingOfferId,
  selectedOfferId,
  onSelectOffer,
  onHold,
  onStopBrowser,
}: {
  task: AgentTaskRecord;
  holdingOfferId: string;
  selectedOfferId: string | null;
  onSelectOffer: (offerId: string) => void;
  onHold: (offerId: string) => void;
  onStopBrowser: () => void;
}) {
  const Icon = task.kind === 'flight' ? Plane : Hotel;
  const offers = task.offers ?? [];
  const rankedOffers =
    offers.length > 1 && offers.every((offer) => offer.currency === offers[0]?.currency)
      ? [...offers].sort((a, b) => a.totalAmount - b.totalAmount)
      : offers;
  const selectedOffer = rankedOffers.find((offer) => offer.id === selectedOfferId) ?? null;

  return (
    <article className={`agent-card ${task.kind}-task-card`} aria-live="polite">
      <header className="agent-card-head">
        <span className="agent-card-name">
          <span className="agent-card-icon" aria-hidden="true">
            <Icon size={16} />
          </span>
          <span className="agent-card-title">
            <strong>{task.kind === 'flight' ? 'Flight desk' : 'Stay desk'}</strong>
            <small>
              {task.kind === 'flight' ? 'Live fare search' : 'Live room search'}
            </small>
          </span>
        </span>
        <span className={task.status === 'working' ? 'status-chip working' : 'status-chip'}>
          {task.status === 'working' ? <span className="pulse" aria-hidden="true" /> : null}
          {label[task.status]}
        </span>
      </header>

      <p className="agent-card-summary">
        {task.status === 'working'
          ? 'Searching current offers. Nothing is booked.'
          : task.summary}
      </p>

      {rankedOffers.length ? (
        <section className="provider-offers" aria-label={`${task.agentName} offers`}>
          <div className="provider-offers-heading">
            <div>
              <p className="provider-offers-eyebrow">Your shortlist</p>
              <h3>{task.kind === 'flight' ? 'Flight options' : 'Places to stay'}</h3>
            </div>
            <span className="provider-offers-count">
              {rankedOffers.length} {rankedOffers.length === 1 ? 'option' : 'options'}
            </span>
          </div>
          <p className="provider-offers-note">
            Quotes are not reservations. Prices and availability can change before checkout;
            provider-confirmed reservations or holds are labeled below. Payment stays with
            the provider.
          </p>
          <div className="provider-offer-list">
            {rankedOffers.map((offer, index) => (
              <ProviderOffer
                key={offer.id}
                offer={offer}
                index={index}
                isLowest={isLowestInCurrency(offer, rankedOffers)}
                selected={selectedOfferId === offer.id}
                busy={holdingOfferId === offer.id}
                onSelect={() => onSelectOffer(offer.id)}
                onHold={() => onHold(offer.id)}
              />
            ))}
          </div>
          {selectedOffer ? <BookingHandoff offer={selectedOffer} /> : null}
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

function ProviderOffer({
  offer,
  index,
  isLowest,
  selected,
  busy,
  onSelect,
  onHold,
}: {
  offer: OfferRecord;
  index: number;
  isLowest: boolean;
  selected: boolean;
  busy: boolean;
  onSelect: () => void;
  onHold: () => void;
}) {
  const row = offerRow(offer);
  const flightFacts = offer.facts?.kind === 'flight' ? offer.facts : null;
  const stayFacts = offer.facts?.kind === 'stay' ? offer.facts : null;
  const Icon = offer.kind === 'flight' ? Plane : Building2;
  const held = offer.hold === 'confirmed';
  const timeLabel = flightFacts ? offerTimeLabel(flightFacts) : null;
  const [departureTime, arrivalTime] = timeLabel?.split(' → ') ?? [];
  const dateLabel = flightFacts ? offerDepartureDate(flightFacts) : null;

  return (
    <article
      className={`provider-offer ${selected ? 'selected' : ''}`}
      aria-label={`${offer.kind === 'flight' ? 'Flight' : 'Stay'} option ${index + 1}`}
    >
      <div className="fare-option-top">
        <span className="fare-brand-mark" aria-hidden="true">
          <Icon size={18} />
        </span>
        <div className="fare-option-name">
          <strong>{row?.lead ?? offer.title}</strong>
          <span>{row?.qualifier ?? offer.provider}</span>
        </div>
        <div className="fare-price">
          {isLowest ? (
            <span className="lowest-fare">Lowest in {offer.currency}</span>
          ) : null}
          <strong>{formatPrice(offer.totalAmount, offer.currency)}</strong>
          <small>price shown</small>
        </div>
      </div>

      {flightFacts ? (
        <div className="flight-itinerary" aria-label={row?.when ?? 'Flight itinerary'}>
          <div className="flight-endpoint">
            <strong>{departureTime?.replace('+1', '') ?? '—'}</strong>
            <span>{flightFacts.segments[0]?.from ?? 'Origin'}</span>
            <small>&nbsp;</small>
          </div>
          <div className="flight-middle">
            <span className="flight-date-label">{dateLabel ?? 'Itinerary'}</span>
            <div className="flight-track" aria-hidden="true">
              <span />
              <Plane size={14} />
              <span />
            </div>
            <span className="flight-duration">
              {flightFacts.durationMinutes && flightFacts.durationMinutes > 0
                ? offerDurationLabel(flightFacts.durationMinutes)
                : flightFacts.stops === 0
                  ? 'Nonstop'
                  : 'Flight time'}
            </span>
          </div>
          <div className="flight-endpoint arrival">
            <strong>{arrivalTime?.replace('+1', '') ?? '—'}</strong>
            <span>{flightFacts.segments.at(-1)?.to ?? 'Destination'}</span>
            {arrivalTime?.includes('+') ? <small>Next day</small> : <small>&nbsp;</small>}
          </div>
        </div>
      ) : null}

      {stayFacts ? (
        <div className="stay-details">
          <span className="stay-detail-line">
            <Building2 size={14} aria-hidden="true" />
            {stayFacts.roomType ?? 'Stay details'}
          </span>
          {stayFacts.checkIn && stayFacts.checkOut ? (
            <span className="stay-detail-line">
              <Clock3 size={14} aria-hidden="true" />
              {stayFacts.checkIn} → {stayFacts.checkOut}
            </span>
          ) : null}
          {stayFacts.rating !== null ? (
            <span className="stay-detail-line">
              <Star size={14} aria-hidden="true" />
              Rated {stayFacts.rating}
            </span>
          ) : null}
        </div>
      ) : null}

      {!flightFacts && !stayFacts && offer.detail ? (
        <p className="offer-row-detail">{offer.detail}</p>
      ) : null}
      {row?.facts && !stayFacts ? <p className="offer-facts">{row.facts}</p> : null}
      {stayFacts?.nights ? (
        <p className="offer-facts">
          {stayFacts.nights} night{stayFacts.nights === 1 ? '' : 's'}
        </p>
      ) : null}

      <div className="provider-offer-meta">
        <span>{offer.provider}</span>
        <span>Checked {formatWhen(offer.retrievedAt)}</span>
      </div>

      <div className="fare-option-actions">
        <button
          type="button"
          className={selected ? 'fare-select selected' : 'fare-select'}
          aria-pressed={selected}
          onClick={onSelect}
        >
          {selected ? <Check size={15} aria-hidden="true" /> : null}
          {selected ? 'Selected' : 'Choose this option'}
        </button>
        {held ? (
          <span className="offer-state confirmed">Provider reservation confirmed</span>
        ) : offer.holdSupport === 'provider' ? (
          <>
            <span className="offer-state">Quote · no hold confirmed</span>
            <button type="button" className="hold-link" disabled={busy} onClick={onHold}>
              <Clock3 size={14} aria-hidden="true" />
              {busy ? 'Requesting…' : 'Request provider reservation'}
            </button>
          </>
        ) : (
          <span className="offer-state">No hold available</span>
        )}
      </div>
      {held ? (
        <p className="provider-offer-hold" role="status">
          {offer.holdRef ? `Provider reference ${offer.holdRef}. ` : ''}
          {offer.holdExpiresAt ? `Reservation hold expires ${offer.holdExpiresAt}. ` : ''}
          Payment is handled by the provider; TravelClaw has not taken payment.
        </p>
      ) : offer.holdNote ? (
        <p className="provider-offer-hold" role="status">
          {offer.holdNote}
        </p>
      ) : null}
    </article>
  );
}

function BookingHandoff({ offer }: { offer: OfferRecord }) {
  const destination = bookingDestination(offer);
  const direct = Boolean(offer.bookingUrl);
  const held = offer.hold === 'confirmed';

  return (
    <aside className="booking-handoff" aria-live="polite">
      <div className="booking-handoff-heading">
        <span className="booking-check" aria-hidden="true">
          <Check size={16} />
        </span>
        <div>
          <strong>{offer.kind === 'flight' ? 'Flight selected' : 'Stay selected'}</strong>
          <span>
            {formatPrice(offer.totalAmount, offer.currency)} · {offer.provider}
          </span>
        </div>
      </div>
      <p>
        {held
          ? 'The provider confirmed this reservation hold. TravelClaw took no payment; follow the provider’s stated deadline and payment terms.'
          : 'This offer is not reserved yet. Confirm the current price and terms with the provider before completing checkout.'}
      </p>
      <p className="booking-handoff-safe">
        {direct
          ? 'The provider-supplied checkout link is for your selected fare or stay and may prefill the offer. Review the itinerary, traveler details, and payment instructions there; any pay-later option comes from the provider.'
          : 'The source supplied no direct checkout link, so this opens a general search for booking options.'}{' '}
        TravelClaw does not process payment or collect card details.
      </p>
      <div className="booking-handoff-actions">
        <a href={destination.href} target="_blank" rel="noopener noreferrer">
          {direct ? 'Continue booking with provider' : 'Search the web for options'}
          {direct ? (
            <ArrowUpRight size={15} aria-hidden="true" />
          ) : (
            <ExternalLink size={14} aria-hidden="true" />
          )}
        </a>
        {!direct ? (
          <span>
            The source supplied no checkout link; this opens a general web search.
          </span>
        ) : null}
      </div>
    </aside>
  );
}

function bookingDestination(offer: OfferRecord): { href: string } {
  if (offer.bookingUrl) return { href: offer.bookingUrl };
  const facts = offer.facts;
  const query =
    facts?.kind === 'flight'
      ? [
          'flight booking',
          facts.segments[0]?.from,
          facts.segments.at(-1)?.to,
          offerDepartureDate(facts),
          offer.title,
        ]
          .filter(Boolean)
          .join(' ')
      : facts?.kind === 'stay'
        ? [facts.name, facts.checkIn, facts.checkOut, 'booking'].filter(Boolean).join(' ')
        : `${offer.title} ${offer.detail ?? ''} booking`;
  return { href: `https://www.google.com/search?q=${encodeURIComponent(query)}` };
}

function isLowestInCurrency(offer: OfferRecord, offers: OfferRecord[]): boolean {
  return (
    offer.totalAmount ===
    Math.min(
      ...offers
        .filter((item) => item.currency === offer.currency)
        .map((item) => item.totalAmount),
    )
  );
}

function formatPrice(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString('en', { maximumFractionDigits: 2 })}`;
  }
}
