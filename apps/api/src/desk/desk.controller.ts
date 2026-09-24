import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { DeskSnapshot } from '@travelclaw/shared';
import { AgentsService } from '../agents/agents.service';
import { ChannelsService } from '../channels/channels.service';
import { HealthService } from '../health/health.service';
import { HeartbeatService } from '../heartbeat/heartbeat.service';
import { MemoryService } from '../memory/memory.service';
import { SessionsService } from '../sessions/sessions.service';
import { SkillsService } from '../skills/skills.service';
import { TripsService } from '../trips/trips.service';

@ApiTags('desk')
@Controller('api/desk')
export class DeskController {
  constructor(
    private readonly health: HealthService,
    private readonly agents: AgentsService,
    private readonly trips: TripsService,
    private readonly sessions: SessionsService,
    private readonly heartbeats: HeartbeatService,
    private readonly skills: SkillsService,
    private readonly channels: ChannelsService,
    private readonly memory: MemoryService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'One payload for the control UI home' })
  snapshot(): DeskSnapshot {
    return {
      health: this.health.report(),
      agent: this.agents.defaultAgent(),
      trips: this.trips.list(),
      sessions: this.sessions.list(),
      heartbeats: this.heartbeats.list(),
      skills: this.skills.list(),
      channels: this.channels.list(),
      memoryCount: this.memory.list().length,
    };
  }
}
