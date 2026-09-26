import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { taskDecisionSchema, type TaskDecision, type UserRecord } from '@travelclaw/shared';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-pipe';
import { SessionsService } from '../sessions/sessions.service';
import { TasksService } from './tasks.service';

@ApiTags('tasks')
@Controller('api')
@UseGuards(AuthGuard)
export class TasksController {
  constructor(
    private readonly tasks: TasksService,
    private readonly sessions: SessionsService,
  ) {}

  @Get('sessions/:id/tasks')
  @ApiOperation({ summary: 'Flight and stay desks spun up for this chat' })
  list(@CurrentUser() user: UserRecord, @Param('id') id: string) {
    this.sessions.get(id, user.id); // 404s if this chat is not the caller's
    return this.tasks.forSession(id);
  }

  @Post('tasks/:id/decision')
  @ApiOperation({
    summary: 'Traveler answers a finished desk: complete, no, or still working',
  })
  async decide(
    @CurrentUser() user: UserRecord,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(taskDecisionSchema)) body: { decision: TaskDecision },
  ) {
    const sessionId = this.tasks.sessionIdFor(id);
    this.sessions.get(sessionId, user.id); // 404s if this chat is not the caller's
    return this.tasks.decide(id, body.decision);
  }
}
