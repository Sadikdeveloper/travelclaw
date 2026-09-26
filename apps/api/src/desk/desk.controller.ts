import { Controller, Get, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { DeskSnapshot } from '@travelclaw/shared';
import type { Request } from 'express';
import { AgentsService } from '../agents/agents.service';
import { AuthService } from '../auth/auth.service';
import { readUser } from '../auth/auth.guard';
import { ChannelsService } from '../channels/channels.service';
import { HealthService } from '../health/health.service';
import { HeartbeatService } from '../heartbeat/heartbeat.service';
import { MemoryService } from '../memory/memory.service';
import { SessionsService } from '../sessions/sessions.service';
import { ToolsService } from '../tools/tools.service';
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
    private readonly tools: ToolsService,
    private readonly channels: ChannelsService,
    private readonly memory: MemoryService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'One payload for the control UI home' })
  snapshot(@Req() req: Request): DeskSnapshot {
    // Public snapshot (desk-wide trips, tools, channels); chats are only listed when
    // the caller is signed in, and only that account's chats.
    const user = readUser(req, this.auth);
    return {
      health: this.health.report(),
      agent: this.agents.defaultAgent(),
      trips: this.trips.list(),
      sessions: user ? this.sessions.list(user.id) : [],
      heartbeats: this.heartbeats.list(),
      tools: this.tools.list(),
      channels: this.channels.list(),
      memoryCount: this.memory.list().length,
    };
  }
}
