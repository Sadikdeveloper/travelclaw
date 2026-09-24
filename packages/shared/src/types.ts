export type Pace = 'relaxed' | 'steady' | 'packed';
export type BudgetStyle = 'lean' | 'comfortable' | 'splurge';
export type TripStatus = 'draft' | 'planning' | 'booked' | 'traveling' | 'done';
export type MemoryKind = 'preference' | 'fact' | 'decision';
export type MessageRole = 'user' | 'assistant' | 'system';
export type ChannelStatus = 'ready' | 'disabled' | 'not_configured';

export interface AgentRecord {
  id: string;
  name: string;
  emoji: string;
  role: string;
  description: string;
  model: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SessionRecord {
  id: string;
  key: string;
  agentId: string;
  channel: string;
  peerId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface SkillTrace {
  name: string;
  ok: boolean;
  summary: string;
}

export interface MessageRecord {
  id: string;
  sessionId: string;
  role: MessageRole;
  content: string;
  skills: SkillTrace[];
  provider: string | null;
  model: string | null;
  createdAt: string;
}

export interface ItineraryDayRecord {
  id: string;
  tripId: string;
  dayIndex: number;
  date: string;
  title: string;
  summary: string;
  places: string[];
}

export interface TripRecord {
  id: string;
  agentId: string;
  title: string;
  destination: string;
  origin: string | null;
  startDate: string;
  endDate: string;
  travelers: number;
  budgetCents: number | null;
  currency: string;
  pace: Pace;
  status: TripStatus;
  interests: string[];
  notes: string;
  createdAt: string;
  updatedAt: string;
  days?: ItineraryDayRecord[];
}

export interface MemoryRecord {
  id: string;
  agentId: string;
  kind: MemoryKind;
  title: string;
  body: string;
  noteDate: string | null;
  createdAt: string;
}

export interface HeartbeatRecord {
  id: string;
  agentId: string;
  name: string;
  every: string;
  prompt: string;
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastResult: string | null;
}

export interface ChannelRecord {
  id: string;
  label: string;
  status: ChannelStatus;
  detail: string;
}

/** Extension contract. Adapters translate a platform into gateway turns. */
export interface ChannelPlugin extends ChannelRecord {
  configured: boolean;
}

export interface SkillRecord {
  name: string;
  description: string;
  triggers: string[];
  implemented: boolean;
}

export interface SkillRunRecord {
  id: string;
  sessionId: string | null;
  tripId: string | null;
  skill: string;
  ok: boolean;
  summary: string;
  createdAt: string;
}

export interface ChatResponse {
  session: SessionRecord;
  message: MessageRecord;
  skills: SkillTrace[];
  provider: string;
  model: string;
}

export interface HealthReport {
  ok: boolean;
  service: 'travelclaw-gateway';
  version: string;
  uptimeSec: number;
  database: 'ok';
  workspace: 'ok' | 'missing';
  model: { provider: string; model: string };
}

export interface WorkspaceFiles {
  soul: string;
  identity: string;
  user: string;
  agents: string;
  memory: string;
}

export interface DeskSnapshot {
  health: HealthReport;
  agent: AgentRecord;
  trips: TripRecord[];
  sessions: SessionRecord[];
  heartbeats: HeartbeatRecord[];
  skills: SkillRecord[];
  channels: ChannelRecord[];
  memoryCount: number;
}
