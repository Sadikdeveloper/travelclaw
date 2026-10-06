import type { Response } from 'express';
import type { TurnStreamEvent } from '@travelclaw/shared';
import { LiveTurnsService } from '../src/gateway/live-turns.service';
import { TurnStream } from '../src/gateway/turn-stream';

/**
 * The floor under the live turn: while a turn runs, its steps and its words are
 * readable with one plain GET, so a browser whose streamed response is being
 * held up on the way in still watches the work instead of waiting for it.
 */

/** A response that only needs to accept what the stream writes to it. */
function fakeResponse(): { res: Response; frames: string[] } {
  const frames: string[] = [];
  const res = {
    writeHead: () => res,
    flushHeaders: () => {},
    write: (chunk: string) => {
      frames.push(chunk);
      return true;
    },
    end: () => {},
    socket: { setNoDelay: () => {} },
  } as unknown as Response;
  return { res, frames };
}

function stream(): { stream: TurnStream; frames: string[] } {
  const { res, frames } = fakeResponse();
  const turn = new TurnStream(res);
  turn.open();
  turn.setSession('chat-1');
  return { stream: turn, frames };
}

function started(sessionId = 'chat-1'): TurnStreamEvent {
  return {
    type: 'turn.started',
    at: new Date().toISOString(),
    sessionId,
    provider: 'openai',
    model: 'gpt-4o-mini',
    modelLabel: 'GPT-4o mini',
  };
}

describe('the running turn, read with a plain GET', () => {
  it('starts with the turn announced and nothing said yet', () => {
    const { stream: turn } = stream();
    turn.send(started());

    const snapshot = turn.snapshot();
    expect(snapshot.sessionId).toBe('chat-1');
    expect(snapshot.modelLabel).toBe('GPT-4o mini');
    expect(snapshot.provider).toBe('openai');
    expect(snapshot.steps).toEqual([]);
    expect(snapshot.reply).toBe('');
    expect(Number.isNaN(Date.parse(snapshot.startedAt))).toBe(false);
  });

  it('keeps steps in order, one row per id, updated in place', () => {
    const { stream: turn } = stream();
    turn.send(started());
    turn.step({
      id: 'stage:read',
      kind: 'stage',
      label: 'Read your message',
      detail: '3 memory lines in context.',
      state: 'done',
    });
    turn.step({
      id: 'tool:tool-0',
      kind: 'tool',
      name: 'trip.outline',
      label: 'day-by-day outline',
      state: 'running',
    });
    turn.step({
      id: 'tool:tool-0',
      kind: 'tool',
      name: 'trip.outline',
      label: 'day-by-day outline',
      detail: '5-day outline for Lisbon.',
      state: 'done',
    });

    const snapshot = turn.snapshot();
    expect(snapshot.steps.map((step) => step.id)).toEqual(['stage:read', 'tool:tool-0']);
    expect(snapshot.steps[1]).toMatchObject({ state: 'done', detail: '5-day outline for Lisbon.' });
  });

  it('grows the answer and the thinking as the model writes them', () => {
    const { stream: turn } = stream();
    turn.send(started());
    turn.send({ type: 'reasoning.delta', at: 'x', text: 'The traveler wants an outline. ' });
    turn.send({ type: 'reply.delta', at: 'x', text: 'Here ' });
    turn.send({ type: 'reply.delta', at: 'x', text: 'is the plan.' });

    const snapshot = turn.snapshot();
    expect(snapshot.reasoning).toBe('The traveler wants an outline. ');
    expect(snapshot.reply).toBe('Here is the plan.');
  });

  it('drops a draft the model abandoned when it chose a tool instead', () => {
    const { stream: turn } = stream();
    turn.send(started());
    turn.send({ type: 'reply.delta', at: 'x', text: 'I will look that up' });
    turn.send({ type: 'reply.reset', at: 'x' });

    expect(turn.snapshot().reply).toBe('');
  });

  it('flushes first bytes and keeps the connection warm', () => {
    jest.useFakeTimers();
    try {
      const { stream: turn, frames } = stream();
      // The padding is a comment, not an event: a proxy that waits for a
      // bufferful before forwarding gets one immediately.
      expect(frames[0]).toMatch(/^: +/);
      turn.send(started());
      jest.advanceTimersByTime(25_000);
      expect(frames.some((frame) => frame.startsWith(': keep-alive'))).toBe(true);
      turn.end();
      const written = frames.length;
      jest.advanceTimersByTime(60_000);
      expect(frames.length).toBe(written);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('the registry a poll reads', () => {
  it('serves the running turn and drops it the moment it ends', () => {
    const { stream: turn } = stream();
    turn.send(started());
    turn.send({ type: 'reply.delta', at: 'x', text: 'Lisbon in November is mild.' });

    const live = new LiveTurnsService();
    live.attach('chat-1', turn);
    expect(live.running('chat-1')?.reply).toBe('Lisbon in November is mild.');

    // Answered: nothing is running here any more, so a watcher asking "still
    // going?" is told no rather than shown a finished turn as if it were live.
    turn.complete({
      session: {} as never,
      message: {} as never,
      tools: [],
      provider: 'openai',
      model: 'gpt-4o-mini',
    });
    expect(live.running('chat-1')).toBeNull();

    // And a chat that never ran a turn reads as nothing at all, not an error.
    expect(live.running('chat-that-never-was')).toBeNull();
  });

  it('keeps only the newest turn per chat, so an old one can never be mistaken for this one', () => {
    const first = stream();
    first.stream.send(started());
    const second = stream();
    second.stream.send(started());

    const live = new LiveTurnsService();
    live.attach('chat-1', first.stream);
    live.attach('chat-1', second.stream);

    expect(live.running('chat-1')?.turnId).toBe(second.stream.turnId);
    expect(live.running('chat-1')?.turnId).not.toBe(first.stream.turnId);
  });
});
