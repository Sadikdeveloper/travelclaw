import type { ChatResponse, MessageAttachment, TurnStreamEvent } from '@travelclaw/shared';
import { clientHeaders, restoreSession } from './api';

/**
 * One live turn, read from the gateway as Server-Sent Events.
 *
 * The POST that starts a turn is the same request that carries its progress
 * back, so there is no second channel to keep in sync and no turn id to invent:
 * the response body *is* the process view. `signal` closes it, which the
 * gateway reads as Stop.
 */
export async function streamTurn(input: {
  sessionId: string;
  content: string;
  attachments: MessageAttachment[];
  signal: AbortSignal;
  onEvent: (event: TurnStreamEvent) => void;
}): Promise<ChatResponse> {
  const response = await post(input, false);
  if (response.status === 401 && (await restoreSession())) {
    // A guest whose cookie went stale gets one replay, exactly like `api()`.
    return read(await post(input, true), input.onEvent);
  }
  return read(response, input.onEvent);
}

function post(
  input: {
    sessionId: string;
    content: string;
    attachments: MessageAttachment[];
    signal: AbortSignal;
  },
  replay: boolean,
): Promise<Response> {
  void replay;
  return fetch(`/api/sessions/${input.sessionId}/messages/stream`, {
    method: 'POST',
    credentials: 'include',
    signal: input.signal,
    headers: clientHeaders({
      Accept: 'text/event-stream',
      'Content-Type': 'application/json',
    }),
    body: JSON.stringify({ content: input.content, attachments: input.attachments }),
  });
}

async function read(
  response: Response,
  onEvent: (event: TurnStreamEvent) => void,
): Promise<ChatResponse> {
  if (!response.ok || !response.body) {
    throw new Error(await failureMessage(response));
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let completed: ChatResponse | null = null;
  let failed = '';
  let lastEvent: TurnStreamEvent | null = null;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const event = parseFrame(frame);
        if (event) {
          lastEvent = event;
          if (event.type === 'turn.completed') completed = event.response;
          if (event.type === 'turn.failed') failed = event.message;
          onEvent(event);
        }
        boundary = buffer.indexOf('\n\n');
      }
    }
    const tail = parseFrame(buffer);
    if (tail) {
      lastEvent = tail;
      if (tail.type === 'turn.completed') completed = tail.response;
      if (tail.type === 'turn.failed') failed = tail.message;
      onEvent(tail);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  if (completed) return completed;
  if (failed) throw new Error(failed);
  // The stream ended without a result: an aborted turn lands here too, and the
  // caller distinguishes a Stop from a failure by its own abort signal.
  void lastEvent;
  throw new Error('The turn ended before the desk finished.');
}

function parseFrame(frame: string): TurnStreamEvent | null {
  const line = frame
    .split('\n')
    .filter((item) => item.startsWith('data:'))
    .at(-1);
  if (!line) return null;
  try {
    return JSON.parse(line.slice(5).trim()) as TurnStreamEvent;
  } catch {
    return null;
  }
}

async function failureMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as {
      error?: { message?: string };
      message?: string;
    };
    return body.error?.message || body.message || `The desk answered ${response.status}.`;
  } catch {
    return `The desk answered ${response.status}.`;
  }
}
