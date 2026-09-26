import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  chatSchema,
  sendMessageSchema,
  type ChatInput,
  type SendMessageInput,
  type UserRecord,
} from '@travelclaw/shared';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-pipe';
import { GatewayService } from './gateway.service';

@ApiTags('chat')
@Controller('api')
@UseGuards(AuthGuard)
export class ChatController {
  constructor(private readonly gateway: GatewayService) {}

  @Post('chat')
  @ApiOperation({ summary: 'Open or continue a chat and run one turn' })
  chat(
    @CurrentUser() user: UserRecord,
    @Body(new ZodValidationPipe(chatSchema)) body: ChatInput,
  ) {
    return this.gateway.handleIncoming(body, user.id);
  }

  @Post('sessions/:id/messages')
  @ApiOperation({ summary: 'Run a turn inside an existing chat' })
  message(
    @CurrentUser() user: UserRecord,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(sendMessageSchema)) body: SendMessageInput,
  ) {
    return this.gateway.handleIncoming({ content: body.content, sessionId: id }, user.id);
  }
}
