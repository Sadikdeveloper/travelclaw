# Add a tool

A tool is a function the turn loop can call. It lives in `packages/agent-core/src/tools.ts` and is registered in `BUNDLED_TOOLS`. There is no markdown procedure file. Triggers, description, and the runner are the tool.

## Steps

1. Add a runner with `name`, `description`, `triggers`, and `run`.
2. Return `ok: false` with a short summary when input is missing. Do not guess dates or prices.
3. Add a renderer branch in `packages/agent-core/src/reply.ts` so the mock provider still answers without an API key.
4. Add a test in `packages/agent-core/src/tools.test.ts`.
5. Rebuild agent-core (`pnpm --filter @travelclaw/agent-core build`) before restarting the API.

## Rules

- Never claim a seat, room, or ticket is held.
- Label estimates as estimates and say what is excluded (usually flights).
- Visa, health, and safety tools return checklists and point at official sources. They do not rule.
- Time-box outbound HTTP to a few seconds and keep a labeled fallback.
- Cap list length. An 18-day outline is the current maximum.

Skills, meaning markdown procedures loaded beside the code, are not part of this version. Add that layer only if someone who is not changing TypeScript needs to change when a tool runs.
