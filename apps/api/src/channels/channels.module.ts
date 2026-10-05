import { Module } from '@nestjs/common';
import { GatewayModule } from '../gateway/gateway.module';
import { SessionsModule } from '../sessions/sessions.module';
import { ChannelsController } from './channels.controller';
import { ChannelsService } from './channels.service';
import { TelegramService } from './telegram/telegram.service';

@Module({
  imports: [GatewayModule, SessionsModule],
  controllers: [ChannelsController],
  providers: [ChannelsService, TelegramService],
  exports: [ChannelsService, TelegramService],
})
export class ChannelsModule {}
