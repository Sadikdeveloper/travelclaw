import { BrowserModule } from '../browser/browser.module';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ConnectorsModule } from '../connectors/connectors.module';
import { SessionsModule } from '../sessions/sessions.module';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

@Module({
  imports: [AuthModule, SessionsModule, ConnectorsModule, BrowserModule],
  controllers: [TasksController],
  providers: [TasksService],
  exports: [TasksService],
})
export class TasksModule {}
