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
3. Enumerate exact HTTP(S) origins required by the search, including permitted assets.
   Wildcards, URL credentials and nonstandard ports are not accepted. Only GET/HEAD
   and explicitly listed **search-only** POST paths can pass. Do not list checkout,
   account or payment endpoints. Do not put credentials or personal values in config.
4. Exercise the flow on a local fixture first. Check controls, redirects, subresources,
   result evidence, denied operations and the handoff copy. The conservative worker
   can hand off rather than support every modern travel-site widget.
5. Validate a permitted live flow manually, record source/date/conditions, and review
   any proposed procedure. Removing the source or origin revokes access. Restart the
   worker after changing authorization; procedure approval cannot expand it.

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
