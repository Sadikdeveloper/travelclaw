import {
  OnGatewayConnection,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { EventsService } from '../events/events.service';

@WebSocketGateway({ cors: { origin: true, credentials: true } })
export class DeskGateway implements OnGatewayInit, OnGatewayConnection {
  @WebSocketServer()
  server!: Server;

  constructor(private readonly events: EventsService) {}

  afterInit() {
    this.events.on('chat.completed', (payload) =>
      this.server.emit('chat.completed', payload),
    );
    this.events.on('task.updated', (payload) => this.server.emit('task.updated', payload));
    this.events.on('heartbeat', (payload) => this.server.emit('heartbeat', payload));
  }

  handleConnection(client: Socket) {
    client.emit('presence', { ok: true, service: 'travelclaw-gateway' });
  }
}
