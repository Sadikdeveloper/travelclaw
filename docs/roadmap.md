# Roadmap

Work in this order. Later tasks assume the earlier ones exist. Pick the first unchecked item, and leave a note in the pull request about which box you closed.

This is an independent travel desk inspired by the OpenClaw monorepo idea (one gateway, workspace markdown, tools, channels, a chat UI). It is not a fork and not affiliated with OpenClaw. Skills, as markdown procedures, are deferred. Tools are functions we register. The traveler does not see a tool catalog.

Checked on 2026-09-25, after `5b4e911`.

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

Those desks write a brief. They do not search a provider, hold a seat, or take payment.

## Next, in this order

- [ ] **Accounts.** Email register and sign-in first. Google sign-in second, behind a client id the operator sets. Chats belong to that account. Today every chat sits on the one local desk.
- [ ] **Model-called tools.** We keep adding the tools. An OpenAI-compatible model requests one. The router stays as fallback. Users do not add tools in this step.
- [ ] **User-added connectors.** Only after built-in tools are called by the model. A connector is a key the traveler provides, not a new language.
- [ ] **Flight and stay search** behind an explicit provider key. The desks already ask yes / no / still working. A provider may return offers. It must not claim a hold until the provider says one exists. No card storage.
- [ ] **Pairing auth.** Add a device token for non-loopback clients before any public deploy. Account sign-in does not replace this.
- [ ] **SQLite FTS memory search.** Today memory is a short list injected into the prompt. Search should stay local.
- [ ] **Per-agent workspace.** Extra agents share the desk files. Give each agent `workspace/agents/<id>/`.
- [ ] **Telegram extension.** Implement `ChannelPlugin` behind `TELEGRAM_BOT_TOKEN`. Do not autoload unsigned code.
- [ ] **Discord extension.** Same contract as Telegram.
- [ ] **iCal export** for a planned trip.
- [ ] **Map view** of itinerary anchors. Static coordinates first, no tracking.
- [ ] **Plugin package autoload** under `extensions/*`, off by default, with a hash allowlist.

## Not in scope

- Taking payment or storing card numbers
- Claiming visa, medical, or safety rulings
- A hosted multi-tenant service
