import {
  BadRequestException,
  Body,
  Controller,
  Param,
  Post,
  Req,
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
import type { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RateLimiter } from '../auth/rate-limiter';
import { clientKey, rateLimited } from '../common/rate-limit';
import { ZodValidationPipe } from '../common/zod-pipe';
import { TURN_WINDOW_MS } from '../models/model-catalog';
import { ModelService } from '../models/model.service';
import { GatewayService } from './gateway.service';

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

  constructor(
    private readonly gateway: GatewayService,
    private readonly models: ModelService,
  ) {}

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
