import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { taskDecisionSchema, type TaskDecision } from '@travelclaw/shared';
import { ZodValidationPipe } from '../common/zod-pipe';
import { TasksService } from './tasks.service';

@ApiTags('tasks')
@Controller('api')
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get('sessions/:id/tasks')
  @ApiOperation({ summary: 'Flight and stay desks spun up for this chat' })
  list(@Param('id') id: string) {
    return this.tasks.forSession(id);
  }

  @Post('tasks/:id/decision')
  @ApiOperation({
    summary: 'Traveler answers a finished desk: complete, no, or still working',
  })
  async decide(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(taskDecisionSchema)) body: { decision: TaskDecision },
  ) {
    return this.tasks.decide(id, body.decision);
  }
}
