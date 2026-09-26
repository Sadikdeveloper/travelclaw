import {
  OnGatewayConnection,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { AuthService } from '../auth/auth.service';
import { parseCookies } from '../auth/tokens';
import { loadConfig } from '../config';
import { EventsService } from '../events/events.service';

interface ChatEventPayload {
  sessionId: string;
  messageId?: string;
  taskId?: string;
  userId: string | null;
}

@WebSocketGateway({ cors: { origin: true, credentials: true } })
export class DeskGateway implements OnGatewayInit, OnGatewayConnection {
  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly events: EventsService,
    private readonly auth: AuthService,
  ) {}

  afterInit() {
    // Chat events are per-account: only the room for that account's socket(s) hears them,
    // so one traveler's browser is never told a chat exists on another account.
    this.events.on('chat.completed', (payload) =>
      this.emitToOwner('chat.completed', payload as ChatEventPayload),
    );
    this.events.on('task.updated', (payload) =>
      this.emitToOwner('task.updated', payload as ChatEventPayload),
    );
    // Heartbeat is desk-wide (trips are not account-scoped yet), so it stays a broadcast.
    this.events.on('heartbeat', (payload) => this.server.emit('heartbeat', payload));
  }

  handleConnection(client: Socket) {
    const cookies = parseCookies(client.handshake.headers.cookie);
    const token = cookies[loadConfig().cookieName];
    const user = this.auth.verifyToken(token);
    if (user) client.join(roomFor(user.id));
    client.emit('presence', { ok: true, service: 'travelclaw-gateway' });
  }

  private emitToOwner(event: string, payload: ChatEventPayload) {
    if (!payload.userId) return;
    this.server.to(roomFor(payload.userId)).emit(event, payload);
  }
}

function roomFor(userId: string): string {
  return `user:${userId}`;
}
