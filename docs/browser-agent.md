# Browser search fallback (#25)

Status: **opt-in working slice, tested with real Chromium on local fixtures**.
The gateway can now use a separate browser worker after suitable provider search
is unavailable, fails, or returns no offers. The feature remains off by default.
No existing signed-in browser is attached. No payment or checkout tool exists.

[Implementation research](browser-research.md) records the Hermes/OpenClaw source
revisions, patterns reused, deliberate differences and licenses.

## What runs

1. The existing flight/stay desks try configured provider adapters first. Useful
   API offers still use the existing offer/hold path; the browser is not started.
2. When fallback is enabled, a bounded, browser-only model loop chooses one of the
   operator-authorized sources. It never receives the general tool catalog, personal
   memory, worker credentials, provider keys, or another chat's history.
3. The worker creates a fresh context and navigates to that source. Navigation and
   each interaction return a fresh, bounded visible-page snapshot with opaque refs.
   The model can inspect, navigate within scope, fill, select, click, observe, hand
   off, or stop. It cannot evaluate JavaScript, use arbitrary selectors, upload,
   download, sign in, open a personal profile, or execute a learned script.
4. Field values must occur in the initiating traveler message (with a small number-word
   normalization). Party size requires explicit count language (for example, “two
   adults”), not digits from a date, flight number or budget. Mixed adult/child
   parties currently require clarification. No default party size, currency or missing required value is
   silently filled. Ambiguous dates, airport codes not stated in the request, complex
   custom widgets, or unstated options can require a more explicit follow-up.
5. An observation requires an exact contiguous quote from the current visible page;
   its title, displayed price/currency and captured conditions must occur inside that
   quote. The worker stamps the source, timestamp and snapshot ID. The model cannot
   choose those provenance values.
6. Chat shows progress, Stop, the action trail, evidence, source link and a warning
   that this is **page-observed, not provider-confirmed or holdable**. The source link
   opens the traveler's own browser, **not** a remote session takeover. Worker contexts
   close on terminal results. A new chat request starts a new context.
7. Structurally recognizable successful workflows can propose non-personal procedures
   for operator review. Failures do not propose a procedure.

`browser_runs` persists the latest browser state/evidence for each task separately
from `offers`. Existing session ownership guards protect reads and Stop; observation
IDs are never accepted by provider hold lookup. No raw page snapshots, cookies,
input values, worker leases or credentials are written into tool traces or memory.
Evidence/source URLs may contain the traveler's search details and remain scoped to
that chat, just like the original request; they are never copied into procedures.

## Enable it (operator only)

Build and install browser dependencies on the **worker host**, not in the web client:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm --filter @travelclaw/browser-worker exec playwright install --with-deps chromium
```

Generate a dedicated random worker token locally; do not paste it into chat. Set
these in the worker's process environment (the worker does not auto-load `.env`):

```sh
# Example structure only: airline.example is NOT a real tested integration.
export TRAVELCLAW_BROWSER_WORKER_TOKEN='<at least 32 random characters>'
export TRAVELCLAW_BROWSER_SITES_JSON='[{"id":"authorized-airline","name":"Authorized airline","kind":"flight","startUrl":"https://airline.example/search","origins":["https://airline.example"],"searchPostPaths":["/search"]}]'
pnpm --filter @travelclaw/browser-worker start
```

Run it under a dedicated non-root user with no gateway files, provider/model keys,
SSH keys, personal browser profile, or credentials mounted. Chromium sandboxing is
mandatory: **do not add `--no-sandbox` to make production startup work**. For container
use, `docker compose -f docker-compose.browser.yml up --build -d` provides a starting
configuration with a non-root user, Playwright's seccomp profile, resource limits,
read-only root filesystem and loopback-published RPC port. Validate the profile and
user-namespace support on your host. This Docker configuration was not executed in
the development sandbox (Docker was unavailable).

In the gateway environment:

```dotenv
TRAVELCLAW_BROWSER_WORKER_URL=http://127.0.0.1:3001
TRAVELCLAW_BROWSER_WORKER_TOKEN=<same worker token>
TRAVELCLAW_NETWORK=1
# Also configure the desk's existing tool-capable model/provider settings.
```

The loopback URL above is **server-to-server**. No browser-facing code contacts
localhost; the web client uses same-origin `/api` endpoints. If the gateway is in a
container/on another host, use the worker's private address reachable from that
process and restrict ingress to that gateway. Use TLS for a cross-host worker
connection. Never expose worker RPC/CDP publicly. The RPC requires both a gateway
token and a per-session key for actions/close; CORS is not an authorization layer.

No worker URL/token means the previous desk behavior. `TRAVELCLAW_NETWORK=0` prevents
fallback even when a worker is configured. A missing tool-capable model or source
produces an explicit handoff, not fabricated results.

## Authorizing another site

1. Check that normal automated public search is permitted by that site. Do not use
   stealth, residential proxies, CAPTCHA solving or restricted endpoints to force it.
2. Add a unique site ID, display name, kind and public start URL to the worker's list.
   This is search-scope configuration, not a bespoke airline API adapter.
3. Optionally add `bookingPaths` — exact paths where a passenger-details step may
   be reached. Empty means search-only, which is the default. A booking session
   also needs the traveler's recorded confirmation, and no listed path can grant
   `checkout`, `payment`, `purchase`, `creditcard`, `login`, `password`, or
   `authorization`: those are refused regardless. See
   [browser prefill research](browser-prefill-research.md).
4. Enumerate exact HTTP(S) origins required by the search, including permitted assets.
   Wildcards, URL credentials and nonstandard ports are not accepted. Only GET/HEAD
   and explicitly listed **search-only** POST paths can pass, plus POST to a listed
   `bookingPaths` entry when a booking session is open. Do not list checkout,
   account or payment endpoints. Do not put credentials or personal values in config.
5. Exercise the flow on a local fixture first. Check controls, redirects, subresources,
   result evidence, denied operations and the handoff copy. The conservative worker
   can hand off rather than support every modern travel-site widget.
6. Validate a permitted live flow manually, record source/date/conditions, and review
   any proposed procedure. Removing the source or origin revokes access. Restart the
   worker after changing authorization; procedure approval cannot expand it.

## Booking fills: what the traveler authorizes

A search run never touches a passenger-details step. Reaching one needs two
independent grants, and neither can be asserted by a request:

| Grant                      | Who gives it          | Where it lives                  |
| -------------------------- | --------------------- | ------------------------------- |
| `bookingPaths` on the site | the operator          | `TRAVELCLAW_BROWSER_SITES_JSON` |
| a recorded confirmation    | the traveler, per run | `booking_confirmations`         |

The worker grants the tier only on the conjunction. The payment tier ignores both
and stays closed.

**The loop.** A booking-tier control stops the run with `confirmation_required`.
The card then names the site, says that only details the traveler already wrote in
chat will be used, and says that TravelClaw never takes payment.
`POST /api/tasks/:id/browser/booking` with `{ "confirm": true }` records the
approval and starts the fill; `POST /api/tasks/:id/browser/booking/revoke`
withdraws it and stops the run. The site is read from the run, not from the
request, so approving one site cannot be replayed against another.

**The approval is a lease.** It carries an epoch and a ten-minute expiry, and it is
spent by the first run that takes it — a second run needs a fresh approval. The
gateway re-checks the epoch before and after every worker call, so an approval
withdrawn mid-run voids it: the run ends `human_has_control`, any observation it
had produced is discarded, and the worker seals the session, closing the page
rather than leaving it showing the traveler's details. Reads are refused too, not
just writes.

**What an observation may then say.** `bookingEligibility` describes the page:
`no_booking_step_seen`, `booking_step_blocked` (the source has a step this run is
not authorized for), or `booking_step_reachable` (this run was authorized to act on
one it could see). None of them says anything was filled, submitted, reserved, or
paid for, and there is no value that could.

**Still out of scope.** No payment, ever, and not configurable. No procedure is
learned from a booking run. Nothing records what happened after the fill, because
nothing happens after it — that is the booking lifecycle's job.

## Network and action boundaries

Every intercepted HTTP request, including redirects/subresources, goes through
`network.ts`. It checks scheme, exact origin, method/path and all DNS answers,
rejects non-public destinations and Azure’s special WireServer address, and pins the actual Node socket lookup. Responses
are size-limited, decompression is bounded, redirects are not followed by Node, and
redirect locations are validated before being returned to Chromium. Native Chromium
traffic is pointed at a dead proxy with loopback bypass disabled. Service workers,
WebSockets, popup windows, downloads and browser permissions are blocked; images,
fonts and media are not fetched in this text-first slice. A policy denial aborts
in-flight and queued requests immediately; later permitted requests cannot continue
after the lease is blocked. Each lease has bounded network concurrency, and response
bytes are charged while streaming (including decompression expansion), not only after
an entire response has been buffered.

Network routing is not semantic proof that a site's endpoint is read-only. The
operator must authorize only public search scope. Conservative sensitive-control
and operation checks provide another barrier, not a universal detector of malicious
site behavior. There are no signed-in profiles or payment credentials in this worker.
Use host/container egress policy as an additional boundary against browser exploits.

| Budget                                                          | Limit                                     |
| --------------------------------------------------------------- | ----------------------------------------- |
| Gateway model/tool iterations per research run                  | 20                                        |
| Worker actions per lease                                        | 20                                        |
| Gateway run / worker lease lifetime                             | 120 seconds each                          |
| Worker idle lifetime                                            | 45 seconds                                |
| Worker contexts, including opens/closures in flight             | 4                                         |
| Active gateway browser runs                                     | 4 total, 1 per chat                       |
| Research requests, including “still working” retries            | 6 per account/hour, 30 per desk/hour      |
| Model call / action / navigation                                | 25 / 8 / 15 seconds (also cancellable)    |
| Network request / decompressed response                         | 10 seconds / 2 MiB                        |
| Requests / streamed-or-expanded response bytes per worker lease | 150 / 8 MiB                               |
| Concurrent HTTP transports per worker lease                     | 8                                         |
| Visible text / controls / serialized snapshot                   | 16,000 characters (32 KiB) / 100 / 64 KiB |

Budgets are enforced outside the model. The gateway aborts pending model/RPC work on
Stop, releases the worker, and persists the outcome. The worker's own timers reclaim
contexts if the gateway disappears. A gateway restart marks old running tasks as
interrupted; no credential-bearing lease is persisted. Account/session ownership is
rechecked both before and after awaited model/worker operations, before another
action is dispatched or an observation/procedure is accepted. Lost ownership stops
the run without publishing late observations. Initial persistence failures also
release active-run slots. There is not yet a logout-triggered immediate worker
revocation hook; existing runs remain subject to Stop and the short lease lifetime.

## Reviewed reusable workflows

The worker derives candidates only after an evidence-backed result and only when
all recorded steps fit a finite vocabulary: start-page navigation, inspection,
canonical travel-field slots, search click and observation. Unknown controls make
that run ineligible for automatic learning. No page label, field value, URL query,
route, date, market, identity, cookie, credential or raw model text can fit this schema.

Candidates live in `browser_procedures`, not `memory_notes` or workspace Markdown.
They are deduplicated and start **pending**. The operator inspects and reviews them
locally; no traveler/model HTTP endpoint can approve one:

```sh
# Run after building shared contracts. Set the actual gateway database path.
DATABASE_PATH=/absolute/path/travelclaw.db pnpm --filter @travelclaw/api browser:procedures list
DATABASE_PATH=/absolute/path/travelclaw.db pnpm --filter @travelclaw/api browser:procedures approve <id>
DATABASE_PATH=/absolute/path/travelclaw.db pnpm --filter @travelclaw/api browser:procedures reject <id>
```

Only approved steps matching the currently authorized site ID and origin are supplied
as hints on later searches. They cannot supply values, selectors, tools or network
permissions. Traveler corrections made in subsequent requests can produce a new
candidate after another verified result; there is no automatic promotion of a
failure or free-form correction into a general rule. These are deliberately small
workflow hints, not Hermes/OpenClaw Markdown-skill compatibility.

## Site notes: what a site reliably does to a run

Procedures learn the shape of a run that worked. Notes learn what stopped one, so
the desk stops rediscovering the same wall on every attempt.

They live in `browser_site_notes`, one row per site, origin and blocker, with a
`runs` count. A finite vocabulary of five — `consent_wall`, `sign_in_wall`,
`human_verification`, `refused_access`, `content_too_large` — chosen from the
handoff reason, never quoted from the page. Reasons that describe TravelClaw
rather than the site (`time_limit`, `action_limit`, `network_restriction`) or the
traveler (`missing_information`, `confirmation_required`) record nothing.

**`note_origin` is the part that matters.** It records how the blocker was
detected, because the two kinds of evidence are not equally trustworthy:

| `note_origin`     | Detected by                                                  | Trust                 |
| ----------------- | ------------------------------------------------------------ | --------------------- |
| `worker_observed` | a real dialog, a visible password field, an HTTP 401/403/429 | a fact about the site |
| `page_claimed`    | a pattern matched in the page's own text                     | a claim by the site   |

A page can plant text to leave a durable false claim about itself behind, so
`consent` and `verification` — which the worker matches in page text — are always
recorded as `page_claimed`. The gateway cannot tell a text match from a real
dialog from the reason alone, and when it cannot tell, the untrusted origin is the
one that sticks.

Notes start **pending** and are invisible to the model until an operator approves
them. A rejected note stays rejected however often the blocker recurs, so it cannot
drift back into the review queue and be approved by accident.

```sh
DATABASE_PATH=/absolute/path/travelclaw.db pnpm --filter @travelclaw/api browser:notes list
DATABASE_PATH=/absolute/path/travelclaw.db pnpm --filter @travelclaw/api browser:notes approve <id>
DATABASE_PATH=/absolute/path/travelclaw.db pnpm --filter @travelclaw/api browser:notes reject <id>
```

`list` labels each row with how it was detected, so an operator can see which
approvals are confirming a fact and which are trusting a page.

Approved notes are supplied alongside the site with `reviewedSteps`, at most five,
most-repeated first. They are hints about what to expect, not permissions: a note
cannot widen the network scope, unlock a control tier, or supply a value.

## Worked example: ibomair.com, step by step

A traveler session on Ibom Air (2026-10-11) walked the whole flow. Each step maps
to a capability the worker either has or deliberately lacks. This is the reference
for "can the agent do this site".

| Step (as the traveler saw it)                                | Worker capability                                                                                                                                                                                       |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Search form on `ibomair.com` (From/To/dates/party)           | Fillable. From/To are a combobox; the snapshot offers `role=combobox`/`option` refs and the chosen city must be stated in the request.                                                                  |
| From list shows only QUO, ABV, CBQ, LOS, PHC, ACC            | Not needed up front: the dropdown's options are read from the page, and grounding ties the pick to the traveler's words. The fixed origin list is recorded in the carrier directory as a note instead.  |
| Date fields hold `26.10.2026`                                | Now grounded. Date slots accept the page's notation of a date the traveler stated (`26 October 2026` → `26.10.2026`). A different day is still refused.                                                 |
| Search click navigates to `book-ibomair.crane.aero`          | Allowed only if the operator lists that origin in the site config; it is a different origin from the marketing site.                                                                                    |
| Cloudflare "Verify you are human" on the results page        | **The worker stops.** `pageState` matches the challenge and hands off `verification`, records a `human_verification` site note, and leaves the deep link for the traveler. It never bypasses a CAPTCHA. |
| Availability page (date-price strip, fare columns)           | Observable: `browser_observe` quotes one result verbatim with its fare-family conditions.                                                                                                               |
| Fare family page (Saver/Discount rules, price button)        | Conditions are captured as `visibleConditions`; the price button is a control the model may click within scope.                                                                                         |
| Passenger page (gender, title, first/last name, nationality) | Booking tier. Reachable only with the operator's `bookingPaths` **and** the traveler's recorded approval; name fields fill, payment never does.                                                         |
| Payment / confirmation steps                                 | **Closed by construction.** `neverControl` and the network `neverPath` refuse them for every session. The carrier directory marks Ibom `pay_at_booking`, so the desk hands off at payment.              |

The honest summary: the worker can fill the search form, read the results and fare
rules, and — with the operator's scope plus the traveler's approval — fill the
passenger page. The two places it stops are exactly the two places it must: the
Cloudflare human-verification challenge and the payment step. Both stops are
recorded (a site note and the carrier directory respectively) so the next run and
the next traveler get the truth instead of a retry.

## Verification and remaining acceptance work

```sh
pnpm test          # contracts, transport policy/pinning, gateway/persistence, UI
pnpm test:browser  # real Chromium against local fixture pages; install Chromium first
pnpm build
pnpm typecheck
```

CI installs Chromium and runs both suites. Tests cover navigation, fill/select/click,
visible provenance, invented-price rejection, blockers, stale refs, cookie/storage
and session-key isolation, network restrictions, prompt-injection tool attempts,
limits, cancellation, worker cleanup, provider-first routing, ownership, hold rejection,
review gates and UI disclaimers. The development sandbox blocked Playwright's browser
CDN, so fixture tests here used an npm-distributed Chromium 153 executable with its
runtime libraries. All **27 browser fixtures passed with Chromium sandboxing enabled**
using the test-only executable override and `TRAVELCLAW_TEST_CHROMIUM_SANDBOX=1`.
The fixture launcher also supports unsandboxed local fixtures; production has no such
switch. This proves sandboxed fixture execution, not the sanitized production launcher
or Docker containment. No live third-party site is needed by CI.

The complete local check passed **328 regular tests + 27 sandbox-enabled browser
tests (355 total)**, `pnpm build`, `pnpm typecheck`, changed-file formatting and
`git diff --check`.

The added regression coverage includes date digits mistaken for party counts,
verification appearing after a snapshot, sensitive payment/OTP/username autocomplete
values, HTTP continuation after denial, bounded concurrent requests/streaming bytes,
ownership changes during model/observation calls, and initial persistence failure.

**Keep #25 open:** a permitted public travel-site vertical slice is still outstanding.
Actual HTTPS probes from this sandbox to BlazeDemo, Wikivoyage, example.com and the
Debian mirror failed during TLS setup (`curl` exit 35, HTTP 000); GitHub was reachable.
This is an environment connectivity limitation, not evidence that those sites blocked
bots. No live model credential is configured in the checkout. No live fare search has
been demonstrated, and the production worker/container still needs host validation
(Docker is unavailable here). A direct `BrowserEngine.launch` smoke was attempted
and could not start because Playwright’s expected Chromium headless-shell executable
is absent; the npm Chromium fixture override is not used by production. Fixture fares are synthetic test data, never evidence
of a real available flight. BlazeDemo is itself synthetic and would not establish a
real airline fare even if reachable. Record a permitted public travel search and its
provenance on a connected, configured deployment before closing the issue.
Existing signed-in browser attachment and interactive remote takeover are not supported;
handoff is explicitly a source link plus a request for the missing input/action.
