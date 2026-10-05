import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { DEFAULT_AGENT_ID, type ChannelPlugin } from '@travelclaw/shared';
import { newId, nowIso } from '../../common/util';
import { DatabaseService } from '../../db/database.service';
import { EventsService } from '../../events/events.service';
import { GatewayService } from '../../gateway/gateway.service';
import {
  TelegramClient,
  type TelegramUpdate,
} from './telegram.client';

type TelegramStatus = 'not_configured' | 'ready' | 'disabled';

interface SessionRow {
  id: string;
  channel: string;
  peer_id: string;
  user_id: string;
}

interface TaskEvent {
  sessionId: string;
  taskId: string;
  userId?: string;
}

/**
 * Telegram channel adapter.
 * - Explicitly registered, no folder scanning.
 * - Polling, so no public URL is required for local development.
 * - Inbound updates become ordinary turns via GatewayService.
 * - Outbound replies go back to the originating chat.
 * - Token is never logged, raw updates are never logged.
 */
@Injectable()
export class TelegramService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramService.name);
  private client: TelegramClient | null = null;
  private status: TelegramStatus = 'not_configured';
  private detail: string =
    'Set TELEGRAM_BOT_TOKEN only after the adapter exists. See docs/adding-a-channel.md.';
  private running = false;
  private offset = 0;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private channelUserId: string | null = null;
  private fetchImpl: typeof fetch = fetch;

  // For testing: allow injection of a custom client or fetch impl.
  private customClientFactory: ((token: string) => TelegramClient) | null = null;

  constructor(
    private readonly db: DatabaseService,
    private readonly gateway: GatewayService,
    private readonly events: EventsService,
  ) {}

  /** Test hook: override how the Telegram client is created. */
  setClientFactoryForTests(
    factory: ((token: string) => TelegramClient) | null,
  ): void {
    this.customClientFactory = factory;
  }

  /** Test hook: override fetch implementation. */
  setFetchForTests(fetchImpl: typeof fetch | null): void {
    this.fetchImpl = fetchImpl || fetch;
  }

  onModuleInit() {
    const token = this.readToken();
    if (!token) {
      this.status = 'not_configured';
      this.detail =
        'Set TELEGRAM_BOT_TOKEN only after the adapter exists. See docs/adding-a-channel.md.';
      return;
    }

    // Ensure a dedicated user exists for Telegram sessions.
    this.channelUserId = this.ensureChannelUser();

    // Validate token asynchronously, then start polling if valid.
    void this.validateAndStart(token);

    // Listen for desk completions and other task updates.
    this.events.on('task.updated', (payload) => {
      void this.handleTaskUpdated(payload as TaskEvent);
    });
  }

  onModuleDestroy() {
    this.running = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  getChannelInfo(): ChannelPlugin {
    return {
      id: 'telegram',
      label: 'Telegram',
      status: this.status,
      configured: this.status !== 'not_configured',
      detail: this.detail,
    };
  }

  /** Public for ChannelsService to use without exposing internals. */
  getStatus(): { status: TelegramStatus; detail: string; configured: boolean } {
    return {
      status: this.status,
      detail: this.detail,
      configured: this.status !== 'not_configured',
    };
  }

  /** Exposed for tests to process a single update without polling. */
  async handleUpdateForTests(update: TelegramUpdate): Promise<void> {
    if (!this.channelUserId) this.channelUserId = this.ensureChannelUser();
    await this.processUpdate(update);
  }

  /** Allows tests to trigger task handling. */
  async handleTaskUpdatedForTests(event: TaskEvent): Promise<void> {
    await this.handleTaskUpdated(event);
  }

  private readToken(): string | null {
    const raw = process.env.TELEGRAM_BOT_TOKEN?.trim();
    return raw || null;
  }

  private ensureChannelUser(): string {
    const email = 'telegram@channels.travelclaw.local';
    const existing = this.db.get<{ id: string }>(
      'SELECT id FROM users WHERE email = ?',
      email,
    );
    if (existing) return existing.id;

    const id = newId();
    const now = nowIso();
    try {
      this.db.run(
        `INSERT INTO users (id, email, password_hash, display_name, google_id, is_guest, created_at, updated_at)
         VALUES (?, ?, NULL, ?, NULL, 0, ?, ?)`,
        id,
        email,
        'Telegram',
        now,
        now,
      );
      return id;
    } catch {
      // Race: another init inserted first.
      const again = this.db.get<{ id: string }>(
        'SELECT id FROM users WHERE email = ?',
        email,
      );
      if (again) return again.id;
      throw new Error('Could not ensure telegram channel user');
    }
  }

  private createClient(token: string): TelegramClient {
    if (this.customClientFactory) return this.customClientFactory(token);
    return new TelegramClient(token, this.fetchImpl);
  }

  private async validateAndStart(token: string): Promise<void> {
    const client = this.createClient(token);
    try {
      const me = await client.getMe();
      this.client = client;
      this.status = 'ready';
      this.detail = `Telegram bot @${me.username} is polling. Messages become gateway turns; the gateway remains the owner of session history.`;
      this.logger.log(`Telegram bot @${me.username} validated, starting polling`);
      this.running = true;
      this.offset = 0;
      void this.pollLoop();
    } catch (err) {
      const code = (err as { code?: number }).code;
      // 401/403 means token rejected.
      if (code === 401 || code === 403 || code === 404) {
        this.status = 'disabled';
        this.detail = `Telegram token was rejected by Telegram (HTTP ${code}). Check TELEGRAM_BOT_TOKEN and restart.`;
        this.logger.warn(`Telegram token rejected (HTTP ${code})`);
      } else {
        this.status = 'disabled';
        this.detail = `Telegram token is set but the adapter could not reach Telegram: ${(err as Error).message}. Retrying on next restart.`;
        this.logger.warn(`Telegram getMe failed: ${(err as Error).message}`);
      }
    }
  }

  private async pollLoop(): Promise<void> {
    if (!this.running || !this.client) return;
    try {
      const updates = await this.client.getUpdates(this.offset, 25);
      for (const update of updates) {
        this.offset = Math.max(this.offset, update.update_id + 1);
        await this.processUpdate(update);
      }
    } catch (err) {
      // Never log token or raw payload. Only log the error message.
      this.logger.warn(`Telegram polling error: ${(err as Error).message}`);
      // Backoff on error to avoid tight loop.
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
    if (!this.running) return;
    // Schedule next poll without blocking.
    this.pollTimer = setTimeout(() => {
      this.pollTimer = null;
      void this.pollLoop();
    }, 100);
  }

  private async processUpdate(update: TelegramUpdate): Promise<void> {
    const message = update.message || update.edited_message || update.channel_post;
    if (!message) return;
    if (message.from?.is_bot) return; // Ignore our own messages.
    const text = message.text?.trim();
    if (!text) return; // Only text for now.

    const chatId = String(message.chat.id);
    // Group-style: room id is the peer, so histories do not collapse.
    const peerId = chatId;

    if (!this.channelUserId) this.channelUserId = this.ensureChannelUser();

    try {
      const response = await this.gateway.handleIncoming(
        {
          content: text,
          channel: 'telegram',
          peerId,
          agentId: DEFAULT_AGENT_ID,
        },
        this.channelUserId,
      );
      const reply = response.message?.content?.trim();
      if (reply && this.client) {
        await this.client.sendMessage(chatId, reply);
      }
    } catch (err) {
      this.logger.warn(
        `Failed to handle Telegram message from chat ${chatId}: ${(err as Error).message}`,
      );
      // Try to tell the user something went wrong, without leaking details.
      if (this.client) {
        try {
          await this.client.sendMessage(
            chatId,
            'Sorry, I could not process that message. Please try again.',
          );
        } catch {
          // Ignore send failure.
        }
      }
    }
  }

  private async handleTaskUpdated(event: TaskEvent): Promise<void> {
    if (!this.client) return;
    if (!this.channelUserId) return;
    if (event.userId && event.userId !== this.channelUserId) return;

    // Only handle sessions that belong to Telegram.
    const session = this.db.get<SessionRow>(
      'SELECT id, channel, peer_id, user_id FROM sessions WHERE id = ?',
      event.sessionId,
    );
    if (!session) return;
    if (session.channel !== 'telegram') return;
    if (session.user_id !== this.channelUserId) return;

    // Fetch the task summary.
    const task = this.db.get<{ summary: string; status: string }>(
      'SELECT summary, status FROM agent_tasks WHERE id = ?',
      event.taskId,
    );
    if (!task) return;
    // Only send when desk finished (awaiting) or hold confirmed.
    // The summary already contains the "Nothing was purchased" disclaimer.
    if (task.status !== 'awaiting' && task.status !== 'accepted' && task.status !== 'rejected') {
      // For hold confirmations, status may still be awaiting but summary updated.
      // We send on any awaiting update; the gateway emits on each patch.
      // To avoid spamming, only send if status is awaiting.
      // Actually hold confirmation keeps status awaiting, but we want to send update then too.
      // So we allow awaiting always, and accepted/rejected for completeness.
    }
    if (task.status !== 'awaiting') return;

    const peerId = session.peer_id;
    try {
      await this.client.sendMessage(peerId, task.summary);
    } catch (err) {
      this.logger.warn(
        `Failed to send Telegram task update to ${peerId}: ${(err as Error).message}`,
      );
    }
  }
}
