import { Module } from '@nestjs/common';
import { TripsModule } from '../trips/trips.module';
import { HeartbeatController } from './heartbeat.controller';
import { HeartbeatService } from './heartbeat.service';

@Module({
  imports: [TripsModule],
  controllers: [HeartbeatController],
  providers: [HeartbeatService],
  exports: [HeartbeatService],
})
export class HeartbeatModule {}
