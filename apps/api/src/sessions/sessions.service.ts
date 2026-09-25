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

  list(): SessionRecord[] {
    return this.db
      .all<SessionRow>('SELECT * FROM sessions ORDER BY updated_at DESC LIMIT 50')
      .map(mapSession);
  }

  get(id: string): SessionRecord {
    const row = this.db.get<SessionRow>('SELECT * FROM sessions WHERE id = ?', id);
    if (!row) throw new NotFoundException(`No session ${id}`);
    return mapSession(row);
  }

  open(input: CreateSessionInput): SessionRecord {
    const agent = this.agents.resolve(input.agentId);
    const channel = input.channel || WEBCHAT_CHANNEL;
    const peerId = input.peerId || `operator-${newId().slice(0, 8)}`;
    const key = sessionKey({ agentId: agent.id, channel, peerId });
    const existing = this.db.get<SessionRow>('SELECT * FROM sessions WHERE key = ?', key);
    if (existing) return mapSession(existing);
    const now = nowIso();
    const id = newId();
    this.db.run(
      `INSERT INTO sessions (id, key, agent_id, channel, peer_id, title, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      key,
      agent.id,
      channel,
      peerId,
      input.title || 'New chat',
      now,
      now,
    );
    return this.get(id);
  }

  messages(sessionId: string): MessageRecord[] {
    this.get(sessionId);
    return this.db
      .all<MessageRow>(
        'SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC LIMIT 200',
        sessionId,
      )
      .map(mapMessage);
  }

  recentHistory(
    sessionId: string,
    limit = 12,
  ): Array<{ role: 'user' | 'assistant'; content: string }> {
    return this.messages(sessionId)
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
    const session = this.get(sessionId);
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
    this.get(sessionId);
    this.db.run('DELETE FROM messages WHERE session_id = ?', sessionId);
    this.append(
      sessionId,
      'system',
      'Session reset. Earlier turns are gone from this chat.',
    );
    this.db.run('UPDATE sessions SET title = ? WHERE id = ?', 'New chat', sessionId);
    return this.get(sessionId);
  }
}

function mapSession(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    key: row.key,
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
