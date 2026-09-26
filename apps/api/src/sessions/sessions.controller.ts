import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createSessionSchema,
  type CreateSessionInput,
  type UserRecord,
} from '@travelclaw/shared';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-pipe';
import { SessionsService } from './sessions.service';

@ApiTags('sessions')
@Controller('api/sessions')
@UseGuards(AuthGuard)
export class SessionsController {
  constructor(private readonly sessions: SessionsService) {}

  @Get()
  @ApiOperation({ summary: "This account's recent chats" })
  list(@CurrentUser() user: UserRecord) {
    return this.sessions.list(user.id);
  }

  @Post()
  @ApiOperation({ summary: 'Open a chat. A new peer id keeps histories apart.' })
  open(
    @CurrentUser() user: UserRecord,
    @Body(new ZodValidationPipe(createSessionSchema)) body: CreateSessionInput,
  ) {
    return this.sessions.open(body, user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Chat plus transcript' })
  get(@CurrentUser() user: UserRecord, @Param('id') id: string) {
    return {
      session: this.sessions.get(id, user.id),
      messages: this.sessions.messages(id, user.id),
    };
  }
}
