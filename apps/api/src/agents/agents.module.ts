import { Module } from '@nestjs/common';
import { WorkspaceModule } from '../workspace/workspace.module';
import { AgentsController } from './agents.controller';
import { AgentsService } from './agents.service';

@Module({
  imports: [WorkspaceModule],
  controllers: [AgentsController],
  providers: [AgentsService],
  exports: [AgentsService],
})
export class AgentsModule {}
