import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { buildOutline, type OutlineData } from '@travelclaw/agent-core';
import type {
  CreateTripInput,
  ItineraryDayRecord,
  Pace,
  PlanTripInput,
  TripRecord,
  TripStatus,
  UpdateTripInput,
} from '@travelclaw/shared';
import { addInterval, newId, nowIso, parseJson } from '../common/util';
import { loadConfig } from '../config';
import { DatabaseService } from '../db/database.service';
import { AgentsService } from '../agents/agents.service';

interface TripRow {
  id: string;
  agent_id: string;
  title: string;
  destination: string;
  origin: string | null;
  start_date: string;
  end_date: string;
  travelers: number;
  budget_cents: number | null;
  currency: string;
  pace: Pace;
  status: TripStatus;
  interests_json: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

interface DayRow {
  id: string;
  trip_id: string;
  day_index: number;
  date: string;
  title: string;
  summary: string;
  places_json: string;
}

@Injectable()
export class TripsService implements OnModuleInit {
  constructor(
    private readonly db: DatabaseService,
    private readonly agents: AgentsService,
  ) {}

  onModuleInit() {
    if (!loadConfig().seed) return;
    const count = this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM trips');
    if (count && count.n > 0) return;
    const start = new Date();
    start.setUTCDate(start.getUTCDate() + 21);
    const end = addInterval(start, '4d');
    this.create({
      destination: 'Lisbon',
      origin: 'Home',
      startDate: start.toISOString().slice(0, 10),
      endDate: end.toISOString().slice(0, 10),
      travelers: 1,
      pace: 'steady',
      currency: 'USD',
      interests: ['food', 'walking'],
      notes: 'Sample trip. Delete it when you add your own.',
      title: 'Lisbon, unhurried',
    });
  }

  list(): TripRecord[] {
    return this.db
      .all<TripRow>('SELECT * FROM trips ORDER BY start_date ASC')
      .map((row) => this.hydrate(row, false));
  }

  upcoming(withinDays: number): TripRecord[] {
    const today = new Date().toISOString().slice(0, 10);
    const limit = new Date();
    limit.setUTCDate(limit.getUTCDate() + withinDays);
    const until = limit.toISOString().slice(0, 10);
    return this.db
      .all<TripRow>(
        `SELECT * FROM trips WHERE status != 'done' AND start_date >= ? AND start_date <= ? ORDER BY start_date ASC`,
        today,
        until,
      )
      .map((row) => this.hydrate(row, false));
  }

  latestActive(agentId: string): TripRecord | null {
    const row = this.db.get<TripRow>(
      `SELECT * FROM trips WHERE agent_id = ? AND status != 'done' ORDER BY updated_at DESC LIMIT 1`,
      agentId,
    );
    return row ? this.hydrate(row, false) : null;
  }

  get(id: string): TripRecord {
    const row = this.db.get<TripRow>('SELECT * FROM trips WHERE id = ?', id);
    if (!row) throw new NotFoundException(`No trip ${id}`);
    return this.hydrate(row, true);
  }

  create(input: CreateTripInput): TripRecord {
    const agent = this.agents.resolve(input.agentId);
    const now = nowIso();
    const id = newId();
    this.db.run(
      `INSERT INTO trips (
        id, agent_id, title, destination, origin, start_date, end_date, travelers,
        budget_cents, currency, pace, status, interests_json, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`,
      id,
      agent.id,
      input.title || `${input.destination} · ${input.startDate}`,
      input.destination,
      input.origin || null,
      input.startDate,
      input.endDate,
      input.travelers,
      input.budgetCents || null,
      input.currency.toUpperCase(),
      input.pace,
      JSON.stringify(input.interests ?? []),
      input.notes || '',
      now,
      now,
    );
    return this.get(id);
  }

  update(id: string, input: UpdateTripInput): TripRecord {
    const current = this.get(id);
    const startDate = input.startDate || current.startDate;
    const endDate = input.endDate || current.endDate;
    if (endDate < startDate)
      throw new BadRequestException('endDate must be on or after startDate');
    this.db.run(
      `UPDATE trips SET title = ?, destination = ?, origin = ?, start_date = ?, end_date = ?,
        travelers = ?, budget_cents = ?, currency = ?, pace = ?, status = ?, interests_json = ?,
        notes = ?, updated_at = ? WHERE id = ?`,
      input.title ?? current.title,
      input.destination ?? current.destination,
      input.origin === undefined ? current.origin : input.origin,
      startDate,
      endDate,
      input.travelers ?? current.travelers,
      input.budgetCents === undefined ? current.budgetCents : input.budgetCents,
      (input.currency ?? current.currency).toUpperCase(),
      input.pace ?? current.pace,
      input.status ?? current.status,
      JSON.stringify(input.interests ?? current.interests),
      input.notes ?? current.notes,
      nowIso(),
      id,
    );
    return this.get(id);
  }

  remove(id: string) {
    this.get(id);
    this.db.run('DELETE FROM trips WHERE id = ?', id);
  }

  plan(id: string, input: PlanTripInput): TripRecord {
    const trip = this.get(id);
    const outline = buildOutline({
      destination: trip.destination,
      origin: trip.origin ?? undefined,
      startDate: trip.startDate,
      endDate: trip.endDate,
      travelers: trip.travelers,
      pace: input.pace ?? trip.pace,
      interests: input.interests ?? trip.interests,
    });
    if (!outline) {
      throw new BadRequestException(
        'Could not outline that range. Keep it to 18 days and use YYYY-MM-DD.',
      );
    }
    this.replaceDays(id, outline);
    this.recordRun(id, 'trip.outline', true, `${outline.days.length} days outlined`);
    return this.update(id, {
      status: trip.status === 'draft' ? 'planning' : trip.status,
      pace: outline.pace,
      interests: input.interests ?? trip.interests,
    });
  }

  createFromOutline(
    agentId: string,
    outline: OutlineData,
    extras?: { travelers?: number; origin?: string },
  ): TripRecord {
    const trip = this.create({
      agentId,
      destination: outline.destination,
      origin: extras?.origin,
      startDate: outline.days[0]?.date || new Date().toISOString().slice(0, 10),
      endDate:
        outline.days.at(-1)?.date ||
        outline.days[0]?.date ||
        new Date().toISOString().slice(0, 10),
      travelers: extras?.travelers ?? 1,
      pace: outline.pace,
      currency: 'USD',
      title: `${outline.destination} outline`,
      notes: 'Saved from chat. Availability was not checked.',
    });
    this.replaceDays(trip.id, outline);
    return this.update(trip.id, { status: 'planning' });
  }

  private replaceDays(tripId: string, outline: OutlineData) {
    this.db.transaction(() => {
      this.db.run('DELETE FROM itinerary_days WHERE trip_id = ?', tripId);
      outline.days.forEach((day, index) => {
        this.db.run(
          `INSERT INTO itinerary_days (id, trip_id, day_index, date, title, summary, places_json)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          newId(),
          tripId,
          index,
          day.date,
          day.title,
          day.summary,
          JSON.stringify(day.places),
        );
      });
    });
  }

  private recordRun(tripId: string, tool: string, ok: boolean, summary: string) {
    this.db.run(
      `INSERT INTO tool_runs (id, session_id, trip_id, tool, ok, summary, created_at)
       VALUES (?, NULL, ?, ?, ?, ?, ?)`,
      newId(),
      tripId,
      tool,
      ok ? 1 : 0,
      summary,
      nowIso(),
    );
  }

  private hydrate(row: TripRow, withDays: boolean): TripRecord {
    const trip: TripRecord = {
      id: row.id,
      agentId: row.agent_id,
      title: row.title,
      destination: row.destination,
      origin: row.origin,
      startDate: row.start_date,
      endDate: row.end_date,
      travelers: row.travelers,
      budgetCents: row.budget_cents,
      currency: row.currency,
      pace: row.pace,
      status: row.status,
      interests: parseJson<string[]>(row.interests_json, []),
      notes: row.notes,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
    if (withDays) trip.days = this.days(row.id);
    return trip;
  }

  private days(tripId: string): ItineraryDayRecord[] {
    return this.db
      .all<DayRow>(
        'SELECT * FROM itinerary_days WHERE trip_id = ? ORDER BY day_index ASC',
        tripId,
      )
      .map((row) => ({
        id: row.id,
        tripId: row.trip_id,
        dayIndex: row.day_index,
        date: row.date,
        title: row.title,
        summary: row.summary,
        places: parseJson<string[]>(row.places_json, []),
      }));
  }
}
