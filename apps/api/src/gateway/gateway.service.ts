import { Injectable, Logger } from '@nestjs/common';
import {
  completeTurn,
  deskName,
  extractHints,
  planAgentDesks,
  type OutlineData,
} from '@travelclaw/agent-core';
import { WEBCHAT_CHANNEL, type ChatResponse, type ModelRecord } from '@travelclaw/shared';
import { loadConfig } from '../config';
import { EventsService } from '../events/events.service';
import { AgentsService } from '../agents/agents.service';
import { MemoryService } from '../memory/memory.service';
import { ModelService } from '../models/model.service';
import { SessionsService } from '../sessions/sessions.service';
import { TasksService } from '../tasks/tasks.service';
import { ToolsService } from '../tools/tools.service';
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
    private readonly tools: ToolsService,
    private readonly tasks: TasksService,
    private readonly workspace: WorkspaceService,
    private readonly models: ModelService,
    private readonly events: EventsService,
  ) {}

  async handleIncoming(
    input: {
      content: string;
      agentId?: string;
      channel?: string;
      peerId?: string;
      sessionId?: string;
    },
    userId: string,
    // Resolved by the caller so the pace check and the turn agree on one model. Nobody
    // picks it: the desk runs the best model it has, for guests and accounts alike.
    model: ModelRecord = this.models.best(),
  ): Promise<ChatResponse> {
    const agent = this.agents.resolve(input.agentId);
    const session = input.sessionId
      ? this.sessions.get(input.sessionId, userId)
      : this.sessions.open(
          {
            agentId: agent.id,
            channel: input.channel || WEBCHAT_CHANNEL,
            peerId: input.peerId,
          },
          userId,
        );

    if (input.content.trim().toLowerCase() === '/new') {
      const reset = this.sessions.reset(session.id);
      const message = this.sessions.messages(reset.id, userId).at(-1);
      if (!message) throw new Error('Reset did not leave a note');
      return { session: reset, message, tools: [], provider: 'desk', model: 'command' };
    }

    this.sessions.append(session.id, 'user', input.content);
    const desks = planAgentDesks(input.content);
    if (desks.length) return this.startDesks(session.id, input.content, desks, userId);

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
      },
      {
        provider: this.models.providerFor(model),
        ctx: { now: new Date(), network: config.network, fetchImpl: fetch },
      },
    );

    if (turn.remembered) this.memory.remember(agent.id, turn.remembered);

    let reply = turn.reply;
    const outline = turn.toolResults.find(
      (result) => result.name === 'trip.outline' && result.ok,
    );
    if (outline && wantsSavedTrip(input.content)) {
      const hints = extractHints(input.content);
      const saved = this.trips.createFromOutline(agent.id, outline.data as OutlineData, {
        travelers: hints.travelers,
        origin: hints.origin,
      });
      reply = `${reply}\n\nSaved as a draft trip: ${saved.title}.`;
    }

    for (const tool of turn.tools) {
      this.tools.record({
        sessionId: session.id,
        tool: tool.name,
        ok: tool.ok,
        summary: tool.summary,
      });
    }

    const message = this.sessions.append(session.id, 'assistant', reply, turn.tools, {
      provider: turn.provider,
      model: turn.model,
    });
    const fresh = this.sessions.get(session.id, userId);
    this.events.emit('chat.completed', {
      sessionId: fresh.id,
      messageId: message.id,
      userId,
    });
    for (const result of turn.toolResults) {
      // A rejected or failed tool call is a warning for the operator, never copy
      // the traveler sees. The traveler gets the summary, or the model's sentence.
      if (result.warning)
        this.logger.warn(`${fresh.key} ${result.name}: ${result.warning}`);
    }
    this.logger.log(
      `${fresh.key} tools=${turn.tools.map((tool) => tool.name).join(',') || 'none'} via ${turn.provider}`,
    );
    return {
      session: fresh,
      message,
      tools: turn.tools,
      provider: turn.provider,
      model: turn.model,
    };
  }

  private async startDesks(
    sessionId: string,
    content: string,
    desks: Array<'flight' | 'stay'>,
    userId: string,
  ) {
    const names = desks.map((kind) => deskName(kind));
    const reply =
      names.length === 2
        ? 'Flight desk and Stay desk are on this. I will ask when each one finishes. Nothing is booked.'
        : `${names[0]} is on this. I will ask when it finishes. Nothing is booked.`;
    const message = this.sessions.append(sessionId, 'assistant', reply, [], {
      provider: 'desk',
      model: 'agents',
    });
    const opened = this.tasks.open({
      sessionId,
      messageId: message.id,
      kinds: desks,
      request: content,
    });
    const delay = loadConfig().taskDelayMs;
    if (delay > 0) {
      void this.tasks.schedule(opened);
    } else {
      await this.tasks.schedule(opened);
    }
    const fresh = this.sessions.get(sessionId, userId);
    this.events.emit('chat.completed', {
      sessionId: fresh.id,
      messageId: message.id,
      userId,
    });
    this.logger.log(`${fresh.key} desks=${names.join(',')}`);
    return { session: fresh, message, tools: [], provider: 'desk', model: 'agents' };
  }
}

function wantsSavedTrip(text: string): boolean {
  return /\b(save|create)\b.{0,40}\btrip\b|\bsave (this|that|it)\b/i.test(text);
}
