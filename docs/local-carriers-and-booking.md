# Local carriers and the booking lifecycle

Status: **carrier directory and SerpApi booking links are built and tested. The
booking lifecycle, email/calendar, and payment watch below are design, not
code.** Read [provider adapters](provider-adapters.md) and
[browser agent](browser-agent.md) first; this page is about the gap between "a
fare source quoted a price" and "the traveler is on a plane".

The question that started this: _book a flight from Kaduna to Lagos, where only
Rano Air flies, prefill it on their site, reserve it before payment, then follow
the airline's email and my calendar until the human pays._

That is five separate capabilities with five very different levels of risk, and
the desk's rules land differently on each. This page separates them so each one
can be built or refused on its own merits.

## What was wrong before

Two concrete gaps, both real:

1. **A fare source cannot see a thin domestic network well.** Google Flights
   covers Kaduna–Lagos thinly and returns availability with no seller link for
   it, so the desk had nothing to hand over even when the answer ("Rano Air,
   direct, six days a week") was knowable.
2. **The `serpapi` adapter was throwing the booking link away.** SerpApi's
   `google_flights` engine returns a `booking_token` per itinerary, and a second
   request with that token returns `booking_options` — the actual sellers and
   their links. The adapter read the token and dropped it, so every SerpApi offer
   arrived with `bookingUrl: null`. That is why international fares showed
   availability and no way to book.

## Built: the carrier directory (`airlines.find`)

`packages/agent-core/src/airlines.ts` holds a hand-kept table of carriers and the
few routes the desk has seen them fly, and `airlines.find` is the tool that reads
it.

What a row carries: identity (name, IATA where certain, country, hubs), where to
book (site, phone, OTA), **how the carrier sequences payment**, what it publishes
about managing a booking reference, and the date a human last checked the row.

The payment-order field is the reason this table earns its keep. It is what
decides whether an agent may complete a booking and leave the payment to the
traveler, or must hand off at the payment step:

| Value            | Meaning                                                                  | Example in the seed data                                                                               |
| ---------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `pnr_then_pay`   | The site issues a booking reference before payment, with a deadline      | Rano Air — its own site documents Manage Bookings and Web Check-in as booking reference + last name    |
| `pay_at_booking` | The ticket is issued as part of payment; there is no unpaid slot to hold | Air Peace — its own FAQ says the booking reference and e-ticket follow completed payment               |
| `unverified`     | Nobody has read this carrier's published terms                           | Everything else in the seed; treated as "assume a handoff", never as permission to claim a reservation |

Two rules keep the table from becoming a liability:

- **Nothing in it is a price or an availability claim.** A listed route says a
  carrier has flown that pair, not that a seat exists on the traveler's date.
  `flights.search` is still the only source of a fare on this desk, and the tool
  says so in its own summary.
- **Absence is not "no service".** An unlisted pair is reported as a gap in a
  hand-kept list, with the country's carriers offered as context and labelled as
  not route proof. A route table that says "nobody flies this" is how an agent
  tells a traveler something false with confidence.

Every row carries `verifiedOn`, and the tool reports how many days old the
oldest row it relied on is, so a stale answer is visibly stale.

### Extending it

Add carriers to `AIRLINES` and pairs to `AIRLINE_ROUTES` in the same file. Set
`paymentOrder` only from the carrier's own published terms and put the source in
`evidence`; otherwise leave it `unverified`. Add the city's airport code to
`DIRECTORY_AIRPORTS` and its aliases to `PLACE_ALIASES`, or the router cannot
read that pair out of a message.

Route resolution has its own quirk worth knowing: the desk's shared hint
extractor resolves a destination only against the editorial destination cards
(`DESTINATIONS`), so a domestic pair with no card reaches the router with an
origin and no destination. `routePairIn` in the directory reads both ends out of
the traveler's own words instead, and refuses a place the table does not know
rather than guessing a code.

## Built: SerpApi booking links

`serpapi.ts` now spends each itinerary's `booking_token` on a second request and
maps the seller's `deeplink` into the offer's existing `bookingUrl`, which the UI
already renders as a book button. Three deliberate limits:

- **Bounded.** One follow-up per itinerary, capped at `MAX_OFFERS_PER_SEARCH`,
  because the rest are dropped anyway. This is one extra vendor request per
  shown offer — a real cost, and the reason it is capped rather than automatic
  for every bundle the engine returns.
- **The token never leaves the adapter.** It is spent and deleted inside
  `attachBookingLinks`. It is not an offer id, a detail, or a click-through, so
  it cannot reach a stored offer, a task row, or a model prompt.
- **A POST-only option is dropped, not passed on.** The vendor sends some options
  as a Google endpoint plus a form body the caller must replay unmodified. The
  desk has no redirect handler, so it hands over a link only when there is a real
  `deeplink`.

And the disclosure does not change: **retrieving booking options neither
purchases nor reserves a ticket**, per the vendor's own documentation, so this
adapter stays `hold: unsupported`. A booking link is a way to reach the seller,
not a seat.

## Not built: the booking lifecycle

This is the part the traveler actually described, and it does not exist yet. The
desk's `offers` table has a `hold` column with two values, `none` and
`confirmed`, which is not enough to describe "Rano Air gave me a PNR that
expires in 24 hours and the traveler has not paid yet".

### What it needs

A `bookings` table beside `offers`, one row per real reservation attempt, with a
state machine the agent can only move along edges it has evidence for:

```
draft → reserved → awaiting_payment → paid → ticketed
                     ↓                    ↓
                  expired              cancelled
```

| State               | Entered only when                                                             |
| ------------------- | ----------------------------------------------------------------------------- |
| `reserved`          | The carrier's own site or API returned a booking reference **and** a deadline |
| `awaiting_payment`  | A reference exists and the deadline has not passed                            |
| `paid` / `ticketed` | An e-ticket number arrived, or the traveler said so — never inferred          |
| `expired`           | The deadline passed with no payment. The reference is gone; say so            |

The rule that matters: **the agent may only write `reserved` from a reference the
carrier actually returned.** A booking form that appeared to submit is not a
reservation. `paymentOrder: unverified` in the directory means the desk hands off
at the payment step instead of assuming a slot can be held.

Payment stays out of scope, as it already is:
`docs/roadmap.md` lists "Taking payment or storing card numbers" as not in scope,
and that does not change. What is new is _watching_ a payment the traveler makes
somewhere else.

### Driving the carrier's site

The browser worker (#25) is the only sanctioned way to reach a site, and today it
is search-only by design: its authorization list refuses checkout, account, and
payment endpoints, it has no signed-in profile, and it cannot upload, download,
or evaluate JavaScript. Booking on a carrier's site needs all of that.

That is a real security step up, not a config change, and it should be its own
design: a separate worker class with no provider keys, an operator-approved
per-site booking script rather than a free-form agent loop, human confirmation
before submit, and no payment page at all — the handoff at payment is the
feature. Until then the honest capability is: name the carrier, open its booking
page with the route and date in the traveler's own browser, and ask for the
booking reference afterwards.

## Not built: email and calendar

There are no email or calendar connector slots. `connectors.service.ts` has
exactly two singleton slots, `currency` and `weather`, plus the flight and stay
search lists, and the desk's own rule is that only code can invent a connector
name.

Two slots would be needed, both scoped as tightly as the browser worker:

- **`email`, read-only.** Search the traveler's mailbox for a confirmation from a
  known carrier sender, read the PNR and the deadline out of it, and stop. No
  send, no delete, no attachments, no other labels. This is what turns "the
  airline will email you" into something the desk can act on.
- **`calendar`, scoped to one calendar.** Create or update the flight event once
  a reference is confirmed. Never read the whole calendar; a travel desk has no
  business knowing what else is in there.

Both hold OAuth tokens for the traveler's own mailbox and calendar, which makes
them the most sensitive credentials in the product. They belong behind the same
operator-gated, per-user consent model as everything else, and neither token
should ever reach a tool result, a log line, or a prompt.

The prompt already forbids the failure mode to avoid here: never claim details
were prefilled or sent when a flow did not confirm it. An email the desk could
not read is "I could not find the confirmation", not a guessed PNR.

## Not built: the payment watch

`heartbeat.service.ts` already runs a per-minute `@Cron` tick over a
`heartbeat_jobs` table with an `every` interval, a prompt, and
`last_run_at`/`next_run_at`. That is the scheduler this needs; it does not need a
new one.

The shape: when a booking enters `awaiting_payment`, insert a job keyed to that
booking. Each tick checks the deadline and the evidence, then either

- closes the booking when an e-ticket arrived or the traveler said it is paid —
  **the traveler telling the desk is sufficient evidence and ends the watch
  immediately**, which is the "if told it is done, no need to follow up" case;
- escalates as the deadline approaches, so the traveler hears about it before the
  reference dies rather than after;
- marks it `expired` when the deadline passes, and says the reference is gone.

Two constraints: the watch must never email or pay on the traveler's behalf, and
it must not poll — one check per interval, bounded, and stopped by the traveler
saying stop.

## Suggested order

1. **Bookings table and state machine.** No new credentials, no new attack
   surface, and it makes every later step auditable. Start by recording what the
   traveler pastes back — a PNR and a deadline — before trying to obtain them.
2. **Payment watch on the existing heartbeat.** Small, uses code that already
   runs, and delivers the "close it when it is paid" behavior the traveler asked
   for.
3. **Read-only email connector.** This is where a PNR starts arriving on its own
   instead of being pasted.
4. **Calendar write.** Genuinely useful and genuinely low-risk once a confirmed
   reference exists.
5. **Browser-driven booking.** Last, because it is the only one that needs a new
   security model rather than a new table.

## A note on where route data should come from

Hand-keeping a route table for every country does not scale and goes stale in
weeks; this desk's table is deliberately a few Nigerian pairs plus carrier
identity. If route and schedule coverage needs to grow, the answer is a schedule
or content API queried at request time, not a bigger seed file — the fast-changing
facts should come from a source that is paid to keep them current, and the
hand-kept table should stay limited to what changes slowly and what no API will
tell you: who the carrier is, where they book, and whether they let a seat be
held before payment.
