import { Injectable, Logger } from '@nestjs/common';
import {
  AGENTIC_TOOL_ROUNDS,
  completeTurn,
  deskName,
  extractHints,
  flightQueryFrom,
  planAgentDesks,
  stayQueryFrom,
  type DeskKind,
  type OutlineData,
} from '@travelclaw/agent-core';
import {
  WEBCHAT_CHANNEL,
  type ChatResponse,
  type MessageAttachment,
  type ModelRecord,
} from '@travelclaw/shared';
import { loadConfig } from '../config';
import { ConnectorsService } from '../connectors/connectors.service';
import { EventsService } from '../events/events.service';
import { AgentsService } from '../agents/agents.service';
import { MemoryService } from '../memory/memory.service';
import { ModelService } from '../models/model.service';
import { SessionsService } from '../sessions/sessions.service';
import { TasksService } from '../tasks/tasks.service';
import { ToolsService } from '../tools/tools.service';
import { TripsService } from '../trips/trips.service';
import { WorkspaceService } from '../workspace/workspace.service';
import { TurnStream } from './turn-stream';

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
    private readonly connectors: ConnectorsService,
    private readonly events: EventsService,
  ) {}

  async handleIncoming(
    input: {
      content: string;
      attachments?: MessageAttachment[];
      agentId?: string;
      channel?: string;
      peerId?: string;
      sessionId?: string;
    },
    userId: string,
    // Resolved by the caller so the pace check and the turn agree on one model. Nobody
    // picks it: the desk runs the best model it has, for guests and accounts alike.
    model: ModelRecord = this.models.best(),
    /**
     * A live turn. When a stream is present the desk narrates as it goes, waits
     * for its desks instead of answering "they are working", and the caller
     * keeps the connection open until this method returns.
     */
    stream?: TurnStream,
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
    stream?.setSession(session.id);
    stream?.send({
      type: 'turn.started',
      at: new Date().toISOString(),
      sessionId: session.id,
      provider: model.provider,
      model: model.id,
      modelLabel: model.label,
    });

    if (input.content.trim().toLowerCase() === '/new') {
      const reset = this.sessions.reset(session.id);
      const message = this.sessions.messages(reset.id, userId).at(-1);
      if (!message) throw new Error('Reset did not leave a note');
      return { session: reset, message, tools: [], provider: 'desk', model: 'command' };
    }

    this.sessions.append(
      session.id,
      'user',
      input.content,
      [],
      undefined,
      input.attachments ?? [],
    );
    // Desk routing reads the traveler's own words: a file named "hotel-list.pdf" is
    // not itself a hotel request. The model, which can reason about what a file is,
    // gets the attachment note as part of its turn text.
    // A desk is a live search, not a generic flight/hotel-shaped reply. It starts
    // only when the traveler gave the fields its source requires *and* this install
    // has a real search path. Incomplete requests stay in the normal conversation,
    // where the model can ask a useful follow-up instead of creating a fake "Ready"
    // card that merely repeats the missing fields.
    const desks = this.searchableDesks(input.content);
    if (desks.length)
      return this.startDesks(session.id, input.content, desks, userId, stream);

    const history = this.sessions.recentHistory(session.id).slice(0, -1);
    // Per-agent persona: workspace/agents/<id>/<file> when it exists, the shared
    // desk file otherwise — per file, so a partial override keeps the rest shared.
    const files = this.workspace.readFiles(agent.id);
    const active = this.trips.latestActive(agent.id);
    const config = loadConfig();
    const turn = await completeTurn(
      {
        text: input.content,
        modelNote: attachmentNote(input.attachments),
        persona: {
          name: agent.name,
          soul: files.soul,
          identity: files.identity,
          user: files.user,
          agents: files.agents,
        },
        // Relevant notes, not just the last few: the traveler's message is the
        // query, and the prompt budget in agent-core keeps the turn the same size.
        memory: this.memory.promptLines(agent.id, input.content),
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
        ctx: {
          now: new Date(),
          network: config.network,
          fetchImpl: fetch,
          connectors: this.connectors.resolverFor(),
        },
        // A live turn gets the agentic loop and a screen to write on. The plain
        // POST keeps the original two-pass shape, so nothing that already reads
        // a turn's result changes underneath it.
        ...(stream
          ? {
              toolRounds: AGENTIC_TOOL_ROUNDS,
              onEvent: stream.sink(),
              signal: stream.signal,
            }
          : { toolRounds: 1 }),
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

  /**
   * Keep the automatic desk hand-off honest: a provider/browser has work to do
   * only after the request can form a valid query. The normal model turn handles
   * the conversational part (clarifying, suggesting alternatives, and so on).
   */
  private searchableDesks(content: string): DeskKind[] {
    const hints = extractHints(content);
    return planAgentDesks(content).filter((kind) => {
      const configured = this.connectors
        .searchProvidersFor(kind)
        .some((source) => Boolean(source.baseUrl && source.apiKey));
      if (!configured && !this.tasks.canResearchWithBrowser()) return false;
      return kind === 'flight'
        ? Boolean(flightQueryFrom(content, hints).query)
        : Boolean(stayQueryFrom(content, hints).query);
    });
  }

  private async startDesks(
    sessionId: string,
    content: string,
    desks: Array<'flight' | 'stay'>,
    userId: string,
    stream?: TurnStream,
  ) {
    const names = desks.map((kind) => deskName(kind));
    const reply =
      names.length === 2
        ? 'Flight desk and Stay desk are searching the configured sources. I will show verified results when each finishes. Nothing is booked.'
        : `${names[0]} is searching the configured sources. I will show verified results when it finishes. Nothing is booked.`;
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
    for (const task of opened) {
      stream?.step({
        id: `desk:${task.id}`,
        kind: 'desk',
        name: task.kind,
        label: `${task.agentName} searching`,
        detail: 'Querying the configured sources. Nothing is booked.',
        state: 'running',
      });
    }
    const delay = loadConfig().taskDelayMs;
    if (stream) {
      // On a live turn the traveler watches the search finish rather than being
      // told it is running and left to refresh.
      await this.tasks.schedule(opened);
      const finished = this.tasks
        .forSession(sessionId)
        .filter((task) => opened.some((item) => item.id === task.id));
      for (const task of finished) {
        stream.step({
          id: `desk:${task.id}`,
          kind: 'desk',
          name: task.kind,
          label: `${task.agentName} ${task.status === 'completed' ? 'finished' : task.status}`,
          detail: task.summary,
          state:
            task.status === 'completed'
              ? 'done'
              : task.status === 'rejected'
                ? 'failed'
                : 'running',
        });
      }
    } else if (delay > 0) {
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

/**
 * The one line the model learns about attachments: what arrived, and of what kind.
 * The gateway never receives the bytes, so the note cannot promise contents — a
 * later document-ingestion step (docs/roadmap.md) is what would read a file.
 */
function attachmentNote(attachments: MessageAttachment[] | undefined): string | undefined {
  if (!attachments?.length) return undefined;
  const listed = attachments
    .map((attachment) => `${attachment.name} (${attachment.kind})`)
    .join(', ');
  return `[The traveler attached: ${listed}. The files are on their device — acknowledge them by name and ask for anything you would need read aloud.]`;
}
