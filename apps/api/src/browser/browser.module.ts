import { Module } from '@nestjs/common';
import { ModelsModule } from '../models/models.module';
import { SessionsModule } from '../sessions/sessions.module';
import { BrowserService } from './browser.service';
@Module({
  imports: [ModelsModule, SessionsModule],
  providers: [BrowserService],
  exports: [BrowserService],
})
export class BrowserModule {}
