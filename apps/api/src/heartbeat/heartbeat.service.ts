import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DEFAULT_AGENT_ID, type HeartbeatRecord } from '@travelclaw/shared';
import { addInterval, newId, nowIso } from '../common/util';
import { DatabaseService } from '../db/database.service';
import { EventsService } from '../events/events.service';
import { TripsService } from '../trips/trips.service';

interface JobRow {
  id: string;
  agent_id: string;
  name: string;
  every: string;
  prompt: string;
  enabled: number;
  last_run_at: string | null;
  next_run_at: string | null;
  last_result: string | null;
}

@Injectable()
export class HeartbeatService implements OnModuleInit {
  constructor(
    private readonly db: DatabaseService,
    private readonly trips: TripsService,
    private readonly events: EventsService,
  ) {}

  onModuleInit() {
    const existing = this.db.get('SELECT id FROM heartbeat_jobs WHERE name = ?', 'departure-watch');
    if (existing) return;
    const now = new Date();
    this.db.run(
      `INSERT INTO heartbeat_jobs (id, agent_id, name, every, prompt, enabled, last_run_at, next_run_at, last_result)
       VALUES (?, ?, 'departure-watch', '30m', ?, 1, NULL, ?, NULL)`,
      newId(),
      DEFAULT_AGENT_ID,
      'Note trips starting within 14 days. Reply NO_REPLY if none.',
      addInterval(now, '30m').toISOString(),
    );
  }

  list(): HeartbeatRecord[] {
    return this.db.all<JobRow>('SELECT * FROM heartbeat_jobs ORDER BY name ASC').map(mapJob);
  }

  @Cron(CronExpression.EVERY_MINUTE)
  tick() {
    if (process.env.TRAVELCLAW_HEARTBEAT === '0') return;
    const now = nowIso();
    const due = this.db.all<JobRow>(
      `SELECT * FROM heartbeat_jobs WHERE enabled = 1 AND (next_run_at IS NULL OR next_run_at <= ?)`,
      now,
    );
    for (const job of due) this.run(job.id);
  }

  run(id: string): HeartbeatRecord {
    const job = this.db.get<JobRow>('SELECT * FROM heartbeat_jobs WHERE id = ?', id);
    if (!job) throw new NotFoundException(`No heartbeat ${id}`);
    const upcoming = this.trips.upcoming(14);
    const result = upcoming.length
      ? upcoming.map((trip) => `${trip.destination} starts ${trip.startDate} (${trip.status})`).join('; ')
      : 'NO_REPLY';
    const now = new Date();
    this.db.run(
      `UPDATE heartbeat_jobs SET last_run_at = ?, next_run_at = ?, last_result = ? WHERE id = ?`,
      now.toISOString(),
      addInterval(now, job.every).toISOString(),
      result,
      id,
    );
    const updated = this.must(id);
    this.events.emit('heartbeat', updated);
    return updated;
  }

  private must(id: string): HeartbeatRecord {
    const row = this.db.get<JobRow>('SELECT * FROM heartbeat_jobs WHERE id = ?', id);
    if (!row) throw new NotFoundException(`No heartbeat ${id}`);
    return mapJob(row);
  }
}

function mapJob(row: JobRow): HeartbeatRecord {
  return {
    id: row.id,
    agentId: row.agent_id,
    name: row.name,
    every: row.every,
    prompt: row.prompt,
    enabled: row.enabled === 1,
    lastRunAt: row.last_run_at,
    nextRunAt: row.next_run_at,
    lastResult: row.last_result,
  };
}
