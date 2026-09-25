import type { BudgetStyle, MemoryKind, Pace } from '@travelclaw/shared';

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

export interface ToolTrace {
  name: string;
  ok: boolean;
  summary: string;
}

export interface ToolResult<T = unknown> {
  name: string;
  ok: boolean;
  summary: string;
  data: T;
  warning?: string;
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

export interface TripHints {
  destination?: string;
  origin?: string;
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

export interface ModelCompletion {
  text: string;
  provider: string;
  model: string;
}

export interface ModelProvider {
  id: string;
  model: string;
  complete(input: {
    system: string;
    history: HistoryTurn[];
    user: string;
    fallback: string;
  }): Promise<ModelCompletion>;
}

export interface ToolContext {
  now: Date;
  network: boolean;
  fetchImpl?: typeof fetch;
}
