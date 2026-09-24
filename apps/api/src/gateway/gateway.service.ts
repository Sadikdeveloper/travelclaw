import { Injectable, Logger } from '@nestjs/common';
import { completeTurn, extractHints, type OutlineData } from '@travelclaw/agent-core';
import { WEBCHAT_CHANNEL, type ChatResponse } from '@travelclaw/shared';
import { loadConfig } from '../config';
import { EventsService } from '../events/events.service';
import { AgentsService } from '../agents/agents.service';
import { MemoryService } from '../memory/memory.service';
import { ModelService } from '../models/model.service';
import { SessionsService } from '../sessions/sessions.service';
import { SkillsService } from '../skills/skills.service';
import { TripsService } from '../trips/trips.service';
import { WorkspaceService } from '../workspace/workspace.service';

@Injectable()
export class GatewayService {
  private readonly logger = new Logger(GatewayService.name);

  constructor(
    private readonly agents: AgentsService,
    private readonly sessions: SessionsService,
    private readonly memory: MemoryService,
    private readonly trips: TripsService,
    private readonly skills: SkillsService,
    private readonly workspace: WorkspaceService,
    private readonly models: ModelService,
    private readonly events: EventsService,
  ) {}

  async handleIncoming(input: {
    content: string;
    agentId?: string;
    channel?: string;
    peerId?: string;
    sessionId?: string;
  }): Promise<ChatResponse> {
    const agent = this.agents.resolve(input.agentId);
    const session = input.sessionId
      ? this.sessions.get(input.sessionId)
      : this.sessions.open({
          agentId: agent.id,
          channel: input.channel || WEBCHAT_CHANNEL,
          peerId: input.peerId,
        });

    if (input.content.trim().toLowerCase() === '/new') {
      const reset = this.sessions.reset(session.id);
      const message = this.sessions.messages(reset.id).at(-1);
      if (!message) throw new Error('Reset did not leave a note');
      return { session: reset, message, skills: [], provider: 'desk', model: 'command' };
    }

    this.sessions.append(session.id, 'user', input.content);
    const history = this.sessions.recentHistory(session.id).slice(0, -1);
    const files = this.workspace.readFiles();
    const active = this.trips.latestActive(agent.id);
    const config = loadConfig();
    const turn = await completeTurn(
      {
        text: input.content,
        persona: {
          name: agent.name,
          soul: files.soul,
          identity: files.identity,
          user: files.user,
          agents: files.agents,
        },
        memory: this.memory.recentLines(agent.id),
        history,
        activeTrip: active
          ? {
              title: active.title,
              destination: active.destination,
              startDate: active.startDate,
              endDate: active.endDate,
              status: active.status,
            }
          : null,
        skillDocs: this.skills.docsForTurn(),
      },
      {
        provider: this.models.provider(),
        ctx: { now: new Date(), network: config.network, fetchImpl: fetch },
      },
    );

    if (turn.remembered) this.memory.remember(agent.id, turn.remembered);

    let reply = turn.reply;
    const outline = turn.skillResults.find((result) => result.name === 'trip.outline' && result.ok);
    if (outline && wantsSavedTrip(input.content)) {
      const hints = extractHints(input.content);
      const saved = this.trips.createFromOutline(agent.id, outline.data as OutlineData, {
        travelers: hints.travelers,
        origin: hints.origin,
      });
      reply = `${reply}\n\nSaved as a draft trip: ${saved.title}.`;
    }

    for (const skill of turn.skills) {
      this.skills.record({
        sessionId: session.id,
        skill: skill.name,
        ok: skill.ok,
        summary: skill.summary,
      });
    }

    const message = this.sessions.append(session.id, 'assistant', reply, turn.skills, {
      provider: turn.provider,
      model: turn.model,
    });
    const fresh = this.sessions.get(session.id);
    this.events.emit('chat.completed', { sessionId: fresh.id, messageId: message.id });
    this.logger.log(
      `${fresh.key} skills=${turn.skills.map((skill) => skill.name).join(',') || 'none'} via ${turn.provider}`,
    );
    return {
      session: fresh,
      message,
      skills: turn.skills,
      provider: turn.provider,
      model: turn.model,
    };
  }
}

function wantsSavedTrip(text: string): boolean {
  return /\b(save|create)\b.{0,40}\btrip\b|\bsave (this|that|it)\b/i.test(text);
}
