import type { BrowserRunRecord } from './browser';
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

export type ModelProviderType =
  'mock' | 'openai' | 'google' | 'xai' | 'deepseek' | 'kimi' | 'codecraft';

/** One model this desk can run, with the pace it runs at. `limits: null` means no pace. */
export interface ModelRecord {
  id: string;
  label: string;
  provider: ModelProviderType;
  /** 'fast' for quick conversational turns; 'strong' for reasoning/tool use. */
  tier?: 'fast' | 'strong';
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

/**
 * One line of the process view: a stage the desk went through, a tool it ran, a
 * desk it woke, or a browser step. Steps are keyed by `id`, so the same step can
 * be announced `running` and later updated to `done` — the UI replaces it rather
 * than appending a second row.
 */
export interface TurnStepRecord {
  id: string;
  kind: 'stage' | 'tool' | 'desk' | 'browser';
  label: string;
  detail?: string;
  state: 'running' | 'done' | 'failed';
  /** Tool name, desk kind, or the action a browser took. */
  name?: string;
  source?: 'model' | 'router';
  at: string;
}

/**
 * What the gateway writes on a streaming turn (`text/event-stream`). The reply
 * arrives twice on purpose: `reply.delta` for the words as the model writes
 * them, and `turn.completed` with the persisted record — the client swaps the
 * draft for the saved message rather than trusting a stream it cannot replay.
 */
export type TurnStreamEvent =
  | {
      type: 'turn.started';
      at: string;
      sessionId: string;
      provider: string;
      model: string;
      modelLabel: string;
    }
  | { type: 'step'; at: string; step: TurnStepRecord }
  | { type: 'reasoning.delta'; at: string; text: string }
  | { type: 'reply.delta'; at: string; text: string }
  /** The model wrote a draft and then chose a tool: drop it and keep watching. */
  | { type: 'reply.reset'; at: string }
  | { type: 'turn.completed'; at: string; response: ChatResponse }
  | { type: 'turn.failed'; at: string; message: string };

/**
 * A turn that is running right now, as the gateway keeps it.
 *
 * The event stream is the fast path: it carries every step and every word as
 * it happens. This record is the floor under it — the same state, readable with
 * one plain `GET` — so a response that a proxy, an extension, or a slow network
 * holds on to cannot turn a live turn back into "send, wait, and read the
 * result". It is served only while the turn runs; a finished turn reads as
 * `null`, which is what tells a watcher it can stop asking.
 */
export interface LiveTurnRecord {
  turnId: string;
  sessionId: string;
  /** The model the desk picked for this turn, as it should be shown. */
  modelLabel: string;
  provider: string;
  startedAt: string;
  /** Every step so far, in order, with rows updated in place by id. */
  steps: TurnStepRecord[];
  /** Provider reasoning and brief action summaries, bounded to the live screen's tail. */
  reasoning: string;
  /** The answer so far — empty until the model starts writing it. */
  reply: string;
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

/**
 * A note plus how well it answered one search: BM25 over title and body times a
 * bounded recency factor. Higher is better, and scores are comparable within a
 * single search only — they are not a stable absolute across queries.
 */
export interface MemorySearchResult extends MemoryRecord {
  score: number;
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
/**
 * `completed` means the desk actually finished its search. `awaiting` is reserved
 * for a genuine handoff (for example an authorized browser source needing input),
 * not the old generic "is this done?" prompt.
 */
export type AgentTaskStatus =
  'working' | 'awaiting' | 'completed' | 'accepted' | 'rejected';
export type TaskDecision = 'complete' | 'no' | 'still_working';

/**
 * A reservation hold exists only when the provider said one does and named a
 * reference. It may be an unpaid booking; only the provider sets its payment
 * terms. Until confirmation, the row remains an offer.
 */
export type OfferHoldState = 'none' | 'confirmed';

/**
 * Whether the source behind an offer can confirm a hold. `unsupported` is a
 * vendor that only quotes prices: the desk refuses the ask instead of sending an
 * offer id somewhere that cannot reserve anything.
 */
export type OfferHoldSupport = 'provider' | 'unsupported';

/**
 * The structured parts of an offer, as the vendor described them. Kept so the
 * chat can lay a fare out like a fare — times, stops, duration, price — instead
 * of re-reading a prose sentence. Every value is the vendor's own or arithmetic
 * on it (a connection count, a night count); nothing is inferred from a place
 * name, and a field the vendor did not give stays null.
 */
export interface OfferFlightFacts {
  kind: 'flight';
  /** Legs in order, exactly as the vendor returned them. */
  segments: Array<{
    from: string;
    to: string;
    departAt: string | null;
    arriveAt: string | null;
    carrier: string | null;
  }>;
  /** Stops the vendor counted, or a single-leg itinerary's plain zero. */
  stops: number | null;
  /** Minutes the vendor reported for the whole itinerary. */
  durationMinutes: number | null;
  /**
   * Where the traveler changes planes, only when the vendor named those places
   * (a layover name) or the leg structure shows them (an intermediate airport).
   */
  stopNames: string[];
}

export interface OfferStayFacts {
  kind: 'stay';
  name: string;
  roomType: string | null;
  nights: number | null;
  checkIn: string | null;
  checkOut: string | null;
  /** The vendor's own score, on the vendor's own scale. */
  rating: number | null;
}

export type OfferFacts = OfferFlightFacts | OfferStayFacts;

/**
 * One offer a provider returned to a desk, stored as it arrived. Every number
 * here came from the provider: nothing is estimated, converted, or filled in.
 */
export interface OfferRecord {
  id: string;
  sessionId: string;
  taskId: string;
  kind: DeskKind;
  /** The provider's own name when it gave one, else the connector host. */
  provider: string;
  /** The provider's id for this offer, echoed back when asking it for a hold. */
  providerOfferId: string;
  /** When the desk read this answer, so a stale price looks stale. */
  retrievedAt: string;
  currency: string;
  totalAmount: number;
  title: string;
  detail: string | null;
  /**
   * Structured vendor facts when the source sent any. The card renders these
   * when present and falls back to `title`/`detail` prose when it did not.
   */
  facts: OfferFacts | null;
  /** Vendor-provided checkout URL, when safe to open; not a guarantee of availability. */
  bookingUrl: string | null;
  hold: OfferHoldState;
  /** `unsupported` sources never grow a hold button or a hold request. */
  holdSupport: OfferHoldSupport;
  holdRef: string | null;
  /** Provider-supplied reservation/hold expiry; not assumed to be a payment deadline. */
  holdExpiresAt: string | null;
  /** Set when the provider sent hold-shaped details it never confirmed. */
  holdNote: string | null;
  createdAt: string;
  updatedAt: string;
}

/** What answering "hold that one" produced. `confirmed` is the provider's word, not ours. */
export interface HoldAttempt {
  offer: OfferRecord;
  /** Updated task summary as well as the offer, so the UI cannot show stale hold copy. */
  task: AgentTaskRecord;
  confirmed: boolean;
  note: string;
}

export interface AgentTaskRecord {
  id: string;
  sessionId: string;
  messageId: string | null;
  kind: DeskKind;
  agentName: string;
  status: AgentTaskStatus;
  summary: string;
  pass: number;
  /** Offers this desk found, when the operator set a provider key. Empty otherwise. */
  offers?: OfferRecord[];
  browser?: BrowserRunRecord;
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

/** Which physical file backed one persona slot for the agent that was asked for. */
export interface WorkspaceFileSource {
  /** `shared` = `workspace/<file>`, `agent` = `workspace/agents/<id>/<file>`. */
  source: 'shared' | 'agent';
  /** Path relative to the workspace root, e.g. `agents/marlow/SOUL.md`. */
  path: string;
}

/**
 * The persona files plus per-file provenance, so an override is never invisible:
 * a reader can see whether a slot fell back to the shared desk file or came from
 * the agent's own folder.
 */
export interface WorkspaceView extends WorkspaceFiles {
  sources: Record<keyof WorkspaceFiles, WorkspaceFileSource>;
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
