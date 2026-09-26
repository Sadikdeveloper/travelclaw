import { Injectable, NotFoundException } from '@nestjs/common';
import {
  sessionKey,
  WEBCHAT_CHANNEL,
  type CreateSessionInput,
  type MessageRecord,
  type MessageRole,
  type SessionRecord,
  type ToolTrace,
} from '@travelclaw/shared';
import { newId, nowIso, parseJson, titleFrom } from '../common/util';
import { DatabaseService } from '../db/database.service';
import { AgentsService } from '../agents/agents.service';

interface SessionRow {
  id: string;
  key: string;
  user_id: string;
  agent_id: string;
  channel: string;
  peer_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

interface MessageRow {
  id: string;
  session_id: string;
  role: MessageRole;
  content: string;
  tools_json: string;
  provider: string | null;
  model: string | null;
  created_at: string;
}

@Injectable()
export class SessionsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly agents: AgentsService,
  ) {}

  /** Only this account's chats — never another traveler's. */
  list(userId: string): SessionRecord[] {
    return this.db
      .all<SessionRow>(
        'SELECT * FROM sessions WHERE user_id = ? ORDER BY updated_at DESC LIMIT 50',
        userId,
      )
      .map(mapSession);
  }

  /**
   * 404, not 403, for a session that exists but is not this account's — that keeps a
   * guessed id from confirming another traveler's chat exists at all.
   */
  get(id: string, userId: string): SessionRecord {
    const row = this.db.get<SessionRow>(
      'SELECT * FROM sessions WHERE id = ? AND user_id = ?',
      id,
      userId,
    );
    if (!row) throw new NotFoundException(`No session ${id}`);
    return mapSession(row);
  }

  open(input: CreateSessionInput, userId: string): SessionRecord {
    const agent = this.agents.resolve(input.agentId);
    const channel = input.channel || WEBCHAT_CHANNEL;
    const peerId = input.peerId || `operator-${newId().slice(0, 8)}`;
    const key = sessionKey({ agentId: agent.id, channel, peerId });
    const existing = this.db.get<SessionRow>(
      'SELECT * FROM sessions WHERE key = ? AND user_id = ?',
      key,
      userId,
    );
    if (existing) return mapSession(existing);
    const now = nowIso();
    const id = newId();
    this.db.run(
      `INSERT INTO sessions (id, key, user_id, agent_id, channel, peer_id, title, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      key,
      userId,
      agent.id,
      channel,
      peerId,
      input.title || 'New chat',
      now,
      now,
    );
    return this.get(id, userId);
  }

  messages(sessionId: string, userId: string): MessageRecord[] {
    this.get(sessionId, userId);
    return this.messagesRaw(sessionId);
  }

  /**
   * Internal read used by the turn loop after the caller has already resolved the
   * session (and its ownership) once. Avoids a redundant ownership check per message.
   */
  recentHistory(
    sessionId: string,
    limit = 12,
  ): Array<{ role: 'user' | 'assistant'; content: string }> {
    return this.messagesRaw(sessionId)
      .filter((message) => message.role === 'user' || message.role === 'assistant')
      .slice(-limit)
      .map((message) => ({
        role: message.role as 'user' | 'assistant',
        content: message.content,
      }));
  }

  append(
    sessionId: string,
    role: MessageRole,
    content: string,
    tools: ToolTrace[] = [],
    meta?: { provider?: string; model?: string },
  ): MessageRecord {
    const session = this.requireRow(sessionId);
    const now = nowIso();
    const id = newId();
    this.db.run(
      `INSERT INTO messages (id, session_id, role, content, tools_json, provider, model, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      sessionId,
      role,
      content,
      JSON.stringify(tools),
      meta?.provider || null,
      meta?.model || null,
      now,
    );
    const title =
      session.title === 'New chat' && role === 'user' ? titleFrom(content) : session.title;
    this.db.run(
      'UPDATE sessions SET updated_at = ?, title = ? WHERE id = ?',
      now,
      title,
      sessionId,
    );
    return mapMessage(this.db.get<MessageRow>('SELECT * FROM messages WHERE id = ?', id)!);
  }

  reset(sessionId: string): SessionRecord {
    this.requireRow(sessionId);
    this.db.run('DELETE FROM messages WHERE session_id = ?', sessionId);
    this.append(
      sessionId,
      'system',
      'Session reset. Earlier turns are gone from this chat.',
    );
    this.db.run('UPDATE sessions SET title = ? WHERE id = ?', 'New chat', sessionId);
    return mapSession(this.requireRow(sessionId));
  }

  /**
   * Who owns a chat, with no ownership check of its own. Used only to route a
   * `chat.completed` / `task.updated` socket event to the right account's room —
   * never to answer an HTTP request, which must go through `get()`.
   */
  ownerOf(sessionId: string): string | null {
    return (
      this.db.get<{ user_id: string }>(
        'SELECT user_id FROM sessions WHERE id = ?',
        sessionId,
      )?.user_id ?? null
    );
  }

  /** Row lookup with no ownership filter, for internal call sites only. */
  private requireRow(id: string): SessionRow {
    const row = this.db.get<SessionRow>('SELECT * FROM sessions WHERE id = ?', id);
    if (!row) throw new NotFoundException(`No session ${id}`);
    return row;
  }

  private messagesRaw(sessionId: string): MessageRecord[] {
    return this.db
      .all<MessageRow>(
        'SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC LIMIT 200',
        sessionId,
      )
      .map(mapMessage);
  }
}

function mapSession(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    key: row.key,
    userId: row.user_id,
    agentId: row.agent_id,
    channel: row.channel,
    peerId: row.peer_id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMessage(row: MessageRow): MessageRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role,
    content: row.content,
    tools: parseJson<ToolTrace[]>(row.tools_json, []),
    provider: row.provider,
    model: row.model,
    createdAt: row.created_at,
  };
}
