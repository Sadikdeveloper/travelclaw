# Add a skill

A skill is a procedure (`skills/<name>/SKILL.md`) plus a function in `@travelclaw/agent-core`. The markdown tells the router when to run. The function does the work. Do not put network calls or prices in the markdown and hope the model invents the rest.

## Steps

1. Copy an existing folder under `skills/`. The name in frontmatter must match the folder and the code `name`.
2. Write triggers as lowercase phrases a traveler would actually type.
3. Add a runner in `packages/agent-core/src/skills.ts` and register it in `BUNDLED_SKILLS`.
4. Return `ok: false` with a short summary when input is missing. Do not guess dates or prices.
5. Add a renderer branch in `packages/agent-core/src/reply.ts` so the mock provider still answers without an API key.
6. Add a test next to the other skill tests.
7. Rebuild agent-core (`pnpm --filter @travelclaw/agent-core build`) before restarting the API.

## Rules

- Never claim a seat, room, or ticket is held.
- Label estimates as estimates and say what is excluded (usually flights).
- Visa, health, and safety skills return checklists and point at official sources. They do not rule.
- Time-box outbound HTTP to a few seconds and keep a labeled fallback.
- Cap list length. An 18-day outline is the current maximum.

Prompt-only skills (markdown without code) are listed in the catalog as `implemented: false` and are not executed. Prefer a real runner.
