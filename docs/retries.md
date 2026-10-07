# Retries

A turn is a chain — the model, then the tools it asked for, then a provider or
two — and every link in it is a network call that can fail for a second: a rate
limit, a deploy, a socket dropped in transit. The turn is only as good as its
weakest link, so one retry engine serves every outbound call rather than each
call site inventing its own loop.

The engine lives in `packages/agent-core/src/retry.ts`; the fetch-shaped wrapper
over it, `fetchWithRetry`, is in `packages/agent-core/src/http.ts`. Both are
framework-free and tested without a network.

## Goals

These three are [OpenClaw's](https://docs.openclaw.ai/concepts/retry), and they
are the right ones for a desk that runs several calls in one turn:

- **Retry per HTTP request, not per multi-step flow.** A turn is a flow; a
  single fare search inside it is a request. Only the request repeats.
- **Preserve ordering by retrying only the current step.** A retried `web.fetch`
  never jumps ahead of the `web.search` that named it; the turn's tool plan is
  untouched by any of this.
- **Avoid duplicating non-idempotent operations.** Holds, browser actions, and
  anything already on the traveler's screen are excluded — see below.

## The rules

1. **Stop means stop.** The turn's `AbortSignal` is checked before every attempt,
   honoured during every pause, and passed into the request itself. A cancelled
   turn is never retried, and never leaves a timer behind.
2. **A permanent answer is not a slow one.** Only `408`, `409`, `425`, `429`,
   `500`, `502`, `503`, and `504` are retried. `401`, `402`, and `403` are
   authentication and billing answers, which OpenClaw keeps out of its transient
   budget for the same reason this desk does: they will not change inside a
   turn. A `404` or a `422` is the vendor's decision about the request.
3. **What the vendor asked for is a floor, not a suggestion.** `Retry-After`,
   `retry-after-ms`, and "try again in 300ms" hints in an error body set the
   wait, and the desk's own backoff cap does not shorten it — asking sooner is
   how a rate limit is tripped twice. The wait is the larger of the vendor's ask
   and the desk's backoff, composed the way Hermes composes it.
4. **No usable wait means no wait.** A zero or expired cooldown is not "retry
   now": Hermes treats it as no information at all, so the desk falls back to
   its own backoff instead of hot-looping the provider.
5. **There is a wait the desk will not sit through.** `maxWaitMs` is the longest
   pause it will take from any source. A vendor asking for longer ends the call
   and takes the fallback. This is the line OpenClaw draws with
   `maxRetryDelayMs` (past it, a run goes to model fallback rather than waiting)
   and Hermes with `LIVE_RETRY_WAIT_CAP_S` ("an attended session ends the turn
   instead of sitting through it"). A traveler watching an answer being written
   is an attended session.
6. **The budget is wall-clock, not a count.** One deadline covers every attempt
   _and_ every pause between them, so three slow attempts cannot become a minute
   of waiting. If a pause would leave the next attempt to be cut off, the call
   gives up instead of paying for it.
7. **Pauses are jittered.** A search fans out to several sources at once. Equal
   jitter (half the pause fixed, half random) keeps sources that failed together
   from coming back together — the reason Hermes names for jittering at all.
8. **A wait is shown, not hidden.** The turn emits one stage for the wait and
   closes it when the answer lands, and Stop keeps working throughout. OpenClaw
   shows the same single transient indicator: a pause the traveler did not ask
   for is a pause the traveler should be able to see.

## Where retries apply

| Call                                  | Attempts | Pause      | Longest wait | Budget |
| ------------------------------------- | -------- | ---------- | ------------ | ------ |
| Model completion (`ModelService`)     | 3        | 200–400 ms | 20 s         | 45 s   |
| Flight and stay search (each source)  | 2        | 125–250 ms | 3 s          | 12 s   |
| `web.search` and `web.fetch`          | 2        | 125–250 ms | 3 s          | 12 s   |
| `currency.convert`, `weather.outlook` | 2        | 60–120 ms  | 1 s          | 5.2 s  |

"Longest wait" is the cap on a pause from any source, including one a vendor
named. The budget bounds the whole call, so these are worst cases, not typical
ones: a source that answers on the second try costs one pause, not the budget.

## Where they deliberately do not

- **A hold.** `POST {base}/holds` changes state and the desk has no idempotency
  key to offer the source, so a request that timed out may already have been
  honoured. Retrying can create a second hold nobody asked for. OpenClaw draws
  the same line around `push` and `pull`: "a failed connection can follow an
  accepted write."
- **Browser worker actions.** A click, a fill, and a submit are not replayable,
  and the session call that opens one is stateful. The worker keeps its own
  timeouts.
- **A stream that already wrote a word.** Once the model has started writing,
  the words on the screen are the answer. A stream that breaks mid-sentence is
  kept as a partial answer with a line saying it stopped, which is honest; a
  retry would put the same sentence there twice. A stream that breaks _before_
  the first word — including one that returns nothing at all — is retried once,
  because nothing has been shown and nothing has been paid for.
- **A request whose body cannot be sent twice.** A streamed body is consumed by
  the first attempt; a second would send the vendor half a request, or throw.
  `canReplayBody` decides, and a body it refuses forces a single attempt.
- **A redirect.** `redirect: 'error'` is this desk's own refusal; following it on
  a second attempt is not what the operator configured.

## Divergences, and why

Both projects do things this desk deliberately does not.

- **Hermes fails a search over to the next vendor in a ring** — a rate-limited
  request retries on another provider, and a failed keyed backend is rescued by
  the keyless free tier. This desk does the opposite on purpose: an operator
  search source that answers nothing usable is reported as that source's
  failure, and never silently swapped for a public scrape, because which source
  answered is part of the answer a traveler is given. If a failover is ever
  added, Hermes' rule for disclosing one is the right one — it names
  `rescued_from` and `backend_error` in the result rather than quietly
  substituting.
- **OpenClaw gives rate limits ten attempts and other transient failures eight,
  inside a 90-second window measured per run**, and recovers by _continuing the
  transcript_ with an instruction to preserve completed work. A background agent
  run can afford that. A traveler watching one answer cannot, so the desk keeps
  a per-call budget and retries the request, not the turn.
- **OpenClaw rotates auth profiles and falls back to another model** once its
  retry budget is spent. TravelClaw has a model catalog but no failover ladder;
  when the budget is spent, the desk rendering is the answer. That is a roadmap
  question, not a retry one.

## Testing

- `packages/agent-core/src/retry.test.ts` — the engine with an injected clock,
  coin, and pause: the backoff curve, the budget, Stop during an attempt and
  during a pause, and a vendor's schedule beating — or ending — the desk's own
  pace.
- `packages/agent-core/src/http.test.ts` — the fetch wrapper: a discarded body
  is cancelled, a 401 is asked once, a wait longer than the desk will take ends
  the call, a hint in an error body is read when no header names one, a streamed
  body is sent once, and Stop before and during.
- `apps/api/test/model-retry.test.ts` — 503 that recovers, refused key, an hour's
  `Retry-After`, a short one honored in full, a hint read out of a body, retries
  spent → desk rendering, a stream that breaks before and after its first word,
  an empty completion asked once more and no more, the reason a wait is shown,
  and Stop.
- `turn.test.ts` — the tools receive the turn's Stop, a stopped turn stops the
  call in flight, and the wait appears as a stage that is closed again.
- `providers.test.ts` — a source that hung is tried once more, inside the search
  budget.
