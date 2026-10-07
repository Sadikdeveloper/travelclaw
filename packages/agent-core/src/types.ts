import type { BudgetStyle, MemoryKind, Pace } from '@travelclaw/shared';
import type { DeskKind } from './desks';
import type { ProviderFailureReason } from './providers';

export interface ThemeCard {
  title: string;
  summary: string;
  places: string[];
}

export interface DestinationProfile {
  id: string;
  name: string;
  country: string;
  aliases: string[];
  climate: 'temperate' | 'hot-dry' | 'hot-humid' | 'cold' | 'alpine' | 'variable';
  bestMonths: string;
  coordinates: { lat: number; lon: number };
  dailyUsd: Record<BudgetStyle, number>;
  neighborhoods: { name: string; note: string }[];
  food: string[];
  transit: string;
  packingNotes: string[];
  themes: ThemeCard[];
}

/** Who asked for a tool: the model, or the deterministic router standing in for it. */
export type ToolSource = 'model' | 'router';

/**
 * Point-of-sale/display context for a provider search. Read from the message that
 * states it (see `searchMarketFrom`), or from the operator's configured default —
 * never inferred from a route, a destination, or a passport.
 */
export interface SearchMarket {
  /** ISO 3166-1 alpha-2 booker/point-of-sale country. */
  bookerCountry?: string;
  /** ISO 4217 display/request currency. */
  currency?: string;
  /** BCP-47-style content language, such as `en-NG`. */
  language?: string;
}

export interface ToolTrace {
  name: string;
  ok: boolean;
  summary: string;
  source?: ToolSource;
}

export interface ToolResult<T = unknown> {
  name: string;
  ok: boolean;
  summary: string;
  data: T;
  /** Developer-facing reason, when a call was rejected. Never shown to the traveler. */
  warning?: string;
  source?: ToolSource;
}

export interface OutlineDay {
  date: string;
  title: string;
  summary: string;
  places: string[];
}

export interface OutlineData {
  destination: string;
  known: boolean;
  pace: Pace;
  days: OutlineDay[];
  assumptions: string[];
}

export interface BudgetData {
  destination: string;
  days: number;
  travelers: number;
  style: BudgetStyle;
  currency: 'USD';
  daily: number;
  total: number;
  breakdown: {
    stay: number;
    food: number;
    localTransit: number;
    activities: number;
    buffer: number;
  };
  excluded: string[];
}

export interface PackingItem {
  name: string;
  qty: string;
  category: string;
  why: string;
}

export interface PackingData {
  destination: string;
  climate: string;
  days: number;
  items: PackingItem[];
}

export interface PlaceSuggestion {
  name: string;
  area: string;
  kind: string;
  note: string;
}

export interface PlacesData {
  destination: string;
  known: boolean;
  places: PlaceSuggestion[];
}

export interface CurrencyData {
  amount: number;
  from: string;
  to: string;
  rate: number;
  converted: number;
  source: 'frankfurter' | 'desk-table';
  approximate: boolean;
}

export interface WeatherData {
  destination: string;
  source: 'open-meteo' | 'seasonal-card';
  summary: string;
  days: Array<{ date: string; label: string; highC: number | null; lowC: number | null }>;
}

export interface VisaData {
  destination: string;
  passportCountry: string | null;
  disclaimer: string;
  checks: string[];
}

export interface RememberData {
  kind: MemoryKind;
  title: string;
  body: string;
}

/**
 * What a fare tool (`flights.search`, `stays.search`) returns. Every number came
 * from a vendor: the desk adds no estimate, no conversion, and no offer the
 * source did not price. `sources` carries the failures as well as the successes,
 * so partial coverage is visible to the model instead of hidden behind a list
 * that merely looks short.
 */
export interface OfferSearchSource {
  provider: string;
  adapter: string;
  ok: boolean;
  offers: number;
  reason?: ProviderFailureReason;
}

export interface OfferSearchOffer {
  provider: string;
  adapter: string;
  currency: string;
  amount: number;
  title: string;
  detail: string | null;
  /** The vendor's own facts as one line, or null when it sent none. */
  factsLine: string | null;
  /** "LOS → LIS" from the itinerary's endpoints, or null when unreadable. */
  route: string | null;
  carriers: string[];
  /** When the desk read this answer, so a stale price reads as stale. */
  retrievedAt: string;
  hold: 'none' | 'confirmed';
  holdRef: string | null;
  holdSupport: 'provider' | 'unsupported';
}

export interface OfferSearchData {
  kind: DeskKind;
  /** The query as the desk asked it, for the traveler to read back. */
  query: string;
  retrievedAt: string;
  sources: OfferSearchSource[];
  offers: OfferSearchOffer[];
  /** Results the source sent that the desk refused to show (no price, no id). */
  dropped: number;
  /** Valid offers omitted by a result limit. */
  limited: number;
}

export interface TripHints {
  destination?: string;
  origin?: string;
  /**
   * A free-text web query (`web.search`). Model arguments merge into `TripHints`
   * like every other tool, so a web tool's arguments live here rather than in a
   * parallel shape the planner would have to special-case.
   */
  query?: string;
  /** A public page to read (`web.fetch`), only ever an http(s) URL. */
  url?: string;
  /**
   * The names a fare tool's arguments use. They are aliases, not new fields the
   * desk reads on their own: `flights.search` and `stays.search` fold them into
   * `startDate`/`endDate` before a query is built, so a model can say
   * `departDate` and a router call keeps saying `startDate`.
   */
  departDate?: string;
  /** A return leg, only when the traveler actually gave one. */
  returnDate?: string;
  checkIn?: string;
  /** A stay's check-out, as a fare tool states it. */
  checkOut?: string;
  startDate?: string;
  endDate?: string;
  days?: number;
  travelers?: number;
  pace?: Pace;
  style?: BudgetStyle;
  interests: string[];
  amount?: number;
  fromCurrency?: string;
  toCurrency?: string;
  passportCountry?: string;
  rememberText?: string;
}

export interface PersonaBundle {
  name: string;
  soul: string;
  identity: string;
  user: string;
  agents: string;
}

export interface HistoryTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface ActiveTripHint {
  title: string;
  destination: string;
  startDate: string;
  endDate: string;
  status: string;
}

export interface TurnRequest {
  text: string;
  /**
   * Extra lines appended to the model's copy of the message only — the deterministic
   * router never sees them. The gateway uses it to tell the model which files a
   * traveler attached without letting a file name like "weather.pdf" steer routing.
   */
  modelNote?: string;
  persona: PersonaBundle;
  memory: string[];
  history: HistoryTurn[];
  activeTrip?: ActiveTripHint | null;
}

export interface TurnResult {
  reply: string;
  tools: ToolTrace[];
  toolResults: ToolResult[];
  provider: string;
  model: string;
  remembered?: RememberData;
  command?: 'tools' | 'remember' | 'new';
}

/**
 * A tool as the provider sees it. `parameters` is JSON Schema, derived from the
 * tool's zod argument schema so the two cannot drift.
 */
export interface ModelToolSpec {
  name: string;
  description: string;
  parameters: JsonSchemaObject;
}

/** A call the model asked for. `arguments` is the raw JSON string it sent. */
export interface ModelToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface ModelCompletion {
  text: string;
  provider: string;
  model: string;
  /** Present only when the provider was given tools and the model asked for some. */
  toolCalls?: ModelToolCall[];
}

/**
 * One piece of a streaming completion, as the provider sent it. `text` is the
 * answer being written; `reasoning` is the model's own thinking when the
 * provider exposes it (DeepSeek/GLM `reasoning_content`, OpenRouter
 * `reasoning`). A provider with no reasoning channel simply never sends the
 * second field, and the desk shows only what it actually received.
 */
export interface ModelDelta {
  text?: string;
  reasoning?: string;
}

/**
 * What the desk shows while a turn runs. The gateway turns these into wire
 * events; `completeTurn` itself only says what happened, in the order it
 * happened, and never formats anything for a screen.
 */
export type TurnEvent =
  | { type: 'stage'; id: string; label: string; detail?: string; state: 'running' | 'done' }
  | {
      type: 'tool_start';
      id: string;
      name: string;
      label: string;
      source: ToolSource;
      args?: string;
    }
  | { type: 'tool_end'; id: string; name: string; ok: boolean; summary: string }
  | { type: 'reasoning'; text: string }
  | { type: 'reply_delta'; text: string }
  /** The model wrote something and then chose a tool instead: clear the draft. */
  | { type: 'reply_reset' }
  | { type: 'reply_start'; provider: string; model: string };

export type TurnEventSink = (event: TurnEvent) => void;

export interface ModelProvider {
  id: string;
  model: string;
  /**
   * True when `complete` accepts `tools` and may return `toolCalls`. The mock
   * provider leaves this off; the turn then keeps the router-only path so a
   * missing key still answers offline.
   */
  usesTools?: boolean;
  /**
   * True when `complete` writes `onDelta` as the answer arrives. The offline desk
   * renderer sets it too: it has the whole sentence up front and paces it out, so
   * a turn with no live model still reads as one being written instead of going
   * quiet and then appearing finished.
   */
  streams?: boolean;
  complete(input: {
    system: string;
    history: HistoryTurn[];
    user: string;
    fallback: string;
    tools?: ModelToolSpec[];
    signal?: AbortSignal;
    /** Called as the provider streams. Ignored by a provider that cannot stream. */
    onDelta?: (delta: ModelDelta) => void;
    /**
     * Called while the call is waiting to be tried again, with how long it will
     * wait. The desk shows one indicator for the whole wait: a pause the
     * traveler did not ask for is a pause the traveler should be able to see,
     * and it stays cancellable throughout. A call that never retries never
     * calls this.
     */
    onWait?: (info: { attempt: number; delayMs: number; reason: string }) => void;
  }): Promise<ModelCompletion>;
}

/**
 * What a tool reads from a connector: a base URL override and/or a key. The key
 * travels only in an Authorization header — never in a summary, data payload,
 * warning, or the model prompt.
 */
export interface ConnectorCredentials {
  /** Present for named flight/stay sources; absent for simple singleton tools. */
  providerId?: string;
  providerName?: string;
  baseUrl?: string;
  apiKey?: string;
  /**
   * Which built-in adapter speaks to this source. Absent means the normalized
   * TravelClaw contract (`./adapters`).
   */
  adapter?: string;
  /**
   * Operator aliases for a vendor that needs a code rather than a city name:
   * lowercased place → airport code or Google location id. Not a secret.
   */
  cityCodes?: Record<string, string>;
}

/**
 * How built-in tools resolve an operator-held connector by name. The gateway
 * builds this per turn from the operator's env. `rejected` lets a tool report
 * a 401/403 so the desk can log it without ever seeing the secret itself.
 */
export interface ToolConnectors {
  get(name: string): ConnectorCredentials | undefined;
  /** All operator-managed sources for a search slot. Older/singleton tools use `get`. */
  all?(name: string): ConnectorCredentials[];
  rejected?(name: string): void;
}

export interface ToolContext {
  now: Date;
  network: boolean;
  fetchImpl?: typeof fetch;
  connectors?: ToolConnectors;
  /**
   * The turn's Stop. Passed to every call a tool makes so a retry cannot
   * outlive the traveler who asked for it — a stopped turn ends the wait
   * between two attempts as well as the attempt itself.
   */
  signal?: AbortSignal;
}

export interface JsonSchemaObject {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties: boolean;
}

/**
 * What a tool runner receives. Router calls derive `hints` from the traveler's
 * text; model calls validate the model's arguments into the same shape, so a
 * tool body never has to care which path called it.
 */
export interface ToolInput {
  text: string;
  hints: TripHints;
}
