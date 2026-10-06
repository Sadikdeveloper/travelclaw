import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  deskName,
  extractHints,
  flightQueryFrom,
  mergeSearchMarket,
  requestProviderHold,
  searchFlights,
  searchMarketFrom,
  searchStays,
  stayQueryFrom,
  type DeskKind,
  type FlightQuery,
  type ProviderSearchFound,
  type ProviderSearchResult,
  type SearchMarket,
  type StayQuery,
  type ToolContext,
} from '@travelclaw/agent-core';
import {
  offerCarriers,
  offerFactsLine,
  offerRoute,
  type AgentTaskRecord,
  type AgentTaskStatus,
  type HoldAttempt,
  type OfferRecord,
  type TaskDecision,
} from '@travelclaw/shared';
import { newId, nowIso } from '../common/util';
import { BrowserService } from '../browser/browser.service';
import { loadConfig } from '../config';
import { ConnectorsService } from '../connectors/connectors.service';
import { DatabaseService } from '../db/database.service';
import { EventsService } from '../events/events.service';
import { SessionsService } from '../sessions/sessions.service';

interface TaskRow {
  id: string;
  session_id: string;
  message_id: string | null;
  kind: DeskKind;
  agent_name: string;
  status: AgentTaskStatus;
  summary: string;
  request: string;
  pass: number;
  created_at: string;
  updated_at: string;
}

interface OfferRow {
  id: string;
  session_id: string;
  task_id: string;
  kind: DeskKind;
  provider: string;
  provider_id: string;
  provider_base_url: string;
  provider_offer_id: string;
  retrieved_at: string;
  currency: string;
  total_amount: number;
  title: string;
  detail: string | null;
  facts_json: string | null;
  hold: OfferRecord['hold'];
  hold_support: OfferRecord['holdSupport'];
  hold_ref: string | null;
  hold_expires_at: string | null;
  hold_note: string | null;
  created_at: string;
  updated_at: string;
}

/** Keep a finite history of unheld offers; provider-confirmed holds are never pruned. */
const MAX_STORED_OFFERS_PER_TASK = 24;

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private readonly holdRequests = new Map<string, Promise<HoldAttempt>>();
  private readonly desksWithHoldRequests = new Set<string>();

  constructor(
    private readonly db: DatabaseService,
    private readonly events: EventsService,
    private readonly sessions: SessionsService,
    private readonly connectors: ConnectorsService,
    private readonly browser: BrowserService,
  ) {}

  /** Whether an authorized browser source can perform a live search without an adapter. */
  canResearchWithBrowser(): boolean {
    return this.browser.enabled();
  }

  /** Used by the controller to check chat ownership before a decision touches a task. */
  sessionIdFor(taskId: string): string {
    return this.get(taskId).session_id;
  }

  /** Same ownership check for an offer action; an offer id is not a credential. */
  sessionIdForOffer(taskId: string, offerId: string): string {
    this.getOffer(taskId, offerId);
    return this.get(taskId).session_id;
  }

  forSession(sessionId: string): AgentTaskRecord[] {
    return this.db
      .all<TaskRow>(
        'SELECT * FROM agent_tasks WHERE session_id = ? ORDER BY created_at ASC',
        sessionId,
      )
      .map((row) => ({
        ...mapTask(row, this.offersFor(row.id)),
        ...(this.browser.state(row.id) ? { browser: this.browser.state(row.id) } : {}),
      }));
  }

  open(input: {
    sessionId: string;
    messageId: string;
    kinds: DeskKind[];
    request: string;
  }): AgentTaskRecord[] {
    const now = nowIso();
    return input.kinds.map((kind) => {
      const id = newId();
      this.db.run(
        `INSERT INTO agent_tasks
          (id, session_id, message_id, kind, agent_name, status, summary, request, pass, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'working', ?, ?, 1, ?, ?)`,
        id,
        input.sessionId,
        input.messageId,
        kind,
        deskName(kind),
        'Working on the request.',
        input.request,
        now,
        now,
      );
      return mapTask(this.get(id), []);
    });
  }

  /** Finish now in tests. In the UI, leave a short working state so the spin-up is visible. */
  async schedule(tasks: AgentTaskRecord[]) {
    const delay = loadConfig().taskDelayMs;
    const finishAll = async () => {
      await Promise.all(
        tasks.map(async (task) => {
          try {
            await this.finish(task.id);
          } catch (err) {
            this.logger.error(`Task ${task.id} failed to finish`, err);
          }
        }),
      );
    };
    if (!Number.isFinite(delay) || delay <= 0) {
      await finishAll();
      return;
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        void finishAll().then(resolve);
      }, delay);
      this.timers.add(timer);
    });
  }

  async decide(id: string, decision: TaskDecision): Promise<AgentTaskRecord> {
    const task = this.get(id);
    // `completed` is a source-backed terminal search result. The feedback dialog
    // may acknowledge it, reject it, or ask for another message without pretending
    // the search is still running. `awaiting` remains for a browser handoff.
    if (task.status !== 'awaiting' && task.status !== 'completed') {
      throw new ConflictException('That desk is not ready for feedback');
    }
    if (decision === 'still_working' && this.desksWithHoldRequests.has(id)) {
      throw new ConflictException('Wait for the provider hold request to finish first');
    }
    if (decision === 'complete') {
      return this.patch(id, {
        status: 'accepted',
        summary: `${task.summary} You marked it complete. Nothing was purchased.`,
      });
    }
    if (decision === 'no') {
      return this.patch(id, {
        status: 'rejected',
        summary: `${task.summary} You sent it back. Say what to change in the chat.`,
      });
    }
    // Do not re-run the same request just because a person pressed "still
    // working". It produced stale cards that immediately asked the same question
    // again. A new chat message carries the correction or extra requirement and
    // starts a new, traceable search when it is ready.
    return this.patch(id, {
      status: 'awaiting',
      summary: `${task.summary} Continue in chat with any change or missing detail; no duplicate search was started.`,
    });
  }

  /**
   * Ask the same provider that returned an offer to place a hold. This is a
   * separate traveler action; searching, accepting a desk brief, or narrating
   * an offer never calls this method. A soft provider answer leaves the offer
   * marked `none` and records the wording without claiming anything is reserved.
   */
  async holdOffer(taskId: string, offerId: string): Promise<HoldAttempt> {
    const task = this.get(taskId);
    const offer = this.getOffer(taskId, offerId);
    if (offer.hold === 'confirmed') {
      return {
        offer: mapOffer(offer),
        task: mapTask(task, this.offersFor(taskId)),
        confirmed: true,
        note: `${offer.provider} already confirmed this hold${offer.hold_ref ? ` (reference ${offer.hold_ref})` : ''}. Nothing was purchased.`,
      };
    }

    // A second click in another tab shares one in-flight provider request. The
    // external offer id is not enough by itself to authorize this operation.
    const inFlight = this.holdRequests.get(offerId);
    if (inFlight) return inFlight;
    if (this.desksWithHoldRequests.has(taskId)) {
      throw new ConflictException(
        'A provider hold request is already running for this desk',
      );
    }

    this.desksWithHoldRequests.add(taskId);
    const attempt = this.performHold(task, offer).finally(() => {
      this.holdRequests.delete(offerId);
      this.desksWithHoldRequests.delete(taskId);
    });
    this.holdRequests.set(offerId, attempt);
    return attempt;
  }

  private async performHold(task: TaskRow, offer: OfferRow): Promise<HoldAttempt> {
    const config = loadConfig();
    const result = await requestProviderHold(
      {
        kind: task.kind,
        providerOfferId: offer.provider_offer_id,
        providerId: offer.provider_id,
        providerName: offer.provider,
        providerBaseUrl: offer.provider_base_url,
      },
      {
        now: new Date(),
        network: config.network,
        fetchImpl: fetch,
        connectors: this.connectors.resolverFor(),
      },
    );
    const now = nowIso();
    if (result.confirmed && result.ref) {
      this.db.run(
        `UPDATE offers
         SET hold = 'confirmed', hold_ref = ?, hold_expires_at = ?, hold_note = NULL, updated_at = ?
         WHERE id = ? AND task_id = ? AND hold = 'none'`,
        result.ref,
        result.expiresAt,
        now,
        offer.id,
        task.id,
      );
    } else {
      // This explains why the ask did not change the offer into a hold. It does
      // not change the hold column: only the provider's explicit confirmation can.
      this.db.run(
        "UPDATE offers SET hold_note = ?, updated_at = ? WHERE id = ? AND task_id = ? AND hold = 'none'",
        result.note,
        now,
        offer.id,
        task.id,
      );
    }
    const fresh = this.getOffer(task.id, offer.id);
    const savedOffer = mapOffer(fresh);
    const confirmed = savedOffer.hold === 'confirmed';
    let updatedTask: AgentTaskRecord;
    if (confirmed) {
      const current = this.get(task.id);
      updatedTask = this.patch(task.id, {
        status: current.status,
        summary: holdConfirmedSummary(
          current.summary,
          task.kind,
          mapOffer(offer),
          savedOffer,
          this.offersFor(task.id),
        ),
      });
    } else {
      this.events.emit('task.updated', {
        sessionId: task.session_id,
        taskId: task.id,
        userId: this.sessions.ownerOf(task.session_id),
      });
      updatedTask = mapTask(this.get(task.id), this.offersFor(task.id));
    }
    const note =
      confirmed || !result.confirmed
        ? result.note
        : 'The provider confirmation could not be saved, so this remains an offer. Nothing was purchased.';
    return { offer: savedOffer, task: updatedTask, confirmed, note };
  }

  private async finish(id: string) {
    const task = this.get(id);
    if (task.status !== 'working') return;
    const lead = briefLead(task.kind, task.request, task.pass);
    const summary = await this.searchIfConfigured(task, lead);
    // Finishing a source query is a real result even when it found no offers.
    // Only an explicit browser handoff needs input from the traveler; the desk
    // must not turn every completed brief into a "Ready for you" confirmation.
    const browser = this.browser.state(id);
    const status = browser?.status === 'handoff' ? 'awaiting' : 'completed';
    this.patch(id, { status, summary });
  }

  async stopBrowser(id: string): Promise<AgentTaskRecord> {
    await this.browser.stop(id);
    const task = this.get(id);
    return this.forSession(task.session_id).find((item) => item.id === id)!;
  }

  private async browserFallback(task: TaskRow, summary: string): Promise<string> {
    if (!this.browser.enabled()) return summary;
    const result = await this.browser.research(task);
    return `${summary} Browser fallback: ${result}`;
  }

  /** Prefer configured providers. Browser observations never enter the offers table. */
  private async searchIfConfigured(task: TaskRow, lead: string): Promise<string> {
    const credentials = this.connectors.credentialsFor(task.kind);
    if (!credentials?.apiKey) {
      return this.browserFallback(
        task,
        `${lead} ${holdStatus(task.kind, this.hasConfirmedHold(task.id))}`,
      );
    }

    const config = loadConfig();
    // Market context comes from the message that states it; the operator's
    // single-market default fills only the keys the traveler left out. Nothing is
    // stored on the account, so a casually mentioned market cannot become a profile.
    const statedMarket = searchMarketFrom(task.request);
    const market = mergeSearchMarket(statedMarket, {
      bookerCountry: config.searchBookerCountry ?? undefined,
      currency: config.searchCurrency ?? undefined,
      language: config.searchLanguage ?? undefined,
    });
    const ctx: ToolContext = {
      now: new Date(),
      network: config.network,
      fetchImpl: fetch,
      connectors: this.connectors.resolverFor(),
    };
    let result: ProviderSearchResult;
    let searchLead = lead;
    try {
      const hints = extractHints(task.request);
      if (task.kind === 'flight') {
        const draft = flightQueryFrom(task.request, hints);
        if (!draft.query) {
          // Asking a provider with a half route or date would turn a guess into a
          // search. The regular brief names the details still needed.
          return `${lead} Provider search needs ${draft.missing.join(', ')}; no provider call was made. ${holdStatus(task.kind, this.hasConfirmedHold(task.id))}`;
        }
        const query = { ...draft.query, ...market };
        searchLead = `${flightSearchLead(query, task.pass, hints.travelers)}${marketNote(query, statedMarket)}`;
        result = await searchFlights(query, ctx);
      } else {
        const draft = stayQueryFrom(task.request, hints);
        if (!draft.query) {
          return `${lead} Provider search needs ${draft.missing.join(', ')}; no provider call was made. ${holdStatus(task.kind, this.hasConfirmedHold(task.id))}`;
        }
        const query = { ...draft.query, ...market };
        searchLead = `${staySearchLead(query, task.pass, hints.travelers)}${marketNote(query, statedMarket)}`;
        result = await searchStays(query, ctx);
      }
    } catch {
      // A provider or a malformed operator URL cannot prevent the desk from
      // returning its regular brief. Never include an exception that could carry
      // request headers or the configured key.
      this.logger.warn(`${task.kind} search failed before it returned a result`);
      return this.browserFallback(
        task,
        `${searchLead} Provider search could not complete. No current offers were returned. ${holdStatus(task.kind, this.hasConfirmedHold(task.id))}`,
      );
    }
    if (!result.ok) {
      this.logger.warn(`${task.kind} search: ${result.detail}`);
      return this.browserFallback(
        task,
        `${searchLead} Provider search was not completed: ${result.detail} No prices or availability are confirmed. ${holdStatus(task.kind, this.hasConfirmedHold(task.id))}`,
      );
    }

    const offers = this.storeOffers(task, result);
    const summary = providerBrief(
      searchLead,
      result,
      offers,
      this.hasConfirmedHold(task.id),
    );
    return offers.length ? summary : this.browserFallback(task, summary);
  }

  private storeOffers(task: TaskRow, result: ProviderSearchFound): OfferRecord[] {
    const now = nowIso();
    const ids: string[] = [];
    this.db.transaction(() => {
      for (const offer of result.offers) {
        const id = newId();
        ids.push(id);
        this.db.run(
          `INSERT INTO offers
            (id, session_id, task_id, kind, provider, provider_id, provider_base_url, provider_offer_id,
             retrieved_at, currency, total_amount, title, detail, facts_json, hold, hold_support, hold_ref,
             hold_expires_at, hold_note, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          id,
          task.session_id,
          task.id,
          task.kind,
          offer.provider,
          offer.providerId,
          offer.providerBaseUrl,
          offer.providerOfferId,
          offer.retrievedAt,
          offer.currency,
          offer.totalAmount,
          offer.title,
          offer.detail,
          offer.facts ? JSON.stringify(offer.facts) : null,
          offer.hold,
          offer.holdSupport,
          offer.holdRef,
          offer.holdExpiresAt,
          offer.holdNote,
          now,
          now,
        );
      }
      if (ids.length) {
        this.db.run(
          `DELETE FROM offers WHERE task_id = ? AND hold = 'none' AND id NOT IN (
            SELECT id FROM offers WHERE task_id = ? AND hold = 'none'
            ORDER BY retrieved_at DESC, created_at DESC, rowid DESC LIMIT ?
          )`,
          task.id,
          task.id,
          MAX_STORED_OFFERS_PER_TASK,
        );
      }
    });
    return this.offersFor(task.id).filter((offer) => ids.includes(offer.id));
  }

  private offersFor(taskId: string): OfferRecord[] {
    return this.db
      .all<OfferRow>(
        'SELECT * FROM offers WHERE task_id = ? ORDER BY retrieved_at DESC, created_at DESC, rowid ASC',
        taskId,
      )
      .map(mapOffer);
  }

  private hasConfirmedHold(taskId: string): boolean {
    return (
      this.db.get<{ id: string }>(
        "SELECT id FROM offers WHERE task_id = ? AND hold = 'confirmed' LIMIT 1",
        taskId,
      ) !== undefined
    );
  }

  private getOffer(taskId: string, offerId: string): OfferRow {
    const row = this.db.get<OfferRow>(
      'SELECT * FROM offers WHERE id = ? AND task_id = ?',
      offerId,
      taskId,
    );
    if (!row) throw new NotFoundException('No offer for that desk');
    return row;
  }

  private get(id: string): TaskRow {
    const row = this.db.get<TaskRow>('SELECT * FROM agent_tasks WHERE id = ?', id);
    if (!row) throw new NotFoundException(`No task ${id}`);
    return row;
  }

  private patch(
    id: string,
    next: { status: AgentTaskStatus; summary: string; pass?: number },
  ): AgentTaskRecord {
    const now = nowIso();
    this.db.run(
      `UPDATE agent_tasks SET status = ?, summary = ?, pass = COALESCE(?, pass), updated_at = ? WHERE id = ?`,
      next.status,
      next.summary,
      next.pass ?? null,
      now,
      id,
    );
    const task = {
      ...mapTask(this.get(id), this.offersFor(id)),
      ...(this.browser.state(id) ? { browser: this.browser.state(id) } : {}),
    };
    this.events.emit('task.updated', {
      sessionId: task.sessionId,
      taskId: task.id,
      userId: this.sessions.ownerOf(task.sessionId),
    });
    return task;
  }
}

function briefLead(kind: DeskKind, request: string, pass: number): string {
  const hints = extractHints(request);
  const passNote = pass > 1 ? ` Pass ${pass}.` : '';
  const when = hints.startDate
    ? hints.endDate
      ? ` from ${hints.startDate} to ${hints.endDate}`
      : ` on ${hints.startDate}`
    : '';
  if (kind === 'flight') {
    const route =
      hints.origin && hints.destination
        ? `${hints.origin} to ${hints.destination}`
        : hints.destination
          ? `a flight into ${hints.destination}`
          : 'the flight you asked for';
    const missing = [
      hints.origin ? '' : 'an origin city',
      hints.destination ? '' : 'a destination',
      hints.startDate ? '' : 'a date',
    ].filter(Boolean);
    const gap = missing.length ? ` Still need ${missing.join(', ')}.` : '';
    return `Flight desk finished a brief for ${route}${when}.${passNote}${gap}`;
  }
  const where = hints.destination ? hints.destination : 'the stay you asked for';
  const party = hints.travelers ? ` for ${hints.travelers}` : '';
  const missing = [
    hints.destination ? '' : 'a city',
    hints.startDate ? '' : 'dates',
  ].filter(Boolean);
  const gap = missing.length ? ` Still need ${missing.join(' and ')}.` : '';
  return `Stay desk finished a brief for ${where}${party}${when}.${passNote}${gap}`;
}

function flightSearchLead(
  query: FlightQuery,
  pass: number,
  requestedTravelers?: number,
): string {
  const returning = query.returnDate ? `, returning ${query.returnDate}` : ', one-way';
  const party = requestedTravelers
    ? `Search party: ${query.travelers} traveler${query.travelers === 1 ? '' : 's'}.`
    : 'Search assumed one traveler because no party size was specified.';
  const passNote = pass > 1 ? ` Pass ${pass}.` : '';
  return `Flight desk finished a brief for ${query.origin} to ${query.destination}, departing ${query.departDate}${returning}.${passNote} ${party}`;
}

function staySearchLead(
  query: StayQuery,
  pass: number,
  requestedTravelers?: number,
): string {
  const party = requestedTravelers
    ? `Search party: ${query.travelers} traveler${query.travelers === 1 ? '' : 's'}.`
    : 'Search assumed one traveler because no party size was specified.';
  const passNote = pass > 1 ? ` Pass ${pass}.` : '';
  return `Stay desk finished a brief for ${query.destination} from ${query.checkIn} to ${query.checkOut}.${passNote} ${party}`;
}

/**
 * The brief says where each piece of pricing context came from, so a traveler reading
 * the summary can tell their own words from the operator's standing default.
 */
function marketNote(market: SearchMarket, stated: SearchMarket): string {
  const entries = [
    market.bookerCountry
      ? {
          text: `booker country ${market.bookerCountry}`,
          stated: stated.bookerCountry === market.bookerCountry,
        }
      : null,
    market.currency
      ? {
          text: `requested currency ${market.currency}`,
          stated: stated.currency === market.currency,
        }
      : null,
    market.language
      ? {
          text: `content language ${market.language}`,
          stated: stated.language === market.language,
        }
      : null,
  ].filter((entry): entry is { text: string; stated: boolean } => entry !== null);
  if (entries.length === 0) return '';
  const sources = new Set(entries.map((entry) => entry.stated));
  if (sources.size === 1) {
    const source = entries[0].stated ? 'from your message' : 'from the operator default';
    return ` Pricing context ${source}: ${entries.map((entry) => entry.text).join(', ')}.`;
  }
  return ` Pricing context: ${entries
    .map((entry) => `${entry.text} (${entry.stated ? 'your message' : 'operator default'})`)
    .join(', ')}.`;
}

function holdStatus(kind: DeskKind, confirmed: boolean): string {
  if (confirmed)
    return 'A saved offer has a provider-confirmed hold. Nothing was purchased.';
  return kind === 'flight'
    ? 'No seat is held. Nothing was purchased.'
    : 'No room is held. Nothing was purchased.';
}

/**
 * One offer as one line. The card above draws the times and stops; the brief
 * names the same facts in a sentence the model can carry into its reply without
 * repeating every leg. A source that sent only prose keeps that prose here,
 * because it is the only description of the offer there is.
 */
function providerOfferSummary(offer: OfferRecord, index: number): string {
  const price = `${offer.totalAmount.toLocaleString('en-US', { maximumFractionDigits: 3 })} ${offer.currency}`;
  const status =
    offer.hold === 'confirmed'
      ? `provider-confirmed hold${offer.holdRef ? ` (${offer.holdRef})` : ''}`
      : 'offer only; no hold confirmed';
  const facts = offer.facts;
  if (facts?.kind === 'flight') {
    const carriers = offerCarriers(facts);
    const lead = carriers.length ? carriers.join(', ') : offer.title;
    const route = offerRoute(facts);
    const heading = [lead, route].filter(Boolean).join(': ');
    const shape = offerFactsLine(facts);
    return `${index + 1}. ${heading} — ${shape ? `${shape} — ` : ''}${price} (${status}).`;
  }
  if (facts?.kind === 'stay') {
    const shape = offerFactsLine(facts);
    return `${index + 1}. ${facts.name} — ${shape ? `${shape} — ` : ''}${price} (${status}).`;
  }
  const detail = offer.detail ? ` — ${offer.detail}` : '';
  return `${index + 1}. ${offer.title}: ${price}${detail} (${status}).`;
}

function holdConfirmedSummary(
  summary: string,
  kind: DeskKind,
  previous: OfferRecord,
  confirmed: OfferRecord,
  offers: OfferRecord[],
): string {
  let updated = summary;
  const sameSearch = offers.filter((offer) => offer.retrievedAt === previous.retrievedAt);
  const index = sameSearch.findIndex((offer) => offer.id === previous.id);
  if (index >= 0 && summary.includes(`Retrieved ${previous.retrievedAt}`)) {
    updated = updated.replace(
      providerOfferSummary(previous, index),
      providerOfferSummary(confirmed, index),
    );
  }

  const unheldStatus = holdStatus(kind, false);
  const heldStatus = holdStatus(kind, true);
  if (updated.includes(unheldStatus)) return updated.replace(unheldStatus, heldStatus);
  if (updated.includes(heldStatus)) return updated;
  const reference = confirmed.holdRef ? ` (reference ${confirmed.holdRef})` : '';
  return `${updated} ${confirmed.provider} confirmed a hold for ${confirmed.title}${reference}. Nothing was purchased.`;
}

function providerBrief(
  lead: string,
  result: ProviderSearchFound,
  offers: OfferRecord[],
  hasConfirmedHold: boolean,
): string {
  const successful = result.sources.filter((source) => source.ok);
  const failed = result.sources.filter((source) => !source.ok);
  const lines = offers.map(providerOfferSummary);
  const availability = offers.length
    ? `Found ${offers.length} provider offer${offers.length === 1 ? '' : 's'} across ${successful.length} source${successful.length === 1 ? '' : 's'}.`
    : successful.length === 1
      ? 'The provider returned no current offers.'
      : 'The configured providers returned no current offers.';
  const sourceLine =
    successful.length === 1
      ? `Provider: ${successful[0].provider}. Retrieved ${successful[0].retrievedAt}.`
      : `Providers: ${successful.map((source) => `${source.provider} (${source.retrievedAt})`).join(', ')}. Each offer below names its source.`;
  const partial = failed.length
    ? `Some provider sources failed; results may be incomplete. ${failed.map((source) => `${source.provider}: ${source.detail}`).join(' ')}`
    : '';
  const dropped = result.dropped
    ? ` ${result.dropped} provider result${result.dropped === 1 ? ' was' : 's were'} omitted because it did not match the supported offer format or lacked a usable price/id.`
    : '';
  const limited = result.limited
    ? ` ${result.limited} more valid offer${result.limited === 1 ? ' was' : 's were'} not shown because the desk keeps at most six across this search.`
    : '';
  return [
    lead,
    sourceLine,
    availability,
    partial,
    ...lines,
    dropped.trim(),
    limited.trim(),
    holdStatus(result.kind, hasConfirmedHold),
  ]
    .filter(Boolean)
    .join(' ');
}

function mapTask(row: TaskRow, offers: OfferRecord[]): AgentTaskRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    messageId: row.message_id,
    kind: row.kind,
    agentName: row.agent_name,
    status: row.status,
    summary: row.summary,
    pass: row.pass,
    offers,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Facts were written by the desk from a validated vendor payload, but a stored
 * row is still read defensively: unreadable JSON is `null`, which the card shows
 * as prose rather than as a broken row or an invented number.
 */
function parseOfferFacts(raw: string | null): OfferRecord['facts'] {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const kind = (parsed as { kind?: unknown }).kind;
    if (kind !== 'flight' && kind !== 'stay') return null;
    return parsed as OfferRecord['facts'];
  } catch {
    return null;
  }
}

function mapOffer(row: OfferRow): OfferRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    taskId: row.task_id,
    kind: row.kind,
    provider: row.provider,
    providerOfferId: row.provider_offer_id,
    retrievedAt: row.retrieved_at,
    currency: row.currency,
    totalAmount: row.total_amount,
    title: row.title,
    detail: row.detail,
    facts: parseOfferFacts(row.facts_json),
    hold: row.hold,
    holdSupport: row.hold_support,
    holdRef: row.hold_ref,
    holdExpiresAt: row.hold_expires_at,
    holdNote: row.hold_note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
