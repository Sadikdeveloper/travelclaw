# Contributing

TravelClaw is a pnpm workspace. Plain `npm install` at the root will not wire the packages correctly.

## Setup

```bash
corepack enable
corepack prepare pnpm@9.15.9 --activate
pnpm install
cp .env.example .env
pnpm dev
```

- Control UI: http://localhost:5173
- Gateway: http://localhost:3000/health
- OpenAPI: http://localhost:3000/docs

Node 22.13 or newer is required. The gateway uses the built-in `node:sqlite` module.

## Where to start

Read `docs/roadmap.md` and take the first unchecked item you can finish. The build order is intentional: contracts, then the skill engine, then the gateway, then the UI.

| Task | Start here |
| --- | --- |
| Change a request or response shape | `packages/shared` |
| Add or fix a skill | `docs/adding-a-skill.md` |
| Change how a turn is assembled | `packages/agent-core/src/turn.ts` |
| Add an HTTP route | `apps/api/src/<feature>` |
| Add a channel | `docs/adding-a-channel.md` |
| Change the desk UI | `apps/web/src` |

## Commands

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm format
pnpm db:reset
```

`pnpm dev` builds `@travelclaw/shared` and `@travelclaw/agent-core` first. If you change those packages while the API is running, rebuild them and restart the API. Nest does not watch package `dist/`.

## Conventions

- TypeScript strict. No `any` unless a third-party type forces it, and then narrow it immediately.
- Comments explain why, not what. Put contributor instructions in `docs/` instead of narrating the code.
- Zod schemas in `@travelclaw/shared` are the input contract. Do not duplicate them as class-validator DTOs.
- Skills stay deterministic. The model may narrate results. It may not be the only source of a price or a forecast.
- Do not add a dependency for a ten-line helper.
- Commit messages: `feat:`, `fix:`, `docs:`, `test:`, `chore:`.

## Pull requests

Say which roadmap item you picked, how you tested it, and what you left undone. A skill without a test will not land.
