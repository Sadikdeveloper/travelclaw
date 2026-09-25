# TravelClaw

A self-hosted travel desk. One gateway holds the session, the traveler's memory, and the tools that outline a trip. The traveler surface is a chat. The sidebar lists chats on this desk. Sign-in is not built yet, so those chats are not tied to an account.

The layout follows the OpenClaw monorepo idea: a gateway, workspace markdown, tools, channel slots, and a web control surface, managed with pnpm. TravelClaw is not a fork of OpenClaw and is not affiliated with it. The gateway is NestJS. The control UI is React on Vite. Markdown skill files are not part of this version.

It does not book flights or rooms. Estimates are estimates. Visa notes are a checklist, not a ruling.

## Workspace

```text
apps/api            NestJS gateway
apps/web            Vite control UI
packages/shared     Session keys, zod schemas, records
packages/agent-core Tool engine and turn loop
workspace/          SOUL, identity, traveler, desk rules, memory
docs/               Architecture, roadmap, extension guides
```

## Quick start

```bash
corepack enable
pnpm install
cp .env.example .env
pnpm dev
```

Open http://localhost:5173. The UI proxies API calls, so the browser does not talk to a hardcoded port.

Docker serves both from one process, still without auth:

```bash
docker compose up --build
```

Set `TRAVELCLAW_MODEL_PROVIDER=openai` and `TRAVELCLAW_MODEL_API_KEY` if you want a live model to narrate tool results. Without a key, the desk still answers from the tools.

## Build order

New work should follow `docs/roadmap.md`:

1. Shared contracts
2. Agent core and tools
3. Gateway
4. Control UI

That order is already how this repo is built. The remaining work is the unchecked list in `docs/roadmap.md`. The first open item is accounts.

## Scripts

| Command         | What it does                          |
| --------------- | ------------------------------------- |
| `pnpm dev`      | Gateway on 3000, control UI on 5173   |
| `pnpm test`     | Shared, agent-core, and gateway tests |
| `pnpm build`    | Compile packages, gateway, and UI     |
| `pnpm db:reset` | Delete the local SQLite file          |

Production build serves the UI from the gateway when `apps/web/dist` exists.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Tool and channel guides are in `docs/`.

## License

MIT
