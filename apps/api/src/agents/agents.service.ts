import { ConflictException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { DEFAULT_AGENT_ID, type AgentRecord, type CreateAgentInput } from '@travelclaw/shared';
import { nowIso, slug } from '../common/util';
import { loadConfig } from '../config';
import { DatabaseService } from '../db/database.service';
import { WorkspaceService } from '../workspace/workspace.service';

interface AgentRow {
  id: string;
  name: string;
  emoji: string;
  role: string;
  description: string;
  model: string;
  is_default: number;
  created_at: string;
  updated_at: string;
}

@Injectable()
export class AgentsService implements OnModuleInit {
  constructor(
    private readonly db: DatabaseService,
    private readonly workspace: WorkspaceService,
  ) {}

  onModuleInit() {
    if (this.db.get('SELECT id FROM agents WHERE id = ?', DEFAULT_AGENT_ID)) return;
    const now = nowIso();
    const config = loadConfig();
    this.db.run(
      `INSERT INTO agents (id, name, emoji, role, description, model, is_default, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      DEFAULT_AGENT_ID,
      this.workspace.identityField('Name') || 'Marlow',
      this.workspace.identityField('Emoji') || 'compass',
      this.workspace.identityField('Role') || 'Travel desk',
      this.workspace.identityField('Description') || 'Plans from the traveler constraints.',
      this.workspace.identityField('Model') || config.modelName,
      now,
      now,
    );
  }

  list(): AgentRecord[] {
    return this.db.all<AgentRow>('SELECT * FROM agents ORDER BY is_default DESC, name ASC').map(mapAgent);
  }

  get(id: string): AgentRecord {
    const row = this.db.get<AgentRow>('SELECT * FROM agents WHERE id = ?', id);
    if (!row) throw new NotFoundException(`No agent ${id}`);
    return mapAgent(row);
  }

  defaultAgent(): AgentRecord {
    const row = this.db.get<AgentRow>('SELECT * FROM agents WHERE is_default = 1 LIMIT 1');
    if (row) return mapAgent(row);
    return this.get(DEFAULT_AGENT_ID);
  }

  resolve(id?: string): AgentRecord {
    return id ? this.get(id) : this.defaultAgent();
  }

  create(input: CreateAgentInput): AgentRecord {
    const id = input.id || slug(input.name);
    if (this.db.get('SELECT id FROM agents WHERE id = ?', id)) {
      throw new ConflictException(`Agent ${id} already exists`);
    }
    const now = nowIso();
    this.db.run(
      `INSERT INTO agents (id, name, emoji, role, description, model, is_default, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      id,
      input.name,
      input.emoji,
      input.role,
      input.description,
      input.model || loadConfig().modelName,
      now,
      now,
    );
    return this.get(id);
  }
}

function mapAgent(row: AgentRow): AgentRecord {
  return {
    id: row.id,
    name: row.name,
    emoji: row.emoji,
    role: row.role,
    description: row.description,
    model: row.model,
    isDefault: row.is_default === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
