# Add a tool

A tool is a function the turn loop can call. It lives in `packages/agent-core/src/tools.ts` and is registered in `BUNDLED_TOOLS`. There is no markdown procedure file. Triggers, description, argument schema, and the runner are the tool.

The model calls tools through the provider when a key is set; the router calls them from
`triggers` when there is no key, or when the model asks for nothing. A runner does not care
which path called it: it reads `input.hints`, and both paths fill that shape.

## Steps

1. Add a runner with `name`, `description`, a plain-word `label`, `triggers`, `args`, and `run`.
2. Write `args` as a zod object whose field names match `TripHints`. The same schema becomes
   the JSON Schema the model is offered and the validator its arguments must pass, so the two
   cannot drift. Add `.describe()` to each field: that text is what the model reads.
3. Read `input.hints` in `run`, not the raw text. Return `ok: false` with a short summary when
   input is missing. Do not guess dates or prices.
4. Add a renderer branch in `packages/agent-core/src/reply.ts` so the mock provider still answers without an API key.
5. Add a test in `packages/agent-core/src/tools.test.ts`, and cover a model-called path in
   `packages/agent-core/src/turn.test.ts` if the tool adds new behavior there.
6. Rebuild agent-core (`pnpm --filter @travelclaw/agent-core build`) before restarting the API.

## Rules for the argument schema

- Keep the supported zod types to string, number, enum of strings, array of strings, and
  `optional()`. `zodToJsonSchema` throws on anything else, which is a loud failure at import.
- The turn's ceiling is three tools. One tool asking for another is not a path; add the second
  call to the router, or let the model ask for it in a later turn.
- A rejected payload stays rejected. The traveler sees one plain sentence and no schema wording.

## Rules

- Never claim a seat, room, or ticket is held.
- Label estimates as estimates and say what is excluded (usually flights).
- Visa, health, and safety tools return checklists and point at official sources. They do not rule.
- Time-box outbound HTTP to a few seconds and keep a labeled fallback.
- Cap list length. An 18-day outline is the current maximum.

Skills, meaning markdown procedures loaded beside the code, are not part of this version. Add that layer only if someone who is not changing TypeScript needs to change when a tool runs.
