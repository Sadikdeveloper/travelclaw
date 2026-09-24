import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AgentsModule } from './agents/agents.module';
import { ChannelsModule } from './channels/channels.module';
import { DatabaseModule } from './db/database.module';
import { DeskModule } from './desk/desk.module';
import { EventsModule } from './events/events.module';
import { GatewayModule } from './gateway/gateway.module';
import { HealthModule } from './health/health.module';
import { HeartbeatModule } from './heartbeat/heartbeat.module';
import { MemoryModule } from './memory/memory.module';
import { ModelsModule } from './models/models.module';
import { SessionsModule } from './sessions/sessions.module';
import { SkillsModule } from './skills/skills.module';
import { TripsModule } from './trips/trips.module';
import { WorkspaceModule } from './workspace/workspace.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    DatabaseModule,
    EventsModule,
    WorkspaceModule,
    AgentsModule,
    MemoryModule,
    SessionsModule,
    TripsModule,
    SkillsModule,
    ChannelsModule,
    ModelsModule,
    HeartbeatModule,
    GatewayModule,
    HealthModule,
    DeskModule,
  ],
})
export class AppModule {}
