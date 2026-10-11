import { Module } from '@nestjs/common';
import { ModelsModule } from '../models/models.module';
import { SessionsModule } from '../sessions/sessions.module';
import { BookingConfirmationService } from './confirmation.service';
import { BrowserService } from './browser.service';
@Module({
  imports: [ModelsModule, SessionsModule],
  providers: [BrowserService, BookingConfirmationService],
  exports: [BrowserService, BookingConfirmationService],
})
export class BrowserModule {}
