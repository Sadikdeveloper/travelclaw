import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { createSessionSchema, type CreateSessionInput } from '@travelclaw/shared';
import { ZodValidationPipe } from '../common/zod-pipe';
import { SessionsService } from './sessions.service';

@ApiTags('sessions')
@Controller('api/sessions')
export class SessionsController {
  constructor(private readonly sessions: SessionsService) {}

  @Get()
  @ApiOperation({ summary: 'Recent sessions' })
  list() {
    return this.sessions.list();
  }

  @Post()
  @ApiOperation({ summary: 'Open a session. A new peer id keeps histories apart.' })
  open(@Body(new ZodValidationPipe(createSessionSchema)) body: CreateSessionInput) {
    return this.sessions.open(body);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Session plus transcript' })
  get(@Param('id') id: string) {
    return { session: this.sessions.get(id), messages: this.sessions.messages(id) };
  }
}
