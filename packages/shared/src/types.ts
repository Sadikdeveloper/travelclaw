export type Pace = 'relaxed' | 'steady' | 'packed';
export type BudgetStyle = 'lean' | 'comfortable' | 'splurge';
export type TripStatus = 'draft' | 'planning' | 'booked' | 'traveling' | 'done';
export type MemoryKind = 'preference' | 'fact' | 'decision';
export type MessageRole = 'user' | 'assistant' | 'system';
export type ChannelStatus = 'ready' | 'disabled' | 'not_configured';

/**
 * A file the traveler attached to a message. Only the name, kind, size, and — for
 * images — a small inline thumbnail travel with the message; the bytes stay on the
 * device that picked them. Document parsing is a later step (docs/roadmap.md), so
 * the desk is told what was attached, not handed the file itself.
 */
export interface MessageAttachment {
  name: string;
  mime: string;
  size: number;
  kind: 'image' | 'document';
  /** Inline data-URL preview for images, capped small. Absent for documents. */
  thumb?: string | null;
}

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
 * Turns allowed per ten-minute window, by caller tier. A guest gets a taste of a model; a
 * signed-in account gets several times more. Limits are per model, so a bigger model can be
 * rationed tighter than a small one without touching the other's allowance.
 *
 * `null` means the model is not paced at all — the desk's own model, which runs in this
 * process and costs nothing per turn. A limit is a property of a model, not of the desk:
 * it arrives with a model that has a provider bill behind it.
 */
export interface ModelLimits {
  guest: number;
  account: number;
}

/** One model this desk can run, with the pace it runs at. `limits: null` means no pace. */
export interface ModelRecord {
  id: string;
  label: string;
  provider: 'mock' | 'openai';
  /** `null` when this model is not paced. */
  limits: ModelLimits | null;
  /** True for the desk's own renderer: no provider call, no key, no per-turn cost. */
  offline: boolean;
  /** False for a configured model that cannot run yet, e.g. missing provider key. */
  available: boolean;
}

/** What the control UI needs to show a picker and describe the limits. */
export interface ModelCatalogRecord {
  models: ModelRecord[];
  /** The model a turn runs on when it does not name one. */
  current: string;
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
  attachments: MessageAttachment[];
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
