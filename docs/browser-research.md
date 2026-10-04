# Browser implementation research — #25

Reviewed on 2026-10-04. These are commit-pinned implementation references, not a
claim that another project's deployment proves TravelClaw secure. No Hermes or
OpenClaw code, prompts, or skill files were copied into this runtime. We reused the
applicable architectural patterns and implemented the smaller TravelClaw boundary.
Both repositories' root licenses at these revisions are MIT.

## Sources and decisions

| Concern                              | Source inspected                                                                                                                                                              | TravelClaw use                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Task-scoped sessions                 | [Hermes browser session management](https://github.com/NousResearch/hermes-agent/blob/439334127f012e1ee0685acd5dba288e459af0ec/tools/browser_tool_session.py)                 | One ephemeral context per research run, server-held lease ID/key, no default shared task or existing profile.                                                                                                                                                                                                                                                                     |
| Cleanup and ownership                | [Hermes lifecycle](https://github.com/NousResearch/hermes-agent/blob/439334127f012e1ee0685acd5dba288e459af0ec/tools/browser_tool_lifecycle.py)                                | Independent worker idle/lifetime cleanup, gateway cancellation, shutdown cleanup, and no cross-session refs.                                                                                                                                                                                                                                                                      |
| Bounded page material                | [Hermes snapshot processing](https://github.com/NousResearch/hermes-agent/blob/439334127f012e1ee0685acd5dba288e459af0ec/tools/browser_tool_snapshot.py)                       | Bounded visible text and controls. Unlike Hermes's spill files, TravelClaw does not write full snapshots into a workspace/cache for other tools to read.                                                                                                                                                                                                                          |
| Inspect → act → inspect              | [OpenClaw browser automation skill](https://github.com/openclaw/openclaw/blob/a75455653ba88b468cf2c8dfcb32357293f5a463/extensions/browser/skills/browser-automation/SKILL.md) | Fresh opaque refs bound to a snapshot, post-action snapshots, stale-ref rejection/reinspection, no blind multi-action batches, honest manual blockers.                                                                                                                                                                                                                            |
| Runtime budgets                      | [OpenClaw action policy](https://github.com/openclaw/openclaw/blob/a75455653ba88b468cf2c8dfcb32357293f5a463/extensions/browser/src/browser/act-policy.ts)                     | Worker-enforced action/time limits separate from the model loop; bounded request/response sizes and context counts. We do not copy their larger batch/evaluate surface.                                                                                                                                                                                                           |
| Browser DNS rebinding                | [OpenClaw navigation guard](https://github.com/openclaw/openclaw/blob/a75455653ba88b468cf2c8dfcb32357293f5a463/extensions/browser/src/browser/navigation-guard.ts)            | Their code explicitly explains why Node-side DNS validation cannot pin Chromium's own connection. TravelClaw intercepts HTTP requests and fulfills them through a Node transport that validates all DNS answers, pins the actual socket lookup, and does not follow redirects. Native browser networking is directed to a dead proxy; WebSockets and service workers are blocked. |
| Skills separate from personal memory | [Hermes skill catalog/loading](https://github.com/NousResearch/hermes-agent/blob/439334127f012e1ee0685acd5dba288e459af0ec/tools/skills_tool.py)                               | Separate procedure store and explicit review. TravelClaw only learns finite step names/input slots, not arbitrary Markdown/scripts, linked files, credentials, or per-traveler values. Approved procedures are hints, never executable authority.                                                                                                                                 |
| Browser engine and interception      | Playwright network routing [1](https://playwright.dev/docs/network), WebSocket routing [4](https://playwright.dev/docs/release-notes)                                         | Context-wide routing before navigation, fresh contexts, blocked service workers, and no route continuation to an unvalidated URL.                                                                                                                                                                                                                                                 |
| Process isolation                    | Playwright Docker guidance [1](https://playwright.dev/docs/docker)                                                                                                            | Separate worker, non-root user, required Chromium sandbox, no gateway database/provider keys/model keys mounted in the worker, bounded container resources. The supplied seccomp profile comes from Playwright v1.63.0; its Apache-2.0 license is included under `third-party/`.                                                                                                  |

## Deliberately not imported

- Hermes's cloud stealth/CAPTCHA-solving, existing-profile copying, or automatic
  `--no-sandbox` fallback. #25 requires respecting access restrictions; production
  startup fails if the Chromium sandbox cannot run.
- OpenClaw's arbitrary evaluate, uploads/downloads, broad personal-browser/CDP
  attachment, exec/code-mode, and larger batch surface. TravelClaw exposes none of
  those as model tools.
- Arbitrary learned Markdown instructions or code. Browser content must not create
  a new tool, expand network permissions, or call personal-memory tools.
- A new general-purpose agent dependency. Embedding an entire other agent would
  also import its credential, filesystem, plugin and approval surfaces, which are
  outside this search-only issue.

## Limits of these adaptations

This is a conservative public-search worker, not feature parity with either agent.
It supports common native controls and a small set of ARIA controls. Large pages,
embedded forms, complex calendars, unapproved API origins, consent walls and sites
requiring anti-bot workarounds can produce a handoff. Exact quote matching proves
that text was visible; it does not prove a fare is available at checkout, semantically
matches every request detail, or contains all conditions.

Application routing and a browser sandbox are defense in depth, not a claim of
protection from every browser/OS exploit. Deploy the worker on a dedicated restricted
host/container, keep it patched, and enforce egress isolation for sensitive networks
at the infrastructure layer too. The Docker deployment and a permitted live public
travel search still need operator validation; fixture tests are not substitutes.
