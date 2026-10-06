# Retries

A turn is a chain — the model, then the tools it asked for, then a provider or
two — and every link in it is a network call that can fail for a second: a rate
limit, a deploy, a socket dropped in transit. The turn is only as good as its
weakest link, so one retry engine serves every outbound call rather than each
call site inventing its own loop.

The engine lives in `packages/agent-core/src/retry.ts`; the fetch-shaped wrapper
over it, `fetchWithRetry`, is in `packages/agent-core/src/http.ts`. Both are
framework-free and tested without a network.

## The six rules

1. **Stop means stop.** The turn's `AbortSignal` is checked before every attempt,
   honoured during every pause, and passed into the request itself. A cancelled
   turn is never retried, and never leaves a timer behind.
2. **A permanent answer is not a slow one.** Only `408`, `425`, `429`, `500`,
   `502`, `503`, and `504` are retried. `401` and `403` are the vendor's decision
   — retrying spends the operator's rate limit and the traveler's time to hear it
   twice.
3. **What the vendor asked for wins, within limits.** `Retry-After` is read
   (seconds or an HTTP date) and used instead of the backoff — but capped, and a
   wait longer than the cap is treated as a refusal. A desk that waits an hour
   has stopped serving the person in front of it.
4. **The budget is wall-clock, not a count.** One deadline covers every attempt
   _and_ every pause between them, so three slow attempts cannot become a minute
   of waiting. If a pause would leave the next attempt to be cut off, the call
   gives up instead of paying for it.
5. **Pauses are jittered.** A search fans out to several sources at once. Equal
   jitter (half the pause fixed, half random) keeps sources that failed together
   from coming back together.
6. **A state-changing request is never retried blindly.** Losing a hold is
   inconvenient; creating two is not.

## Where retries apply

| Call                                  | Attempts | Pause      | Budget | Notes                                                           |
| ------------------------------------- | -------- | ---------- | ------ | --------------------------------------------------------------- |
| Model completion (`ModelService`)     | 3        | 200–400 ms | 45 s   | Only while nothing has been written — see below.                |
| Flight and stay search (each source)  | 2        | 125–250 ms | 12 s   | Per source; sources still fail independently and are disclosed. |
| `web.search` and `web.fetch`          | 2        | 125–250 ms | 12 s   | Body is replayable; a discarded response body is cancelled.     |
| `currency.convert`, `weather.outlook` | 2        | 60–120 ms  | 5.2 s  | Behind them sits the labeled desk table or seasonal card.       |

The budget bounds the whole call, so the numbers above are worst cases rather
than typical ones: a source that answers on the second try costs one pause, not
the full budget.

## Where they deliberately do not

- **A hold.** `POST {base}/holds` changes state and the desk has no idempotency
  key to offer the source, so a request that timed out may already have been
  honoured. Retrying can create a second hold nobody asked for. The traveler is
  told no hold exists and can ask again — once — with a reference to point at.
- **Browser worker actions.** A click, a fill, and a submit are not replayable,
  and the session call that opens one is stateful. The worker keeps its own
  timeouts.
- **A stream that already wrote a word.** Once the model has started writing,
  the words on the screen are the answer. A stream that breaks mid-sentence is
  kept as a partial answer with a line saying it stopped, which is honest; a
  retry would put the same sentence there twice. A stream that breaks _before_
  the first word — including one that returns nothing at all — is retried,
  because nothing has been shown yet.
- **A request whose body cannot be sent twice.** A streamed body is consumed by
  the first attempt; a second would send the vendor half a request, or throw.
  `canReplayBody` decides, and a body it refuses forces a single attempt.
- **A redirect.** `redirect: 'error'` is this desk's own refusal; following it on
  a second attempt is not what the operator configured.

## What a failure looks like from the outside

Nothing about a successful retry is visible to the traveler, and that is the
point: the sentence is written once, the tool result is the one that arrived, and
the process trail shows the tool that ran. A call that fails after its budget is
reported exactly as it was before this work — the desk rendering for the model,
the labeled fallback for a rate or forecast, a disclosed source failure for a
search. Retries are logged as warnings naming the provider, the attempt, and
the reason, so an operator can see flakiness without reading response bodies.

## Testing

`packages/agent-core/src/retry.test.ts` covers the engine with an injected
clock, coin, and pause: the backoff curve, the budget, Stop during an attempt and
during a pause, and `Retry-After` winning over the backoff.
`packages/agent-core/src/http.test.ts` covers the fetch wrapper — including that
a discarded response body is cancelled, that a 401 is asked once, and that a
request with a streamed body is sent once.
`apps/api/test/model-retry.test.ts` covers the model call: a 503 that recovers,
a refused key, a `Retry-After` longer than the desk will wait, a stream that
breaks before and after its first word, and Stop.
