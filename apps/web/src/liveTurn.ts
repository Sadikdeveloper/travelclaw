import type { LiveTurnRecord, TurnStepRecord } from '@travelclaw/shared';
import { api } from './api';
import type { LiveTurnState } from './components/LiveTurn';

/**
 * Watching a turn from the side.
 *
 * The POST that starts a turn streams its own progress back, which is the fast
 * path and usually the only one needed. But that response can be held up on the
 * way in — a proxy that buffers a response until it ends, an extension, a very
 * slow link — and then a live turn degrades back into "send, wait, read the
 * result at the end", which is exactly what it was built not to be.
 *
 * So while a turn runs, this reads `GET /api/sessions/:id/turn` on a short
 * interval: one plain request that no proxy has a reason to hold, carrying the
 * same steps and the same words. What it returns is folded into the live card
 * without ever moving it backwards, so the fast path and the floor can race
 * freely.
 */

/** The floor's interval. Slow enough to be cheap, fast enough to look live. */
const POLL_MS = 700;

/**
 * Follow one chat's running turn until the caller stops it. Returns a stop
 * function; a watcher that never sees a turn (or sees it end) simply stops when
 * the turn's own request settles.
 */
export function watchLiveTurn(input: {
  sessionId: string;
  signal: AbortSignal;
  onSnapshot: (snapshot: LiveTurnRecord) => void;
}): () => void {
  let stopped = false;
  let followed: string | null = null;

  const sleep = () =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, POLL_MS);
      const wake = () => {
        clearTimeout(timer);
        resolve();
      };
      input.signal.addEventListener('abort', wake, { once: true });
    });

  void (async () => {
    while (!stopped && !input.signal.aborted) {
      await sleep();
      if (stopped || input.signal.aborted) break;
      try {
        const answer = await api<{ turn: LiveTurnRecord | null }>(
          `/api/sessions/${input.sessionId}/turn`,
          { signal: input.signal },
        );
        const snapshot = answer.turn;
        if (!snapshot) continue;
        // One watcher follows one turn: the first one it hears about is the one
        // this traveler started. Anything else in the same chat is somebody
        // else's turn (an older tab) and is left alone.
        followed ??= snapshot.turnId;
        if (snapshot.turnId !== followed) continue;
        input.onSnapshot(snapshot);
      } catch {
        // A read that fails is not worth a banner: the stream is still the
        // primary channel, and the next tick tries again.
      }
    }
  })();

  return () => {
    stopped = true;
  };
}

/**
 * Take on what the gateway reports about the running turn — and never take a
 * step backwards. The stream and the floor are two views of one turn arriving
 * out of order, so words are adopted only when there are more of them, and a
 * step is adopted only when it says something the screen does not already.
 */
export function adoptLiveTurn(
  current: LiveTurnState | null,
  snapshot: LiveTurnRecord,
): LiveTurnState | null {
  if (!current) return current;
  const steps = mergeSteps(current.steps, snapshot.steps);
  const reasoning =
    snapshot.reasoning.length > current.reasoning.length
      ? snapshot.reasoning
      : current.reasoning;
  const reply = snapshot.reply.length > current.reply.length ? snapshot.reply : current.reply;
  const modelLabel = snapshot.modelLabel || current.modelLabel;
  const provider = snapshot.provider || current.provider;
  if (
    steps === current.steps &&
    reasoning === current.reasoning &&
    reply === current.reply &&
    modelLabel === current.modelLabel &&
    provider === current.provider
  ) {
    // Nothing new: keep the same object so React does not re-render for a poll
    // that only confirmed what the stream already said.
    return current;
  }
  return { ...current, steps, reasoning, reply, modelLabel, provider };
}

/** How far along a row is; a finished row is never rolled back to running. */
const RANK: Record<TurnStepRecord['state'], number> = { running: 0, done: 1, failed: 1 };

/**
 * Rows are keyed by id on both sides, so this is a merge, not a replacement: the
 * gateway's ordering wins, a row further along wins, and a step the stream has
 * reported but the poll has not caught up with yet is kept rather than dropped.
 */
function mergeSteps(
  current: TurnStepRecord[],
  incoming: TurnStepRecord[],
): TurnStepRecord[] {
  if (!incoming.length) return current;
  const local = new Map(current.map((step) => [step.id, step]));
  const merged: TurnStepRecord[] = [];
  let changed = false;
  for (const step of incoming) {
    const mine = local.get(step.id);
    const row = mine ? furtherAlong(mine, step) : step;
    if (row !== mine) changed = true;
    if (mine) local.delete(step.id);
    merged.push(row);
  }
  for (const step of local.values()) {
    merged.push(step);
    changed = true;
  }
  return changed ? merged : current;
}

/** The row further along wins; equal states prefer the newer detail. */
function furtherAlong(mine: TurnStepRecord, incoming: TurnStepRecord): TurnStepRecord {
  if (RANK[mine.state] > RANK[incoming.state]) return mine;
  if (
    mine.state === incoming.state &&
    mine.detail === incoming.detail &&
    mine.label === incoming.label
  ) {
    return mine;
  }
  return incoming;
}
