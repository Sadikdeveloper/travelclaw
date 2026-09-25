import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { deskName, extractHints, type DeskKind } from '@travelclaw/agent-core';
import type { AgentTaskRecord, AgentTaskStatus, TaskDecision } from '@travelclaw/shared';
import { newId, nowIso } from '../common/util';
import { loadConfig } from '../config';
import { DatabaseService } from '../db/database.service';
import { EventsService } from '../events/events.service';

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

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();

  constructor(
    private readonly db: DatabaseService,
    private readonly events: EventsService,
  ) {}

  forSession(sessionId: string): AgentTaskRecord[] {
    return this.db
      .all<TaskRow>(
        'SELECT * FROM agent_tasks WHERE session_id = ? ORDER BY created_at ASC',
        sessionId,
      )
      .map(mapTask);
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
      return mapTask(this.get(id));
    });
  }

  /** Finish now in tests. In the UI, leave a short working state so the spin-up is visible. */
  async schedule(tasks: AgentTaskRecord[]) {
    const delay = loadConfig().taskDelayMs;
    if (!Number.isFinite(delay) || delay <= 0) {
      for (const task of tasks) this.finish(task.id);
      return;
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        for (const task of tasks) {
          try {
            this.finish(task.id);
          } catch (err) {
            this.logger.error(`Task ${task.id} failed to finish`, err);
          }
        }
        resolve();
      }, delay);
      this.timers.add(timer);
    });
  }

  async decide(id: string, decision: TaskDecision): Promise<AgentTaskRecord> {
    const task = this.get(id);
    if (task.status !== 'awaiting') {
      throw new ConflictException('That desk is not waiting for a decision');
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
    const again = this.patch(id, {
      status: 'working',
      pass: task.pass + 1,
      summary: 'Still working.',
    });
    if (loadConfig().taskDelayMs > 0) {
      void this.schedule([again]).catch((err) => this.logger.error(err));
      return again;
    }
    await this.schedule([again]);
    return mapTask(this.get(id));
  }

  private finish(id: string) {
    const task = this.get(id);
    if (task.status !== 'working') return;
    this.patch(id, {
      status: 'awaiting',
      summary: brief(task.kind, task.request, task.pass),
    });
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
    const task = mapTask(this.get(id));
    this.events.emit('task.updated', { sessionId: task.sessionId, taskId: task.id });
    return task;
  }
}

function brief(kind: DeskKind, request: string, pass: number): string {
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
    return `Flight desk finished a brief for ${route}${when}.${passNote}${gap} No seat is held. Nothing was purchased.`;
  }
  const where = hints.destination ? hints.destination : 'the stay you asked for';
  const party = hints.travelers ? ` for ${hints.travelers}` : '';
  const missing = [
    hints.destination ? '' : 'a city',
    hints.startDate ? '' : 'dates',
  ].filter(Boolean);
  const gap = missing.length ? ` Still need ${missing.join(' and ')}.` : '';
  return `Stay desk finished a brief for ${where}${party}${when}.${passNote}${gap} No room is held. Nothing was purchased.`;
}

function mapTask(row: TaskRow): AgentTaskRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    messageId: row.message_id,
    kind: row.kind,
    agentName: row.agent_name,
    status: row.status,
    summary: row.summary,
    pass: row.pass,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
