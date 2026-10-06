import { Module } from '@nestjs/common';
import { AgentsModule } from '../agents/agents.module';
import { AuthModule } from '../auth/auth.module';
import { ConnectorsModule } from '../connectors/connectors.module';
import { MemoryModule } from '../memory/memory.module';
import { ModelsModule } from '../models/models.module';
import { SessionsModule } from '../sessions/sessions.module';
import { TasksModule } from '../tasks/tasks.module';
import { ToolsModule } from '../tools/tools.module';
import { TripsModule } from '../trips/trips.module';
import { WorkspaceModule } from '../workspace/workspace.module';
import { ChatController } from './chat.controller';
import { DeskGateway } from './desk.gateway';
import { GatewayService } from './gateway.service';
import { LiveTurnsService } from './live-turns.service';

@Module({
  imports: [
    AgentsModule,
    AuthModule,
    SessionsModule,
    MemoryModule,
    TripsModule,
    ToolsModule,
    TasksModule,
    WorkspaceModule,
    ModelsModule,
    ConnectorsModule,
  ],
  controllers: [ChatController],
  providers: [GatewayService, DeskGateway, LiveTurnsService],
  exports: [GatewayService, LiveTurnsService],
})
export class GatewayModule {}
