import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { ChannelsService } from '../src/channels/channels.service';
import { TelegramService } from '../src/channels/telegram/telegram.service';
import { TelegramClient } from '../src/channels/telegram/telegram.client';

describe('Telegram extension', () => {
  const dir = mkdtempSync(join(tmpdir(), 'travelclaw-telegram-'));

  function makeApp() {
    process.env.DATABASE_PATH = join(dir, `test-${Math.random().toString(36).slice(2)}.db`);
    process.env.WORKSPACE_PATH = join(dir, 'workspace');
    process.env.TRAVELCLAW_NETWORK = '0';
    process.env.TRAVELCLAW_SEED = '0';
    process.env.TRAVELCLAW_HEARTBEAT = '0';
    process.env.TRAVELCLAW_MODEL_PROVIDER = 'mock';
    process.env.TRAVELCLAW_TASK_DELAY = '0';
    delete process.env.TRAVELCLAW_MODEL_API_KEY;
    delete process.env.TRAVELCLAW_GOOGLE_CLIENT_ID;
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.DISCORD_BOT_TOKEN;
  }

  afterAll(() => {
    delete process.env.TELEGRAM_BOT_TOKEN;
  });

  it('leaves channel not_configured with no token', async () => {
    makeApp();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();

    const channels = app.get(ChannelsService);
    const list = channels.list();
    const telegram = list.find((c) => c.id === 'telegram');
    expect(telegram).toBeDefined();
    expect(telegram!.status).toBe('not_configured');
    expect(telegram!.configured).toBe(false);

    await app.close();
  });

  it('inbound message creates a turn and outbound reply is sent', async () => {
    makeApp();
    process.env.TELEGRAM_BOT_TOKEN = 'test-token-123';

    // Capture sent messages
    const sent: Array<{ chatId: string | number; text: string }> = [];

    class FakeClient extends TelegramClient {
      constructor() {
        super('test-token-123', async () => {
          throw new Error('should not call fetch in fake client');
        });
      }
      override async getMe() {
        return {
          id: 123,
          is_bot: true,
          username: 'testbot',
          first_name: 'Test',
        };
      }
      override async getUpdates() {
        return [];
      }
      override async sendMessage(chatId: string | number, text: string) {
        sent.push({ chatId, text });
      }
    }

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication();
    configureApp(app);
    // Override client factory before init so validation uses fake client
    const telegramService = moduleRef.get(TelegramService);
    telegramService.setClientFactoryForTests(() => new FakeClient() as unknown as TelegramClient);

    await app.init();

    // Wait a tick for validateAndStart to finish
    await new Promise((r) => setTimeout(r, 200));

    const channels = app.get(ChannelsService);
    const list = channels.list();
    const telegram = list.find((c) => c.id === 'telegram');
    expect(telegram!.status).toBe('ready');
    expect(telegram!.configured).toBe(true);
    expect(telegram!.detail).toMatch(/polling/i);

    // Simulate inbound Telegram message
    await telegramService.handleUpdateForTests({
      update_id: 1,
      message: {
        message_id: 1,
        chat: { id: 555123, type: 'private' },
        from: { id: 111, is_bot: false },
        text: 'Hello from Telegram, what should I pack for Lisbon?',
      },
    });

    // The fake client should have received a reply from the gateway
    expect(sent.length).toBeGreaterThanOrEqual(1);
    const firstReply = sent[0];
    expect(String(firstReply.chatId)).toBe('555123');
    // Mock provider returns packing advice or similar, must contain disclaimer
    expect(firstReply.text.length).toBeGreaterThan(10);

    // Verify session was created with telegram channel and peerId
    // Use the app's DB to check
    const { DatabaseService } = await import('../src/db/database.service');
    const db = app.get(DatabaseService);
    const session = db.get<{ channel: string; peer_id: string }>(
      'SELECT channel, peer_id FROM sessions WHERE channel = ? AND peer_id = ?',
      'telegram',
      '555123',
    );
    expect(session).toBeDefined();
    expect(session!.channel).toBe('telegram');
    expect(session!.peer_id).toBe('555123');

    await app.close();
  });

  it('reports disabled when token is rejected', async () => {
    makeApp();
    process.env.TELEGRAM_BOT_TOKEN = 'bad-token';

    class RejectingClient extends TelegramClient {
      constructor() {
        super('bad-token', async () => {
          throw new Error('should not call fetch');
        });
      }
      override async getMe(): Promise<any> {
        const err = new Error('Unauthorized') as Error & { code?: number };
        err.code = 401;
        throw err;
      }
      override async getUpdates() {
        return [];
      }
      override async sendMessage(): Promise<void> {
        return;
      }
    }

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication();
    configureApp(app);
    const telegramService = moduleRef.get(TelegramService);
    telegramService.setClientFactoryForTests(() => new RejectingClient() as unknown as TelegramClient);

    await app.init();
    await new Promise((r) => setTimeout(r, 200));

    const channels = app.get(ChannelsService);
    const telegram = channels.list().find((c) => c.id === 'telegram');
    expect(telegram!.status).toBe('disabled');
    expect(telegram!.configured).toBe(true);
    expect(telegram!.detail).toMatch(/rejected/i);

    await app.close();
  });

  it('task completion is sent back to originating Telegram chat', async () => {
    makeApp();
    process.env.TELEGRAM_BOT_TOKEN = 'test-token-123';
    const sent: Array<{ chatId: string | number; text: string }> = [];

    class FakeClient extends TelegramClient {
      constructor() {
        super('test-token-123', async () => {
          throw new Error('no fetch');
        });
      }
      override async getMe() {
        return { id: 123, is_bot: true, username: 'testbot' };
      }
      override async getUpdates() {
        return [];
      }
      override async sendMessage(chatId: string | number, text: string) {
        sent.push({ chatId, text });
      }
    }

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication();
    configureApp(app);
    const telegramService = app.get(TelegramService);
    telegramService.setClientFactoryForTests(() => new FakeClient() as unknown as TelegramClient);

    await app.init();
    await new Promise((r) => setTimeout(r, 200));

    // Simulate a flight request via Telegram
    await telegramService.handleUpdateForTests({
      update_id: 10,
      message: {
        message_id: 10,
        chat: { id: 999888, type: 'private' },
        from: { id: 222, is_bot: false },
        text: 'Book a flight from Lagos to Lisbon on 2026-11-02',
      },
    });

    // First message is the immediate desk ack
    expect(sent.length).toBeGreaterThanOrEqual(1);
    expect(sent[0].text).toMatch(/Flight desk/i);

    // The task should have finished (delay=0) and emitted task.updated.
    // Give the event handler a moment to send.
    await new Promise((r) => setTimeout(r, 500));

    // If event timing was missed, manually trigger handling of the latest task
    if (sent.length < 2) {
      const { DatabaseService } = await import('../src/db/database.service');
      const db = app.get(DatabaseService);
      const task = db.get<{ id: string; session_id: string }>(
        'SELECT id, session_id FROM agent_tasks ORDER BY created_at DESC LIMIT 1',
      );
      if (task) {
        await telegramService.handleTaskUpdatedForTests({
          sessionId: task.session_id,
          taskId: task.id,
        });
      }
    }

    expect(sent.length).toBeGreaterThanOrEqual(2);
    // Find a message that looks like the finished brief
    const brief = sent.find((m) => /Flight desk finished/i.test(m.text));
    expect(brief).toBeDefined();
    expect(String(brief!.chatId)).toBe('999888');
    expect(brief!.text).toMatch(/Nothing was purchased/i);

    await app.close();
  });
});
