import { Injectable } from '@nestjs/common';
import type { LiveTurnRecord } from '@travelclaw/shared';
import type { TurnStream } from './turn-stream';

/**
 * The turns running right now, one per chat.
 *
 * The stream is how a turn is normally watched: the same POST that starts it
 * carries every step back. This registry exists because that response can be
 * held up by something between the gateway and the browser (a proxy that buffers
 * a response until it ends, an extension, a very slow link), and a traveler who
 * cannot see the response cannot see the work — they get the old "send, wait,
 * then read the result" experience the live turn was built to replace.
 *
 * So the running turn is also kept here, in memory, where one plain `GET` can
 * read it. It is the floor, not the fast path: nothing renders from it unless
 * the stream has gone quiet, and it disappears the moment the turn ends.
 */
@Injectable()
export class LiveTurnsService {
  /** Insertion-ordered, so the oldest chat can be dropped when the map is full. */
  private readonly bySession = new Map<string, TurnStream>();

  /**
   * Chats a desk might be mid-turn on. Only one turn per chat is ever kept —
   * the newest — so this is a small window, not a history.
   */
  private readonly maxChats = 200;

  /** Called once the gateway knows which chat this turn belongs to. */
  attach(sessionId: string, stream: TurnStream): void {
    // Re-inserting moves the chat to the newest position, so a busy desk evicts
    // the chat that has been quiet longest.
    this.bySession.delete(sessionId);
    this.bySession.set(sessionId, stream);
    while (this.bySession.size > this.maxChats) {
      const oldest = this.bySession.keys().next().value;
      if (oldest === undefined) break;
      this.bySession.delete(oldest);
    }
  }

  /**
   * The running turn for one chat, or `null` when nothing is running there. A
   * finished turn is deliberately not reported: a watcher asking "is it still
   * going?" is answered by absence, and a stale snapshot can never be mistaken
   * for the turn a traveler just started.
   */
  running(sessionId: string): LiveTurnRecord | null {
    const stream = this.bySession.get(sessionId);
    if (!stream) return null;
    if (stream.finished) {
      this.bySession.delete(sessionId);
      return null;
    }
    return stream.snapshot();
  }
}
