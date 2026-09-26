import { Body, Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  chatSchema,
  sendMessageSchema,
  type ChatInput,
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

/** Turns a guest may run from one address across all models. Aggregate, so it stays flat. */
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
    const model = this.models.resolve(body.model);
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
    const model = this.models.resolve(body.model);
    this.checkTurnLimit(req, user, model);
    return this.gateway.handleIncoming(
      { content: body.content, sessionId: id },
      user.id,
      model,
    );
  }

  private checkTurnLimit(req: Request, user: UserRecord, model: ModelRecord): void {
    const tier = user.isGuest ? 'guest' : 'account';
    if (user.isGuest && !this.guestIpLimiter.consume(clientKey(req))) {
      // Same reasoning as the guest-minting cap in AuthController: a guest hitting a pace
      // limit is not being asked to sign in, and the copy should not imply it.
      throw rateLimited(
        `Guest chats from this address are paced at ${GUEST_IP_TURNS} turns every 10 minutes, across every model. Wait a few minutes, or sign in for a higher limit.`,
      );
    }
    if (this.limiterFor(tier, model).consume(user.id)) return;

    const allowed = tier === 'guest' ? model.limits.guest : model.limits.account;
    // Name the model and the tier: a traveler who hits a pace should know which model ran
    // out and what would raise it, rather than reading a generic refusal.
    throw rateLimited(
      tier === 'guest'
        ? `Guest chats on ${model.label} are paced at ${allowed} turns every 10 minutes. Wait a few minutes, sign in for a higher limit, or switch to another model.`
        : `Chats on ${model.label} are paced at ${allowed} turns every 10 minutes. Wait a few minutes, or switch to another model.`,
    );
  }

  private limiterFor(tier: 'guest' | 'account', model: ModelRecord): RateLimiter {
    const key = `${tier}:${model.id}`;
    let limiter = this.turnLimiters.get(key);
    if (!limiter) {
      limiter = new RateLimiter(
        tier === 'guest' ? model.limits.guest : model.limits.account,
        TURN_WINDOW_MS,
      );
      this.turnLimiters.set(key, limiter);
    }
    return limiter;
  }
}
