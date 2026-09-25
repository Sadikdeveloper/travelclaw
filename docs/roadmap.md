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

1. **Pairing auth.** The gateway has no login. Add a device token for non-loopback clients before any public deploy.
2. **SQLite FTS memory search.** Today memory is a short list injected into the prompt. Search should stay local.
3. **Per-agent workspace.** Extra agents share the desk files. Give each agent `workspace/agents/<id>/`.
4. **Model-selected tools.** Tools currently run from a deterministic router, then the model narrates. Let an OpenAI-compatible model request a tool, and keep the router as fallback.
5. **Telegram extension.** Implement `ChannelPlugin` behind `TELEGRAM_BOT_TOKEN`. Do not autoload unsigned code.
6. **Discord extension.** Same contract as Telegram.
7. **iCal export** for a planned trip.
8. **Map view** of itinerary anchors. Static coordinates first, no tracking.
9. **Flight and stay search tool** behind an explicit provider key. Never imply a booking succeeded.
10. **Plugin package autoload** under `extensions/*`, off by default, with a hash allowlist.

## Not in scope

- Taking payment or storing card numbers
- Claiming visa, medical, or safety rulings
- A hosted multi-tenant service
