# Roadmap

Work in this order. Later tasks assume the earlier ones exist. Pick the first unchecked item, and leave a note in the pull request about which box you closed.

This is an independent travel desk inspired by the OpenClaw monorepo idea (one gateway, workspace markdown, tools, channels, a chat UI). It is not a fork and not affiliated with OpenClaw. Skills, as markdown procedures, remain deferred pending the reviewed-workflow design in #25. Tools are functions we register. The traveler does not see a tool catalog.

Checked on 2026-10-04, while adding pairing auth for non-loopback clients.

## Done

- [x] Workspace skeleton
- [x] Shared contracts
- [x] Agent core and bundled travel tools
- [x] Gateway API, sessions, trips, memory, heartbeat, channel registry
- [x] Vite UI, CI, and Docker
- [x] Skill catalog removed. Tools stay in code.
- [x] Traveler surface is a chat plus a sidebar of chats
- [x] A flight request, a hotel request, or both wakes one or two desks in parallel
- [x] When a desk finishes, the traveler can answer yes complete, no, or still working
- [x] **Accounts.** Email register and sign-in, cookie session, and Google sign-in behind `TRAVELCLAW_GOOGLE_CLIENT_ID`. Chats belong to the signed-in account.
- [x] **Model-called tools.** The tool catalog goes to the provider as callable tools. A malformed call is rejected, not coerced. The router stays the fallback when the provider is `mock`, has no key, or asks for nothing, and a tool both picked runs once.

Without a search key, those desks still write the same brief. With an operator key, they can show provider offers. A hold is separate, explicit, and reported only after provider confirmation; nothing is purchased.

## Next, in this order

- [x] **Provider connectors.** Only after built-in tools are called by the model. A connector is an operator-held key a tool resolves by name, not a new language. The traveler never provides one: provider access is the desk's job, and anything the desk needs from the traveler arrives as a turn, not a setting.
- [x] **Flight and stay search.** One or more operator-managed compatible adapters per kind, behind `TRAVELCLAW_*_PROVIDERS_JSON` (with the original single-provider env kept as a fallback). Sources are queried in parallel, results are named and timestamped, partial failures are disclosed, and offers persist. A hold is a separate explicit request, routed to the original source and shown only after provider confirmation. No card storage. See [provider contract and global-market caveats](architecture.md#flight-and-stay-search).
- [x] **Message-stated market context.** Read point-of-sale country, currency, and language from the message that starts a search, use them instead of the operator's single-market defaults or assumptions from the route, and store nothing on the account.
- [x] **Pairing auth.** Add a device token for non-loopback clients before any public deploy. Account sign-in does not replace this.
- [ ] **SQLite FTS memory search.** Today memory is a short list injected into the prompt. Search should stay local.
- [ ] **Per-agent workspace.** Extra agents share the desk files. Give each agent `workspace/agents/<id>/`.
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
