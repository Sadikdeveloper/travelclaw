import { Body, Controller, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  chatSchema,
  sendMessageSchema,
  type ChatInput,
  type SendMessageInput,
} from '@travelclaw/shared';
import { ZodValidationPipe } from '../common/zod-pipe';
import { GatewayService } from './gateway.service';

@ApiTags('chat')
@Controller('api')
export class ChatController {
  constructor(private readonly gateway: GatewayService) {}

  @Post('chat')
  @ApiOperation({ summary: 'Open or continue a session and run one turn' })
  chat(@Body(new ZodValidationPipe(chatSchema)) body: ChatInput) {
    return this.gateway.handleIncoming(body);
  }

  @Post('sessions/:id/messages')
  @ApiOperation({ summary: 'Run a turn inside an existing session' })
  message(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(sendMessageSchema)) body: SendMessageInput,
  ) {
    return this.gateway.handleIncoming({ content: body.content, sessionId: id });
  }
}
