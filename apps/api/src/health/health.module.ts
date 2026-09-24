import { Module } from '@nestjs/common';
import { ModelsModule } from '../models/models.module';
import { WorkspaceModule } from '../workspace/workspace.module';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  imports: [WorkspaceModule, ModelsModule],
  controllers: [HealthController],
  providers: [HealthService],
  exports: [HealthService],
})
export class HealthModule {}
