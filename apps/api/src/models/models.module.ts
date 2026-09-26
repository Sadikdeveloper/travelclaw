import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ModelService } from './model.service';
import { ModelsController } from './models.controller';

@Module({
  imports: [AuthModule],
  controllers: [ModelsController],
  providers: [ModelService],
  exports: [ModelService],
})
export class ModelsModule {}
