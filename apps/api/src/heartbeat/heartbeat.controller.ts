import { Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { HeartbeatService } from './heartbeat.service';

@ApiTags('heartbeats')
@Controller('api/heartbeats')
export class HeartbeatController {
  constructor(private readonly heartbeats: HeartbeatService) {}

  @Get()
  @ApiOperation({ summary: 'Scheduled desk jobs' })
  list() {
    return this.heartbeats.list();
  }

  @Post(':id/run')
  @ApiOperation({ summary: 'Run one job now. NO_REPLY means nothing needed a note.' })
  run(@Param('id') id: string) {
    return this.heartbeats.run(id);
  }
}
