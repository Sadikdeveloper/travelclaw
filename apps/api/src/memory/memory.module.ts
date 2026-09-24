import { Module } from '@nestjs/common';
import { AgentsModule } from '../agents/agents.module';
import { WorkspaceModule } from '../workspace/workspace.module';
import { MemoryController } from './memory.controller';
import { MemoryService } from './memory.service';

@Module({
  imports: [AgentsModule, WorkspaceModule],
  controllers: [MemoryController],
  providers: [MemoryService],
  exports: [MemoryService],
})
export class MemoryModule {}
