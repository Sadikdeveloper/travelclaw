import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AgentsModule } from './agents/agents.module';
import { AuthModule } from './auth/auth.module';
import { PairingMiddleware } from './auth/pairing.middleware';
import { ChannelsModule } from './channels/channels.module';
import { ConnectorsModule } from './connectors/connectors.module';
import { DatabaseModule } from './db/database.module';
import { DeskModule } from './desk/desk.module';
import { EventsModule } from './events/events.module';
import { GatewayModule } from './gateway/gateway.module';
import { HealthModule } from './health/health.module';
import { HeartbeatModule } from './heartbeat/heartbeat.module';
import { MemoryModule } from './memory/memory.module';
import { ModelsModule } from './models/models.module';
import { SessionsModule } from './sessions/sessions.module';
import { TasksModule } from './tasks/tasks.module';
import { ToolsModule } from './tools/tools.module';
import { TripsModule } from './trips/trips.module';
import { WorkspaceModule } from './workspace/workspace.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    DatabaseModule,
    AuthModule,
    EventsModule,
    WorkspaceModule,
    AgentsModule,
    MemoryModule,
    SessionsModule,
    TripsModule,
    ToolsModule,
    TasksModule,
    ChannelsModule,
    ConnectorsModule,
    ModelsModule,
    HeartbeatModule,
    GatewayModule,
    HealthModule,
    DeskModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Pairing gate runs for every HTTP route except /health (which the middleware
    // exempts internally). WebSocket is enforced separately in DeskGateway because
    // Socket.io connections do not flow through Express middleware.
    consumer.apply(PairingMiddleware).forRoutes('*');
  }
}
