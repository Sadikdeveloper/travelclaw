import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Logger,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  chatSchema,
  sendMessageSchema,
  type ChatInput,
  type ModelLimits,
  type ModelRecord,
  type SendMessageInput,
  type UserRecord,
} from '@travelclaw/shared';
import type { Request, Response } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RateLimiter } from '../auth/rate-limiter';
import { clientKey, rateLimited } from '../common/rate-limit';
import { ZodValidationPipe } from '../common/zod-pipe';
import { EventsService } from '../events/events.service';
import { TURN_WINDOW_MS } from '../models/model-catalog';
import { ModelService } from '../models/model.service';
import { SessionsService } from '../sessions/sessions.service';
import { GatewayService } from './gateway.service';
import { LiveTurnsService } from './live-turns.service';
import { TurnStream } from './turn-stream';

/** What a browser run reports while a live turn is open. */
interface BrowserStepEvent {
  sessionId: string;
  taskId: string;
  action?: string;
  message: string;
  status: string;
  step: number;
}

/** Turns a guest may run from one address across *paced* models. Unpaced models are exempt. */
const GUEST_IP_TURNS = 30;

@ApiTags('chat')
@Controller('api')
@UseGuards(AuthGuard)
export class ChatController {
  /**
   * One limiter per tier and model, built from the catalog: each model has its own pace, so
   * a bigger model can be rationed tighter and using up one model does not take the other
   * away. A signed-in account's tier is several times a guest's.
   */
  private readonly turnLimiters = new Map<string, RateLimiter>();
  /** Blunts "hit the guest limit, mint a new guest" — this one is keyed by IP, not account. */
  private readonly guestIpLimiter = new RateLimiter(GUEST_IP_TURNS, TURN_WINDOW_MS);
  private readonly logger = new Logger(ChatController.name);

  constructor(
    private readonly gateway: GatewayService,
    private readonly models: ModelService,
    private readonly events: EventsService,
    private readonly sessions: SessionsService,
    private readonly liveTurns: LiveTurnsService,
  ) {}

  /**
   * What this chat's running turn has reported so far, or `null` when nothing is
   * running. The same POST that starts a turn streams every step back; this GET
   * is the floor under that stream, for a browser whose response is being held
   * up on the way in. It reads only in-memory state — no model call, no work.
   */
  @Get('sessions/:id/turn')
  @ApiOperation({ summary: 'The turn running in this chat right now, if any' })
  liveTurn(@CurrentUser() user: UserRecord, @Param('id') id: string) {
    // Ownership first: an id is not a credential, so a chat that is not this
    // account's is answered like one that does not exist.
    this.sessions.get(id, user.id);
    return { turn: this.liveTurns.running(id) };
  }

  @Post('chat/stream')
  @ApiOperation({ summary: 'Open or continue a chat, streaming the turn as it runs' })
  async chatStream(
    @Req() req: Request,
    @Res() res: Response,
    @CurrentUser() user: UserRecord,
    @Body(new ZodValidationPipe(chatSchema)) body: ChatInput,
  ) {
    this.refuseModelChoice(req);
    await this.runStream(req, res, user, { ...body }, body.sessionId);
  }

  @Post('sessions/:id/messages/stream')
  @ApiOperation({ summary: 'Run a turn inside a chat, streaming it as it runs' })
  async messageStream(
    @Req() req: Request,
    @Res() res: Response,
    @CurrentUser() user: UserRecord,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(sendMessageSchema)) body: SendMessageInput,
  ) {
    this.refuseModelChoice(req);
    await this.runStream(
      req,
      res,
      user,
      {
        content: body.content,
        attachments: body.attachments,
        channel: 'webchat',
        sessionId: id,
      },
      id,
    );
  }

  /**
   * One live turn. Pacing is checked before a single byte is written, so a
   * caller who is over their model's pace gets an ordinary JSON error rather
   * than an event stream that fails halfway.
   */
  private async runStream(
    req: Request,
    res: Response,
    user: UserRecord,
    input: ChatInput,
    sessionId: string | undefined,
  ): Promise<void> {
    const model = this.models.best();
    this.checkTurnLimit(req, user, model);

    const stream = new TurnStream(res);
    stream.open();
    // A browser run is started by the desk, not by this request, so its steps
    // arrive on the event bus. Only this chat's work is forwarded.
    const onBrowserStep = (payload: unknown) => {
      const event = payload as BrowserStepEvent;
      if (!stream.matchesSession(event.sessionId)) return;
      const state = ['handoff', 'stopped', 'failed'].includes(event.status)
        ? 'failed'
        : ['observed', 'ready'].includes(event.status)
          ? 'done'
          : 'running';
      stream.step({
        id: `browser:${event.taskId}:${event.step}`,
        kind: 'browser',
        name: event.action,
        label: event.action
          ? `Browser: ${describeBrowserAction(event.action)}`
          : 'Browser research',
        detail: event.message,
        state,
      });
    };
    this.events.on('browser.step', onBrowserStep);
    // Closing the tab, or pressing Stop, cancels the model call itself rather
    // than only the connection that would have carried its answer. This is
    // `res`, not `req`: a request's own 'close' fires as soon as its body has
    // been read, which would end every stream before the turn began.
    const stop = () => {
      if (!res.writableEnded) stream.stop();
    };
    res.on('close', stop);

    try {
      const response = await this.gateway.handleIncoming(
        {
          content: input.content,
          attachments: input.attachments,
          agentId: input.agentId,
          channel: input.channel,
          peerId: input.peerId,
          sessionId: sessionId ?? input.sessionId,
        },
        user.id,
        model,
        stream,
      );
      stream.complete(response);
    } catch (error) {
      if (stream.aborted || isAbort(error)) {
        // Stopped, not failed: there is nobody left to read an error.
        stream.end();
      } else {
        const message =
          error instanceof BadRequestException
            ? (error.getResponse() as { message?: string })?.message || error.message
            : 'The turn failed before it finished.';
        // The traveler gets a sentence; the operator gets the stack. A failed
        // stream is invisible in the UI otherwise.
        this.logger.error(
          `Streamed turn failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
        );
        stream.fail(message);
      }
    } finally {
      this.events.off('browser.step', onBrowserStep);
      res.off('close', stop);
      stream.end();
    }
  }

  @Post('chat')
  @ApiOperation({ summary: 'Open or continue a chat and run one turn' })
  chat(
    @Req() req: Request,
    @CurrentUser() user: UserRecord,
    @Body(new ZodValidationPipe(chatSchema)) body: ChatInput,
  ) {
    this.refuseModelChoice(req);
    const model = this.models.best();
    this.checkTurnLimit(req, user, model);
    return this.gateway.handleIncoming(body, user.id, model);
  }

  @Post('sessions/:id/messages')
  @ApiOperation({ summary: 'Run a turn inside an existing chat' })
  message(
    @Req() req: Request,
    @CurrentUser() user: UserRecord,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(sendMessageSchema)) body: SendMessageInput,
  ) {
    this.refuseModelChoice(req);
    const model = this.models.best();
    this.checkTurnLimit(req, user, model);
    return this.gateway.handleIncoming(
      { content: body.content, attachments: body.attachments, sessionId: id },
      user.id,
      model,
    );
  }

  /**
   * The desk picks the model, for guests and for signed-in accounts alike, so a turn that
   * asks for one is refused rather than quietly answered by a different model. This is
   * deliberate until a picker exists; the request field is gone from the schemas with it.
   */
  private refuseModelChoice(req: Request): void {
    const picked = (req.body as { model?: unknown } | undefined)?.model;
    if (picked === undefined || picked === null) return;
    throw new BadRequestException({
      code: 'model_selection_unsupported',
      message:
        'The desk chooses its own model — the best one it has — for guests and for signed-in accounts alike.',
    });
  }

  private checkTurnLimit(req: Request, user: UserRecord, model: ModelRecord): void {
    // A model with no limit is not paced at all. That is the desk's own model today, which
    // runs here and costs nothing per turn — a traveler is stopped by a model's limit, never
    // by the desk itself. A limitation arrives with a model that has a bill behind it.
    const limits = model.limits;
    if (!limits) return;

    const tier = user.isGuest ? 'guest' : 'account';
    if (user.isGuest && !this.guestIpLimiter.consume(clientKey(req))) {
      // Same reasoning as the guest-minting cap in AuthController: a guest hitting a pace
      // limit is not being asked to sign in, and the copy should not imply it.
      throw rateLimited(
        `Guest chats from this address are paced at ${GUEST_IP_TURNS} turns every 10 minutes, across every model. Wait a few minutes, or sign in for a higher limit.`,
      );
    }
    if (this.limiterFor(tier, model.id, limits).consume(user.id)) return;

    const allowed = tier === 'guest' ? limits.guest : limits.account;
    // Name the model and the tier: a traveler who hits a pace should know which model ran
    // out and what would raise it, rather than reading a generic refusal.
    throw rateLimited(
      tier === 'guest'
        ? `Guest chats on ${model.label} are paced at ${allowed} turns every 10 minutes. Wait a few minutes, or sign in for a higher limit.`
        : `Chats on ${model.label} are paced at ${allowed} turns every 10 minutes. Wait a few minutes.`,
    );
  }

  private limiterFor(
    tier: 'guest' | 'account',
    modelId: string,
    limits: ModelLimits,
  ): RateLimiter {
    const key = `${tier}:${modelId}`;
    let limiter = this.turnLimiters.get(key);
    if (!limiter) {
      limiter = new RateLimiter(
        tier === 'guest' ? limits.guest : limits.account,
        TURN_WINDOW_MS,
      );
      this.turnLimiters.set(key, limiter);
    }
    return limiter;
  }
}

/** `browser_observe` reads better as "read the page" than as tool-shaped jargon. */
function describeBrowserAction(action: string): string {
  const name = action.replace(/^browser_/, '').replaceAll('_', ' ');
  if (name === 'observe') return 'read the page';
  if (name === 'choose source') return 'chose a source';
  return name;
}

function isAbort(error: unknown): boolean {
  return (
    (error instanceof Error &&
      (error.name === 'AbortError' || error.name === 'TimeoutError')) ||
    (typeof error === 'object' &&
      error !== null &&
      (error as { name?: string }).name === 'AbortError')
  );
}
