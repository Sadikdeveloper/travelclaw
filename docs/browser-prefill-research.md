# Browser prefill research — how OpenClaw and Hermes do it

**Status: the three pieces this page recommends are now built** — force-redaction
of browser output, the tiered control gate with an operator booking scope, and a
batched fill with a post-action navigation recheck. See
[What was built](#what-was-built) for what exists, what is tested, and what is
still missing. The research below is what those decisions were made from.

Reviewed on 2026-10-11 against the same commit-pinned revisions
[browser-research.md](browser-research.md) already records:
OpenClaw `a754556`, Hermes `4393341`. Everything attributed to either project
below was read out of those trees, not recalled. Where this page says TravelClaw
does or does not do something, it names the file and line.

The question: **the agent should visit the carrier's site itself and prefill the
booking, anywhere in the world.** This page records what the two reference
implementations do, what TravelClaw already has, and exactly what blocks it.

## First, the finding that reframes the work

TravelClaw's worker is not missing a fill capability. It has one. What blocks
booking is a deliberate gate, and it blocks the booking _button_ by name.

`apps/browser-worker/src/engine.ts:56`:

```ts
const forbiddenControl =
  /\b(password|passcode|passport|email|e-mail|phone|card|payment|checkout|purchase|pay|reserve|reservation|book now|confirm booking|sign in|log in|login|sign up|accept cookies|accept all|consent)\b/i;
```

Enforced at `engine.ts:461` (click) and `engine.ts:618` (fill/select), alongside a
hard refusal of input types `password`, `file`, `email`, `tel`, `hidden`.

So on any airline site, the worker hands off at the control labelled _Book now_,
_Reserve_, or _Confirm booking_. That regex is one token list. The work here is
not "add automation"; it is **splitting that list into three tiers and authorizing
the middle one per site**, while the payment tier stays permanently closed.

## What OpenClaw does that is worth copying

### 1. Prefill is one batched action over field refs

`extensions/browser/src/browser/client-actions.types.ts`:

```ts
export type BrowserFormField = { ref: string; type: string; value?: string | number | boolean };
// ...
| { kind: "fill"; fields: BrowserFormField[]; targetId?: string; timeoutMs?: number }
```

Three things to notice:

- **A whole form is one action, not N round trips.** TravelClaw fills one element
  per call, which on a passenger-details form means a snapshot-and-act cycle per
  field against a 20-action lease.
- **Each field carries its control `type`.** The runtime knows whether it is
  setting text or ticking a checkbox, and can refuse a type it will not touch.
  This is the mechanism that lets a _tiered_ gate exist at all: the refusal is
  per field type, not per page.
- **The value may be a boolean or number**, so a checkbox or a party size is
  expressible without stringifying it.

`batch` composes those: up to `ACT_MAX_BATCH_ACTIONS = 100` actions at depth 5
(`act-policy.ts`), `stopOnError` by default, with an explicit warning that a
state-changing nested action can invalidate earlier refs for the rest of the
batch — put state-changing actions first, or re-snapshot and split.

### 2. Every action gets a computed execution budget, plus a navigation grace

`act-policy.ts` does not use one global timeout. It derives one:

```ts
case "fill": {
  const fieldCount = fields.filter(/* has a non-blank ref */).length;
  return addNavigationGraceMs(
    multiplyExecutionBudgetMs(resolveInteractionTimeoutMs(request), fieldCount),
    fieldCount,
  );
}
```

and then, separately:

```ts
export const BROWSER_ACTION_NAVIGATION_GRACE_MS = 250;
export const EXISTING_SESSION_NAVIGATION_RECHECK_DELAYS_MS = [0, 250, 500] as const;
```

Two lessons. A batch's budget must **scale with its contents** or it aborts valid
work halfway. And after an action, you must **re-check whether it navigated** at
0/250/500ms, because a submit that reloads the page invalidates every ref you
were holding — which on a booking form is the difference between "filled" and
"filled, then the site moved".

### 3. Stale-ref recovery is a bounded retry, then an honest report

`skills/browser-automation/SKILL.md`, "Stale Ref Recovery":

> 1. Snapshot the same `targetId` again. 2. Find the current visible control.
> 2. Retry once with the new ref. 4. If the UI moved to a blocker state, report
>    the blocker instead of looping.

TravelClaw already does step 1–2 and the stale-ref rejection. What it lacks is
the **"retry once, then report"** shape — today a stale ref is a terminal handoff.

### 4. Do not mistake a dialog for a logged-out state

> Do not claim the browser is not logged in just because the current page shows a
> permission or onboarding dialog. Inspect the visible UI first.

Directly relevant: a cookie-consent overlay on an airline site is the single most
common reason a booking flow looks blocked. TravelClaw's `forbiddenControl` list
includes `accept cookies|accept all|consent`, which means the worker refuses to
dismiss the very overlay that is hiding the form. That is an edge case worth
solving deliberately — consent dismissal is not a credential action. _Still open:_
consent controls remain in the `never` tier, because a dismissal that is safe on
one site is an account-scoping decision on another and the worker cannot tell
them apart from the label alone.

### 5. Waits are conditions, not sleeps

`wait` accepts `text`, `textGone`, `selector`, `url`, `loadState`, `fn`, and the
budget is multiplied by how many conditions were given. The skill says it plainly:
"Avoid blind waits. Wait for visible UI state when possible." A booking flow is
mostly waiting for the next step to render.

## What Hermes does that is worth copying

### 1. Browser output is redacted at the model boundary, unconditionally

`tools/browser_tool_snapshot.py`:

```python
def _redact_browser_output(value: Any) -> Any:
    """Force-redact secrets in browser-originated data (snapshots, console, eval
    results can carry page-rendered keys/cookies/tokens). Tool output is a model
    boundary, so this applies even when global log redaction is disabled."""
```

and it recurses through lists, tuples, and **both keys and values** of dicts.

This is the single most important line on this page for a booking feature. The
moment the worker stands on a passenger-details page, the snapshot contains the
traveler's name, email, phone, and possibly a payment form. Hermes's answer is
that redaction is a property of the _boundary_, not of the logging config, so it
cannot be switched off by an operator preference. TravelClaw scrubs connector keys
in adapters but has no equivalent force-redaction on browser-originated text.

### 2. A human takeover fence that brackets the whole run

`tools/browser_tool_session.py`, `run_fenced`:

> That browser lives on the Bot Desktop screen, in the same profile a human who
> took over is typing into. While the human holds the lease every action AND read
> against it is refused (the page may show their credential); the fence brackets
> the whole run so a takeover mid-command also voids the result.

```python
if _bd_lease.get().epoch != admitted.epoch:
    return {"success": False, "code": "human_has_control",
            "error": "A human took over the bot's screen while this browser command ran; its result was "
                     "discarded. Tell the user what you need; retry once they hand back."}
```

The load-bearing detail is that the fence is checked **again after** the work
completes, and a mid-run takeover discards the result. For a booking flow where a
human is expected to take over at the payment step, this is the correct model:
the agent's view of the page is void the instant the human touches it, so it
cannot later report a state it did not observe.

### 3. Oversized snapshots are truncated _and stored_, never silently dropped

`_store_full_snapshot` writes a capped copy and the truncated view names where the
rest went. TravelClaw deliberately does not spill snapshots to disk
([browser-research.md](browser-research.md), "Deliberately not imported"), which
is the right call for a search worker — but a booking flow that must quote a
booking reference out of a long confirmation page needs a bounded-read answer, not
a truncation that loses the reference.

## What TravelClaw already has

Worth stating, because the gap is narrower than it looks:

- A `fill` action with `snapshotId` + `elementId` + `value`, plus `select`,
  `click`, `inspect`, `navigate`, `observe`, `stop`
  (`packages/shared/src/browser.ts`, `browserActionSchema`).
- A canonical travel-field vocabulary — `fill_origin`, `fill_destination`,
  `fill_departure_date`, `fill_return_date`, `fill_travelers`, `fill_currency`,
  `fill_language`, `click_search`, `observe` (`browserWorkflowStepSchema`) — and
  label matching that maps a page's own field labels onto it (`engine.ts:655`,
  `fieldSlot`).
- Operator-reviewed reusable procedures (`browser_procedures`), which start
  `pending` and can only be approved from the CLI.
- Exact-quote evidence for observations, with the executor stamping source,
  timestamp, and snapshot id — the model cannot choose provenance.
- A DNS-pinning Node transport, no `evaluate`, no uploads or downloads, no
  signed-in profile.

## What blocked the prefill, concretely

Status as of 2026-10-11: **1–5 and 7 are resolved**, 6 is open. Row 1 is resolved
as a _tiering_ — `pay` is still refused everywhere; it is `book now` and
`confirm booking` that an authorized, confirmed session may now reach.

| #   | Blocker                                                                    | Where                                                                                                                                  | Why it exists                                                                 |
| --- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 1   | `forbiddenControl` refuses `reserve`, `book now`, `confirm booking`, `pay` | `engine.ts:56`, enforced at `:461` and `:618`                                                                                          | Correct for a search worker: those are exactly the controls it must not press |
| 2   | Input types `email` and `tel` are refused outright                         | `engine.ts:461`                                                                                                                        | Contact details are personal data; a search worker has no use for them        |
| 3   | Site authorization permits **search-only** POST paths                      | `browserSiteSchema.searchPostPaths` in `browser.ts`; `docs/browser-agent.md` says "Do not list checkout, account or payment endpoints" | The whole authorization model is scoped to public search                      |
| 4   | No human-confirm gate before a submit                                      | —                                                                                                                                      | Nothing needed one before                                                     |
| 5   | One element per action, against a 20-action lease                          | `browserActionSchema`; budgets in `docs/browser-agent.md`                                                                              | A search is a handful of fields; a booking is not                             |
| 6   | Observation is `bookingEligibility: 'not_bookable'`, a literal             | `browserObservationSchema` in `browser.ts`                                                                                             | The schema was written to make a false booking claim unrepresentable          |
| 7   | No force-redaction of browser-originated text                              | —                                                                                                                                      | Search snapshots carry no personal data                                       |

## The design this points to

**Tier the control gate instead of widening it.** Three lists, not one:

- **Never** — `password`, `passcode`, `card`, any payment or OTP field, and the
  input types `password`/`file`/`hidden`. Not operator-configurable, not
  site-scoped, no env var. This tier is the reason the feature is acceptable.
- **Booking** — passenger name, date of birth, contact email/phone, and the
  submit control. Reachable only on a site whose authorization carries an
  explicit booking scope, and only with a recorded human confirm before submit.
- **Search** — what runs today, unchanged.

**Add a booking scope to the site authorization.** `origins` plus
`bookingPaths`, granted per site by the operator, with the payment path excluded
by construction. Removing the scope revokes the capability, exactly as removing an
origin does today.

**Human confirm before submit, recorded.** The agent fills, then stops and shows
what it filled. Submit is a separate, explicitly authorized action, and the
confirmation records the snapshot id, the timestamp, and the traveler's approval.
This is the step that makes an autonomous fill defensible.

**Batch the fill, budget it by field count.** One `fill` over field refs, with
OpenClaw's per-field budget arithmetic and the 0/250/500ms navigation recheck, so
a submit that reloads does not leave the agent holding dead refs.

**Adopt the lease fence.** The traveler taking over at the payment step is the
designed flow, not a failure. Borrow Hermes's epoch check: if control changed
mid-run, discard the result and say so.

**Force-redact browser output at the boundary.** Before any snapshot reaches a
tool result, a task row, memory, or a prompt. Non-optional, per Hermes.

**Widen the observation, but keep the literal.** A booking outcome needs its own
schema — a reference quoted exactly from the page, with the same executor-stamped
provenance — and `bookingEligibility` should stay a closed enum so that
"the agent believes it booked something" remains unrepresentable without evidence.

## Edge cases to design for, from the two implementations

1. **Consent walls.** The most common false blocker. Dismissing a cookie banner is
   not a credential action and should be permitted, but it is currently in the
   forbidden list.
2. **A dialog is not a logout.** OpenClaw's rule, verbatim above. Inspect before
   reporting `sign_in`.
3. **Navigation on submit.** Recheck at 0/250/500ms; a stale ref after a submit
   means re-snapshot, not retry-with-the-old-ref.
4. **Retry once, then report.** Bounded stale-ref recovery, then a blocker.
5. **Batch ordering.** State-changing actions first, or split the batch — a click
   that navigates invalidates later refs.
6. **Blind waits lose.** Wait on visible state (`text`, `url`, `loadState`).
7. **Truncation must not eat the reference.** A bounded read that names where the
   rest went, rather than a silent cut.
8. **Takeover mid-run voids the result.** Even a successful read.
9. **Page text is untrusted.** Already a TravelClaw rule; it matters more on a
   booking page, where injected text could read like a confirmation.

## What was built

Three changes, in the order the research recommends.

### 1. Force-redaction of browser output (`apps/browser-worker/src/redact.ts`)

`redactBrowserText` runs on page text at the point `pageState` reads it, and on
every control's `name`/`id`/`autocomplete` triple in `controlInfo`, so nothing
downstream — snapshot, observation evidence, a refusal message — sees the
unredacted page. There is no configuration that disables it.

It redacts card-length digit runs, emails, phone numbers, bearer tokens, JWTs,
cloud and platform keys, and private key blocks. Two false positives were found
and fixed by the tests rather than by inspection, and both are recorded in the
source because they will recur:

- a per-digit `[ -]?` separator let the card pattern run through an ISO date and
  into the digits after it, so `Departs 2026-11-02 at 08:00` was redacted whole;
- treating `-` as a phone separator made every `YYYY-MM-DD` on a page a phone
  number.

The rule that fell out: separators in a secret pattern must be anchored to the
shape of the secret, and a hyphen is not distinctive enough to be one.

### 2. The tiered control gate (`admitControl` in `engine.ts`)

The single `forbiddenControl` list is gone. `admitControl(policy, info, previousLabel)`
is now a pure, exported function that both call sites go through — the snapshot,
which decides what a session is offered at all, and the action handler, which
decides what it may touch — so they cannot drift.

| Tier      | Contents                                                                    | Reachable by                                                     |
| --------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `never`   | payment, card, CVV, expiry, credentials, OTP, passport/national ID, consent | nobody, including a confirmed booking session                    |
| `booking` | passenger name, contact email/phone, the submit control                     | operator site scope **and** the traveler's recorded confirmation |
| `search`  | the travel-field vocabulary that already worked                             | every session, unchanged                                         |

Three properties worth naming:

- **Order decides.** `never` is tested first, so "Confirm booking and pay" is
  refused rather than pressed.
- **The page cannot rename its way in.** The tier is classified from the label
  _and_ the control's `name`/`id`/`autocomplete` _and_ its own `sensitive` flag,
  so a card field labelled "Details" is still closed. A test caught `cardNumber`
  slipping past a word-boundary regex; the regex gained `card.?number` rather than
  the test being relaxed.
- **Neither half substitutes for the other.** A traveler's yes does not grant a
  site the operator never scoped, and an operator scope does not stand in for the
  traveler's confirmation. The refusal names which half is missing, because the
  remedies differ.

A site opts in with `bookingPaths` in `TRAVELCLAW_BROWSER_SITES_JSON`. Empty means
search-only, which is the default and the previous behaviour. The network policy
splits to match: `reserve`/`reservation` may pass for an exact listed booking
path, while `checkout`, `payment`, `purchase`, `creditcard`, `login`, `password`,
and `authorization` are refused regardless of what an operator lists — and a
booking session's bypass is scoped to the exact listed path, not a general
widening (a test caught it widening every GET).

### 3. Batched fill and the navigation recheck

`fillMany` takes parallel `elementIds`/`values` arrays — parallel rather than an
array of objects because the model-facing JSON Schema generator supports flat
types only, which a nested object array broke at import. It is validated
all-or-nothing before anything is written, so a batch can never leave a form
part-filled and looking complete, and every field passes the same tiered gate as
a single fill.

After any state-changing action the worker rechecks the URL at 0/250/500ms, as
OpenClaw does. If the page moved, the result carries a fresh snapshot and says the
earlier controls are gone, so the next action cannot be aimed at a dead ref.

### What is still missing

- **No confirmation surface.** `bookingConfirmed` is plumbed gateway → worker, but
  nothing sets it yet: there is no traveler-facing "yes, fill my details" step.
  Until that exists every run is a search run, which is the safe default.
- **No lease fence.** Hermes's epoch check — a human takeover mid-run voids the
  result — is not implemented, and it should be before a booking run is reachable.
- **No procedure learning for bookings, by design.** A booking session opens with
  `learnable` false, because a booking depends on one traveler's details and a
  procedure is shared.
- **The Chromium fixture suite did not run here.** See
  [Verification](#verification).

## Verification

`pnpm test` passes 686 tests: 42 shared, 267 agent-core, 273 api, 80
browser-worker, 24 web. `pnpm build` and `pnpm typecheck` are clean.

The 27 real-Chromium fixture tests were **skipped, not passed**. Chromium could
not be launched in this sandbox: the Playwright and Google download CDNs are
unreachable, the npm-distributed Chromium that was reachable needs `NSS_3.30`
symbols, and the only NSS build available over npm is older than that, with every
Debian mirror blocked. So the gate, the redaction, and the network policy are
covered by 45 new direct unit tests that execute the shipped functions —
`admitControl`, `controlTier`, `redactBrowserText`, `permittedUrl` — but the
Playwright integration paths (fill actually writing to a page, the navigation
recheck firing against a real submit, redaction inside a real snapshot) are
**unverified** and must be run on a host with a browser before this is trusted.

## Worldwide coverage of the directory

The route table in `packages/agent-core/src/airlines.ts` will never list the
world, and should not try — routes change seasonally and a stale "no one flies
this" is worse than no row. Coverage comes from three places instead:

1. **The fare source names the carrier.** `flights.search` returns a carrier for
   any pair on earth, and `airlines.find` now takes that name as a `carrier`
   argument, so the directory answers by carrier worldwide even when it has no
   opinion about the route. That is the shipped path.
2. **Harvest candidates from live searches.** The desk already has the exact
   pattern: `browser_procedures` records structurally recognizable results as
   `pending` rows that an operator reviews from the CLI. A carrier seen in a real
   fare result can become a `pending` directory candidate the same way — never
   auto-approved, because a booking URL and a payment order are facts someone has
   to read on the carrier's own site.
3. **A schedule or content API, if breadth is ever needed.** Amadeus, Duffel, or
   similar, queried at request time. That is a paid dependency and a new adapter;
   it is the right answer for schedules and the wrong answer for "does this
   carrier let you hold a seat before paying", which no API will tell you.

The hand-kept table stays small on purpose. Its job is the slow-changing facts no
vendor API carries: who the carrier is, where they book, and whether a reservation
can exist before payment.
