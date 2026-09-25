# Roadmap

Work in this order. Later tasks assume the earlier ones exist. Pick the first unchecked item that matches the area you want, and leave a note in the pull request about which box you closed.

This is an independent travel desk inspired by the OpenClaw monorepo idea (one gateway, workspace markdown, tools, channels, a control UI). It is not a fork and not affiliated with OpenClaw. Skills, as markdown procedures, are deferred.

## Order we are building in

1. pnpm workspace, contributor docs, starter persona files
2. `@travelclaw/shared` contracts (session keys, zod inputs, records)
3. `@travelclaw/agent-core` tools and the turn loop, with tests and no HTTP
4. Nest gateway: config, SQLite, health
5. Workspace files, agents, memory
6. Sessions, chat turns, trips
7. Heartbeat and channel registry
8. Gateway tests
9. Vite control UI
10. Gateway serves the built UI, Docker, CI

## Now

- [x] Workspace skeleton
- [x] Shared contracts
- [x] Agent core and bundled travel tools
- [x] Gateway API
- [x] Control UI
- [x] CI and Docker

## Next, in this order

The traveler product is a chat. Tools stay internal. Do these before the old control-plane list.

1. **Accounts.** Email register and sign-in first. Google sign-in second, behind a client id the operator sets. Chats belong to that account.
2. **Model-called tools.** We keep adding the tools. An OpenAI-compatible model requests one. The router stays as fallback. Users do not add tools in this step.
3. **User-added connectors.** Only after built-in tools are called by the model. A connector is a key the traveler provides, not a new language.
4. **Flight and stay search** behind an explicit provider key. The desks already ask yes / no / still working. A provider may return offers. It must not claim a hold until the provider says one exists. No card storage.

Then, still in order:

5. **Pairing auth.** Add a device token for non-loopback clients before any public deploy. Account sign-in does not replace this.
6. **SQLite FTS memory search.** Today memory is a short list injected into the prompt. Search should stay local.
7. **Per-agent workspace.** Extra agents share the desk files. Give each agent `workspace/agents/<id>/`.
8. **Telegram extension.** Implement `ChannelPlugin` behind `TELEGRAM_BOT_TOKEN`. Do not autoload unsigned code.
9. **Discord extension.** Same contract as Telegram.
10. **iCal export** for a planned trip.
11. **Map view** of itinerary anchors. Static coordinates first, no tracking.
12. **Plugin package autoload** under `extensions/*`, off by default, with a hash allowlist.

## Not in scope

- Taking payment or storing card numbers
- Claiming visa, medical, or safety rulings
- A hosted multi-tenant service
