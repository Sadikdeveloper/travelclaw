import {
  OnGatewayConnection,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { AuthService } from '../auth/auth.service';
import {
  PAIRING_REQUIRED_MESSAGE,
  PAIRING_REQUIRED_MESSAGE_NO_TOKEN,
  isLoopback,
  pairingNotConfigured,
  socketAuthorized,
} from '../auth/pairing';
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

    // Pairing gate as a socket.io Namespace middleware: rejects during the handshake so the
    // client gets connect_error instead of firing connect then immediately disconnecting.
    this.server.use((client, next) => {
      const remote = socketRemoteIp(client);
      if (isLoopback(remote)) return next();
      if (pairingNotConfigured()) {
        return next(new Error(PAIRING_REQUIRED_MESSAGE_NO_TOKEN));
      }
      if (!socketAuthorized(client)) {
        return next(new Error(PAIRING_REQUIRED_MESSAGE));
      }
      next();
    });
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

/**
 * Best-guess remote IP for a socket handshaking. When trust-proxy is on, honours the
 * leftmost X-Forwarded-For; otherwise falls back to the engine.io address.
 */
function socketRemoteIp(socket: Socket): string | undefined {
  const cfg = loadConfig();
  if (cfg.trustProxy) {
    const ff = socket.handshake.headers['x-forwarded-for'];
    const first = Array.isArray(ff) ? ff[0] : ff;
    if (first) return first.split(',')[0]?.trim() || undefined;
  }
  // engine.io attaches the real remoteAddress to the underlying conn.
  const addr = (socket.conn as { remoteAddress?: string } | undefined)?.remoteAddress;
  return addr;
}
