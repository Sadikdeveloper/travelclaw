# Provider adapters

A provider adapter translates the desk's own search query into one vendor's API
and maps that vendor's answer back into the desk's offer shape. It is the only
place vendor-specific code lives, so the fan-out, validation, storage, and UI
stay the same no matter who answered.

Read [Flight and stay search](architecture.md#flight-and-stay-search) first for
the operator-facing view. This page is for adding one.

## What an adapter is

```ts
interface ProviderAdapter {
  id: ProviderAdapterId; // 'travelclaw' | 'serpapi' | 'flightapi'
  label: string; // shown when the operator did not name the source
  slots: readonly DeskKind[]; // which searches it can serve
  hold: 'provider' | 'unsupported'; // can the vendor confirm a hold?
  defaultBaseUrl: string | null; // filled into operator config when omitted
  search(input: AdapterSearchInput, ctx: AdapterContext): Promise<AdapterOutcome>;
}
```

`AdapterOutcome` is either a failure (`{ ok: false, reason, detail }`) or a list
of candidates in the desk's field names plus a `dropped` count for entries the
adapter read but would not map.

`providers.ts` calls the adapter, then **revalidates every candidate** with the
same zod schema the operator-hosted contract uses, caps the result at
`MAX_OFFERS_PER_SEARCH`, and only then stores an offer. An adapter's own
confidence therefore proves nothing: it cannot widen what the desk is willing to
show or hold.

One adapter serves both callers of that layer, so a vendor is wired once: the
Flight and Stay desks store what it priced as offers the traveler can hold, and
the `flights.search` / `stays.search` tools hand the same offers to a model turn
to narrate. Neither caller can produce a price the adapter did not return.

### The three rules

1. **A price comes from the vendor or the offer does not exist.** No estimate, no
   conversion, no filling a gap from a desk table.
2. **The key never leaves the server and never enters a string.** Returned
   `detail` text goes through `scrubSecrets` first. A vendor that requires its key
   somewhere other than a header (see [the path-key
   exception](#a-vendor-that-takes-its-key-in-the-url)) gets a contained
   exception, never a logged URL.
3. **Resolution is real data or a refusal.** Turning "Lagos" into `LOS` uses an
   operator alias or the vendor's own lookup. If neither knows the place, the
   adapter fails with `bad_query` and names the place.

## Adding one

1. Write `packages/agent-core/src/adapters/<vendor>.ts` exporting a
   `ProviderAdapter`. Read only what the vendor sent; take the base URL from
   `ctx.credential.baseUrl` via `connectorBase`, and set `defaultBaseUrl` to the
   vendor's documented origin. When the vendor sends structure, keep it: `segments`
   (and `stops`/`durationMinutes`/`stopNames` for flights, `stay` for rooms) reach
   the card as rows instead of a sentence. Pass through only what the payload says
   — a leg's own endpoint may name a stop, an itinerary with several legs may not
   (it can be a round trip), and a missing number stays missing.
2. Register it in `packages/agent-core/src/adapters/index.ts`: one entry in
   `PROVIDER_ADAPTERS` and one line in its `ProviderAdapterId` union
   (`adapters/types.ts`).
3. Decide `hold`. Only a vendor with a real hold or reservation endpoint that
   answers with a reference may be `provider`. Everything else is `unsupported`,
   which the UI and the hold path both respect.
4. Add operator documentation to `.env.example` and the adapter table in
   `docs/architecture.md#built-in-adapters`.
5. Test it with a stubbed `fetch`, both for a good payload and for the failure
   the vendor actually returns: a body that is not JSON, an HTTP error, a timeout,
   a `401`, a payload with no price, and an error body that echoes the key.

Config parsing fails startup when an adapter is unknown or cannot serve the
configured kind, so a typo is an operator error at boot rather than a turn that
silently finds nothing.

## A vendor that takes its key in the URL

One built-in adapter does this: FlightAPI.io requires its key as a path segment.
The desk's rule is header-only credentials, so the exception is made explicit and
contained rather than hidden:

- the assembled URL is never logged, stored, returned, or shown;
- the key is never sent anywhere else, and no other parameter goes near it;
- every string the adapter returns is scrubbed, so a vendor error that quoted the
  request cannot carry the key into a task row, a summary, or a model prompt.

If a future vendor can take its key in a header, prefer the header. Only accept a
path or query key when the vendor documents no alternative, and write down the
trade-off in the same place the adapter is registered.

SerpApi is the near-miss case: its documentation lists the key as the `api_key`
request parameter and says nothing about a header. The adapter still tries the
header first; a `401` triggers one retry with `api_key` in the query — the
placement the vendor documents — after which the adapter remembers that answer
for the life of the process. A vendor error that quoted the request can never
surface the query key, because every returned string is scrubbed either way.

## What grows next

The adapters the desk has today cover flight and stay search. The same shape is
the extension point for the rest.

### More from the current vendors

| Want                               | Where it comes from                                                                          | Why it is not here yet                                                                                                                              |
| ---------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Multi-city flights                 | `flightapi` `/multitrip`, `serpapi` `type=3` with `multi_city_json`                          | The desk's `FlightQuery` is one leg plus an optional return; a multi-city query needs its own draft and its own missing-fields rules.               |
| SerpApi booking options            | `google_flights` with a `booking_token` from a search                                        | An offer would have to store the token to ask later, and the answer is a link to book, not a hold. Needs a product decision, not a schema accident. |
| SerpApi price insights and deals   | `price_insights` in a flight response; `engine=google_flights_deals` for flexible dates      | Useful as a task-brief line ("prices are currently low") and for a flexible-date search; neither is an offer with a price and a hold.               |
| Airport facts                      | `google_flights` `airports` array; SerpApi Google Flights airports pages                     | A tool, not a search: fits next to the existing places and weather tools.                                                                           |
| Hotel property details and reviews | `google_hotels` with `property_token`; Google Hotels Properties and Property Details engines | A follow-up on one stored offer (address, phone, amenities, check-in times). Belongs behind a tool the model can call.                              |
| Multi-trip history on a stay       | `next_page_token`                                                                            | Pagination is a cost and latency question, not a mapping question.                                                                                  |

### Restaurants

Restaurants are handled by the desk's own research, not by a provider slot. Not
every question is an offer: a restaurant answer is a place with hours, a rating,
and often a booking link, and the desk's `ProviderOffer` requires a price nobody
quoted. So a restaurant request goes through the same two tools that already
reach the public web — `web.search` and `web.fetch`, with the keyless
DuckDuckGo fallback when the operator has no search connector — and the answer
names the page it came from. The prompt and the shipped `AGENTS.md` say that
plainly: check it, cite it, and say when the check found nothing rather than
answering from memory.

Nothing about that path invents data. Search snippets are labeled untrusted page
text, `web.fetch` refuses loopback and private addresses, and the desk never
states a table is held.

A structured source becomes worth adding in two cases, and only then:

1. **Place data with provenance** — names, hours, and ratings from a vendor with
   a real API (SerpApi's `google_local` and `google_maps` engines are the likely
   first, since the key and adapter shape already exist). That would extend
   `places.suggest` with live places; it is still place data, not an offer.
2. **A vendor that can confirm a table.** A reservation is believable only when
   the vendor's own API answers with a reference, exactly like a fare hold. A
   scraper that surfaces an OpenTable link is a link, not a hold, and the desk
   must say so.

Either one lands the same way as the built-in adapters: an adapter, an operator
key, a `restaurant` slot with its own query draft (city, date, party size, time),
and a `hold` value that reflects only what the vendor can actually confirm.
