import type { TurnEvent, TurnEventSink } from '@travelclaw/agent-core';
import type {
  ChatResponse,
  LiveTurnRecord,
  TurnStepRecord,
  TurnStreamEvent,
} from '@travelclaw/shared';
import { randomUUID } from 'node:crypto';
import type { Response } from 'express';

/** How much of the answer and the thinking the live view keeps, as the screen does. */
const REASONING_TAIL = 4000;
const REPLY_TAIL = 20000;
/**
 * A comment frame is not an event, so the client ignores it — but it is bytes on
 * the wire, which is how a proxy that would otherwise hold a response until it
 * has a bufferful is kept honest, and how a long model call keeps its connection
 * warm in the meantime.
 */
const KEEP_ALIVE_MS = 10_000;

/**
 * One live turn, written to the browser as Server-Sent Events.
 *
 * SSE over the same POST that starts the turn, rather than a socket room: the
 * words and the work belong to the request the traveler just made, a proxy in
 * front of the gateway needs nothing new (Vite already forwards `/api`), and the
 * response ends by itself when the turn does. The browser's `AbortController`
 * closes it, which the gateway honors as "stop".
 */
export class TurnStream {
  /** Identifies this turn in `LiveTurnsService`, so a poll cannot pick up another one. */
  readonly turnId = randomUUID();
  private readonly startedAt = Date.now();
  private readonly controller = new AbortController();
  private closed = false;
  private stopped = false;
  private sessionId: string | null = null;
  private modelLabel = 'the desk';
  private provider = '';
  private reasoning = '';
  private reply = '';
  private keepAlive: ReturnType<typeof setInterval> | null = null;
  private readonly steps = new Map<string, TurnStepRecord>();

  constructor(private readonly res: Response) {}

  open(): void {
    this.res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Nginx and friends buffer proxied responses by default, which would hold
      // the whole point of this endpoint until the turn ended.
      'X-Accel-Buffering': 'no',
    });
    this.res.flushHeaders?.();
    // The first bytes on purpose: a proxy that waits for a bufferful before it
    // forwards anything gets its padding immediately, and the frames that follow
    // are small but no longer first. A tiny write is also sent without waiting on
    // Nagle, so what the desk reports is what the traveler sees.
    this.res.socket?.setNoDelay?.(true);
    this.res.write(`: ${' '.repeat(2048)}\n\n`);
    this.keepAlive = setInterval(() => {
      if (this.closed) return;
      try {
        this.res.write(`: keep-alive ${Date.now()}\n\n`);
      } catch {
        this.closed = true;
      }
    }, KEEP_ALIVE_MS);
    this.keepAlive.unref?.();
  }

  /** The chat this turn belongs to, once the gateway has opened or found it. */
  setSession(sessionId: string): void {
    this.sessionId = sessionId;
  }

  matchesSession(sessionId: string): boolean {
    return this.sessionId === sessionId;
  }

  /**
   * True only when *we* were stopped: the traveler pressed Stop, or the browser
   * went away mid-turn. It is deliberately not derived from `req.destroyed` —
   * Node destroys a request stream as soon as its body has been read, which
   * would make every turn look abandoned the moment it started.
   */
  get aborted(): boolean {
    return this.stopped;
  }

  /** Handed to the turn so a Stop ends the model call, not just the connection. */
  get signal(): AbortSignal {
    return this.controller.signal;
  }

  /** True once the turn is over — answered, failed, stopped, or the client left. */
  get finished(): boolean {
    return this.closed;
  }

  /** Stop: cancel the work, then close the stream it was writing to. */
  stop(): void {
    this.stopped = true;
    this.controller.abort();
    this.end();
  }

  send(event: TurnStreamEvent): void {
    // Recorded even when the connection is gone: a stopped turn still has a
    // truthful last state, and the snapshot is what a poll reads.
    this.record(event);
    if (this.closed) return;
    try {
      this.res.write(`data: ${JSON.stringify(event)}\n\n`);
    } catch {
      this.closed = true;
    }
  }

  /**
   * Everything this turn has reported so far, for a client reading with a plain
   * `GET` instead of the stream. Steps keep their ids and order, so a watcher
   * can replace its rows wholesale rather than reconciling them.
   */
  snapshot(): LiveTurnRecord {
    return {
      turnId: this.turnId,
      sessionId: this.sessionId ?? '',
      modelLabel: this.modelLabel,
      provider: this.provider,
      startedAt: new Date(this.startedAt).toISOString(),
      steps: [...this.steps.values()],
      reasoning: this.reasoning,
      reply: this.reply,
    };
  }

  /** Folds one outgoing event into the snapshot, through the same funnel. */
  private record(event: TurnStreamEvent): void {
    switch (event.type) {
      case 'turn.started':
        this.sessionId ??= event.sessionId;
        this.modelLabel = event.modelLabel || event.model || this.modelLabel;
        this.provider = event.provider;
        return;
      case 'reasoning.delta':
        this.reasoning = (this.reasoning + event.text).slice(-REASONING_TAIL);
        return;
      case 'reply.delta':
        this.reply = (this.reply + event.text).slice(-REPLY_TAIL);
        return;
      case 'reply.reset':
        this.reply = '';
        return;
      case 'turn.completed':
        this.provider = event.response.provider;
        this.modelLabel = event.response.model || this.modelLabel;
        return;
      default:
        return;
    }
  }

  /** Announce a step, replacing an earlier row with the same id. */
  step(step: Omit<TurnStepRecord, 'at'>): void {
    if (this.closed) return;
    const previous = this.steps.get(step.id);
    if (previous && previous.state === step.state && previous.detail === step.detail)
      return;
    const record: TurnStepRecord = { ...step, at: new Date().toISOString() };
    this.steps.set(record.id, record);
    this.send({ type: 'step', at: record.at, step: record });
  }

  /** The sink `completeTurn` writes into: one mapping, no formatting downstream. */
  sink(): TurnEventSink {
    return (event: TurnEvent) => this.consume(event);
  }

  consume(event: TurnEvent): void {
    switch (event.type) {
      case 'stage':
        this.step({
          id: `stage:${event.id}`,
          kind: 'stage',
          label: event.label,
          ...(event.detail ? { detail: event.detail } : {}),
          state: event.state,
        });
        return;
      case 'tool_start':
        this.step({
          id: `tool:${event.id}`,
          kind: 'tool',
          name: event.name,
          label: event.label,
          detail: describeToolArgs(event.args),
          source: event.source,
          state: 'running',
        });
        return;
      case 'tool_end':
        this.step({
          id: `tool:${event.id}`,
          kind: 'tool',
          name: event.name,
          label: this.steps.get(`tool:${event.id}`)?.label ?? event.name,
          detail: event.summary,
          source: this.steps.get(`tool:${event.id}`)?.source,
          state: event.ok ? 'done' : 'failed',
        });
        return;
      case 'reasoning':
        this.send({
          type: 'reasoning.delta',
          at: new Date().toISOString(),
          text: event.text,
        });
        return;
      case 'reply_delta':
        this.send({ type: 'reply.delta', at: new Date().toISOString(), text: event.text });
        return;
      case 'reply_reset':
        this.send({ type: 'reply.reset', at: new Date().toISOString() });
        return;
      case 'reply_start':
        return;
    }
  }

  complete(response: ChatResponse): void {
    this.send({
      type: 'turn.completed',
      at: new Date().toISOString(),
      response,
    });
    this.end();
  }

  fail(message: string): void {
    this.send({ type: 'turn.failed', at: new Date().toISOString(), message });
    this.end();
  }

  end(): void {
    if (this.keepAlive) {
      clearInterval(this.keepAlive);
      this.keepAlive = null;
    }
    if (this.closed) return;
    this.closed = true;
    try {
      this.res.end();
    } catch {
      // The client is gone; there is nothing left to end.
    }
  }

  /** How long the turn has been running, for the operator log line. */
  elapsedMs(): number {
    return Date.now() - this.startedAt;
  }
}

/**
 * What a tool was asked for, in one line. The arguments are the model's own
 * words about the traveler's request, never a credential — no tool on this desk
 * takes one, and a rejected argument payload never reaches here.
 */
function describeToolArgs(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return raw.slice(0, 200);
    const entries = Object.entries(parsed as Record<string, unknown>)
      .filter(([, value]) => value !== null && value !== undefined && value !== '')
      .slice(0, 4)
      .map(([key, value]) => {
        const text = typeof value === 'string' ? value : JSON.stringify(value);
        return `${key}: ${text.length > 120 ? `${text.slice(0, 120)}…` : text}`;
      });
    return entries.join(' · ') || undefined;
  } catch {
    return raw.slice(0, 200);
  }
}
