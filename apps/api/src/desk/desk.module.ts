import { Module } from '@nestjs/common';
import { AgentsModule } from '../agents/agents.module';
import { ChannelsModule } from '../channels/channels.module';
import { HealthModule } from '../health/health.module';
import { HeartbeatModule } from '../heartbeat/heartbeat.module';
import { MemoryModule } from '../memory/memory.module';
import { SessionsModule } from '../sessions/sessions.module';
import { SkillsModule } from '../skills/skills.module';
import { TripsModule } from '../trips/trips.module';
import { DeskController } from './desk.controller';

@Module({
  imports: [
    HealthModule,
    AgentsModule,
    TripsModule,
    SessionsModule,
    HeartbeatModule,
    SkillsModule,
    ChannelsModule,
    MemoryModule,
  ],
  controllers: [DeskController],
})
export class DeskModule {}
