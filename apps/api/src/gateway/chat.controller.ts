import { Body, Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  chatSchema,
  sendMessageSchema,
  type ChatInput,
  type SendMessageInput,
  type UserRecord,
} from '@travelclaw/shared';
import type { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RateLimiter } from '../auth/rate-limiter';
import { clientKey, rateLimited } from '../common/rate-limit';
import { ZodValidationPipe } from '../common/zod-pipe';
import { GatewayService } from './gateway.service';

@ApiTags('chat')
@Controller('api')
@UseGuards(AuthGuard)
export class ChatController {
  /** A real, signed-up account faced real friction to exist. Generous but not unlimited. */
  private readonly accountLimiter = new RateLimiter(60, 10 * 60 * 1000);
  /** A guest costs nothing to create, so a turn (an LLM call) is capped much tighter. */
  private readonly guestLimiter = new RateLimiter(15, 10 * 60 * 1000);
  /** Blunts "hit the guest limit, mint a new guest" — this one is keyed by IP, not account. */
  private readonly guestIpLimiter = new RateLimiter(30, 10 * 60 * 1000);

  constructor(private readonly gateway: GatewayService) {}

  @Post('chat')
  @ApiOperation({ summary: 'Open or continue a chat and run one turn' })
  chat(
    @Req() req: Request,
    @CurrentUser() user: UserRecord,
    @Body(new ZodValidationPipe(chatSchema)) body: ChatInput,
  ) {
    this.checkTurnLimit(req, user);
    return this.gateway.handleIncoming(body, user.id);
  }

  @Post('sessions/:id/messages')
  @ApiOperation({ summary: 'Run a turn inside an existing chat' })
  message(
    @Req() req: Request,
    @CurrentUser() user: UserRecord,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(sendMessageSchema)) body: SendMessageInput,
  ) {
    this.checkTurnLimit(req, user);
    return this.gateway.handleIncoming({ content: body.content, sessionId: id }, user.id);
  }

  private checkTurnLimit(req: Request, user: UserRecord): void {
    if (user.isGuest) {
      if (
        !this.guestIpLimiter.consume(clientKey(req)) ||
        !this.guestLimiter.consume(user.id)
      ) {
        // Same reasoning as the guest-minting cap in AuthController: a guest hitting a
        // pace limit is not being asked to sign in, and the copy should not imply it.
        throw rateLimited(
          'Guest chats are paced at 15 turns every 10 minutes. Wait a few minutes, or sign in for a higher limit.',
        );
      }
      return;
    }
    if (!this.accountLimiter.consume(user.id)) {
      throw rateLimited();
    }
  }
}
