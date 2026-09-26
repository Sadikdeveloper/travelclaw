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

export interface UserRecord {
  id: string;
  email: string;
  displayName: string;
  hasPassword: boolean;
  hasGoogle: boolean;
  /** True for an auto-provisioned, no-signup visitor. Their chats live only on this device. */
  isGuest: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AuthConfig {
  googleClientId: string | null;
}

/**
 * What sign-in and guest routes return. `sessionToken` is the same opaque token the
 * session cookie carries, for clients that cannot keep cookies — an embedded preview,
 * or a browser blocking third-party cookies. See `docs/security.md`.
 */
export interface AuthSessionResponse extends UserRecord {
  sessionToken: string;
}

export interface SessionRecord {
  id: string;
  key: string;
  userId: string;
  agentId: string;
  channel: string;
  peerId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface ToolTrace {
  name: string;
  ok: boolean;
  summary: string;
  /** Who called the tool: the model, or the deterministic router. */
  source?: 'model' | 'router';
}

export interface MessageRecord {
  id: string;
  sessionId: string;
  role: MessageRole;
  content: string;
  tools: ToolTrace[];
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

export interface ToolRecord {
  name: string;
  description: string;
  triggers: string[];
}

export interface ToolRunRecord {
  id: string;
  sessionId: string | null;
  tripId: string | null;
  tool: string;
  ok: boolean;
  summary: string;
  createdAt: string;
}

export type DeskKind = 'flight' | 'stay';
export type AgentTaskStatus = 'working' | 'awaiting' | 'accepted' | 'rejected';
export type TaskDecision = 'complete' | 'no' | 'still_working';

export interface AgentTaskRecord {
  id: string;
  sessionId: string;
  messageId: string | null;
  kind: DeskKind;
  agentName: string;
  status: AgentTaskStatus;
  summary: string;
  pass: number;
  createdAt: string;
  updatedAt: string;
}

export interface ChatResponse {
  session: SessionRecord;
  message: MessageRecord;
  tools: ToolTrace[];
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
  tools: ToolRecord[];
  channels: ChannelRecord[];
  memoryCount: number;
}
