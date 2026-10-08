# Roadmap

Work in this order. Later tasks assume the earlier ones exist. Pick the first unchecked item, and leave a note in the pull request about which box you closed.

This is an independent travel desk inspired by the OpenClaw monorepo idea (one gateway, workspace markdown, tools, channels, a chat UI). It is not a fork and not affiliated with OpenClaw. Skills, as markdown procedures, remain deferred pending the reviewed-workflow design in #25. Tools are functions we register. The traveler does not see a tool catalog.

Checked on 2026-10-07, after adding the live turn, the read-only web tools, built-in
vendor adapters (`serpapi`, `flightapi`), flexible-month fare sampling, and provider handoff.

## Done

- [x] Workspace skeleton
- [x] Shared contracts
- [x] Agent core and bundled travel tools
- [x] Gateway API, sessions, trips, memory, heartbeat, channel registry
- [x] Vite UI, CI, and Docker
- [x] Skill catalog removed. Tools stay in code.
- [x] Traveler surface is a chat plus a sidebar of chats
- [x] A complete flight or hotel search with a configured source wakes one or two desks in parallel; incomplete requests stay in chat for clarification
- [x] A desk card says search finished only after a source actually finishes, then offers a dismissible Yes / No / Keep working task-success prompt; Keep working leaves the composer open and does not replay the stale query
- [x] **Accounts.** Email register and sign-in, cookie session, and Google sign-in behind `TRAVELCLAW_GOOGLE_CLIENT_ID`. Chats belong to the signed-in account.
- [x] **Model-called tools.** The tool catalog goes to the provider as callable tools. A malformed call is rejected, not coerced. The router stays the fallback when the provider is `mock`, has no key, or asks for nothing, and a tool both picked runs once.
- [x] **A turn the traveler can watch.** The turn streams over the POST that starts it: the model's thinking, every step in order (what it chose, each tool with its arguments and result, browser steps), and the answer as it is written. Stop cancels the model call and saves nothing half-written. The same work produced the read-only web pair `web.search` / `web.fetch`, grounded in an operator `search` connector or the keyless DuckDuckGo tier, with honest refusals instead of invented prices. See [the live turn](architecture.md#the-live-turn) and [reading the public web](architecture.md#reading-the-public-web).

Without a configured search source, flight and stay requests remain ordinary chat turns, so the model can clarify the request. With an operator key, complete search requests can show provider offers. A reservation hold is separate, explicit, and reported only after provider confirmation. It may reserve the fare without payment; TravelClaw never processes payment, and the provider supplies any payment deadline or instructions.

## Next, in this order

- [x] **Provider connectors.** Only after built-in tools are called by the model. A connector is an operator-held key a tool resolves by name, not a new language. The traveler never provides one: provider access is the desk's job, and anything the desk needs from the traveler arrives as a turn, not a setting.
- [x] **Flight and stay search.** One or more operator-managed compatible adapters per kind, behind `TRAVELCLAW_*_PROVIDERS_JSON` (with the original single-provider env kept as a fallback). Sources are queried in parallel, results are named and timestamped, partial failures are disclosed, and offers persist. A provider-confirmed reservation hold is a separate explicit request, routed to the original source; payment stays with the provider. No card storage. See [provider contract and global-market caveats](architecture.md#flight-and-stay-search).
- [x] **Message-stated market context.** Read point-of-sale country, currency, and language from the message that starts a search, use them instead of the operator's single-market defaults or assumptions from the route, and store nothing on the account.
- [x] **Pairing auth.** Add a device token for non-loopback clients before any public deploy. Account sign-in does not replace this.
- [x] **SQLite FTS memory search.** An FTS5 index over `memory_notes`, kept in step by triggers and reconciled on boot. Ranking is `bm25()` with the title weighted three to one, times a bounded recency factor; the kind filter stays. The prompt searches with the traveler's message instead of taking the last twelve notes, inside the same budget. Search stays local: no embeddings, no network. See [Memory](architecture.md#memory).
- [x] **Per-agent workspace.** Extra agents share the desk files. Give each agent `workspace/agents/<id>/`. Each file falls back to the shared one when the agent folder has no override, `GET /api/workspace?agentId=` names the file each slot reads, and an agent id that tries to climb out of the workspace is refused.
- [x] **Built-in vendor adapters.** `serpapi` (Google Flights and Google Hotels) and `flightapi` (one-way and round-trip) behind the same provider lists, with an `adapter` field, operator `cityCodes` aliases, and a `holdSupport: unsupported` disclosure for vendors that only quote prices. Arrived after the provider contract; see [provider adapters](provider-adapters.md#adding-one).
- [x] **Flexible flight dates and offer handoff.** Month-only searches sample weekly departure dates and label returned fares with the provider's actual date. High-confidence city spelling corrections avoid an unnecessary turn; travelers can select a fare or stay, request an unpaid provider-confirmed reservation where supported, or follow the validated checkout link for the selected offer. TravelClaw does not take payment; provider checkout and any payment instructions stay with the provider.
- [x] **Retries with a budget.** One engine in `agent-core` behind every outbound call: jittered backoff, a wall-clock deadline covering the attempts and the pauses, `Retry-After` honored up to a cap, and Stop ending a retry mid-flight. Applied to the model call, the rate and forecast tools, `web.search`/`web.fetch`, and each flight and stay source; deliberately not applied to holds, browser-worker actions, or a model stream that has already written a word. See [retries](retries.md).
- [ ] **More search from the current vendors.** Multi-city (FlightAPI.io `/multitrip`, SerpApi `type=3`), SerpApi booking options and price insights, broader Google Flights Deals aggregation (in addition to weekly sampled month searches), hotel property details, and the airport-facts tool. Each one is scoped in [What grows next](provider-adapters.md#what-grows-next).
- [ ] **Restaurants, if a real source earns its place.** Restaurant questions are already answered by the desk's own research (`web.search`/`web.fetch`, citing the page). A vendor is only worth wiring for place data with provenance, or for a table a vendor's API confirms with a reference — then it gets the `restaurant` slot. See [Restaurants](provider-adapters.md#restaurants).
- [ ] **Telegram extension.** Implement `ChannelPlugin` behind `TELEGRAM_BOT_TOKEN`. Do not autoload unsigned code.
- [ ] **Discord extension.** Same contract as Telegram.
- [ ] **iCal export** for a planned trip.
- [ ] **Map view** of itinerary anchors. Static coordinates first, no tracking.
- [ ] **Plugin package autoload** under `extensions/*`, off by default, with a hash allowlist.

## Browser fallback (#25)

Browser-capable search is the next feature priority following pairing hardening.
The [staged delivery plan](browser-agent.md) tracks the security foundation, isolated
execution, provider-first fallback, provenance/UI, and reviewed procedures. An opt-in worker now provides browser fallback, provenance/UI, cancellation and
reviewed finite workflows. Local Chromium fixtures pass; #25 remains open pending
a permitted live-site demonstration and deployment validation. This work does not mark the remaining numbered roadmap items complete.

## Not in scope

- Taking payment or storing card numbers
- Claiming visa, medical, or safety rulings
- A hosted multi-tenant service
