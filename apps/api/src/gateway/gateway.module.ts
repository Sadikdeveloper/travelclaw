import { Module } from '@nestjs/common';
import { AgentsModule } from '../agents/agents.module';
import { MemoryModule } from '../memory/memory.module';
import { ModelsModule } from '../models/models.module';
import { SessionsModule } from '../sessions/sessions.module';
import { SkillsModule } from '../skills/skills.module';
import { TripsModule } from '../trips/trips.module';
import { WorkspaceModule } from '../workspace/workspace.module';
import { ChatController } from './chat.controller';
import { DeskGateway } from './desk.gateway';
import { GatewayService } from './gateway.service';

@Module({
  imports: [AgentsModule, SessionsModule, MemoryModule, TripsModule, SkillsModule, WorkspaceModule, ModelsModule],
  controllers: [ChatController],
  providers: [GatewayService, DeskGateway],
  exports: [GatewayService],
})
export class GatewayModule {}
