/**
 * Minimal Telegram Bot API client.
 * No token is ever logged, and raw update payloads are not logged either.
 */

export interface TelegramChat {
  id: number;
  type: string;
}

export interface TelegramUser {
  id: number;
  is_bot: boolean;
  username?: string;
}

export interface TelegramMessage {
  message_id: number;
  chat: TelegramChat;
  from?: TelegramUser;
  text?: string;
  date?: number;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  channel_post?: TelegramMessage;
}

interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

export interface TelegramMe {
  id: number;
  is_bot: boolean;
  username: string;
  first_name?: string;
}

export class TelegramClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(
    token: string,
    fetchImpl: typeof fetch = fetch,
  ) {
    // Base URL never includes token in logs; token is only in URL path.
    this.baseUrl = `https://api.telegram.org/bot${token}`;
    this.fetchImpl = fetchImpl;
  }

  async getMe(): Promise<TelegramMe> {
    const res = await this.fetchImpl(`${this.baseUrl}/getMe`, {
      method: 'GET',
    });
    const body = (await res.json()) as TelegramApiResponse<TelegramMe>;
    if (!res.ok || !body.ok || !body.result) {
      const err = new Error(
        `Telegram getMe failed: ${body.description || res.statusText}`,
      ) as Error & { code?: number };
      (err as { code?: number }).code = body.error_code || res.status;
      throw err;
    }
    return body.result;
  }

  async getUpdates(
    offset: number,
    timeoutSec = 30,
  ): Promise<TelegramUpdate[]> {
    const url = `${this.baseUrl}/getUpdates`;
    const params = new URLSearchParams({
      offset: String(offset),
      timeout: String(timeoutSec),
      allowed_updates: JSON.stringify(['message', 'edited_message', 'channel_post']),
    });
    const res = await this.fetchImpl(`${url}?${params.toString()}`, {
      method: 'GET',
    });
    const body = (await res.json()) as TelegramApiResponse<TelegramUpdate[]>;
    if (!res.ok || !body.ok || !body.result) {
      const err = new Error(
        `Telegram getUpdates failed: ${body.description || res.statusText}`,
      ) as Error & { code?: number };
      (err as { code?: number }).code = body.error_code || res.status;
      throw err;
    }
    return body.result;
  }

  async sendMessage(chatId: string | number, text: string): Promise<void> {
    // Telegram limit is 4096 chars. Split into chunks to avoid silent truncation.
    const chunks = splitMessage(text, 4000);
    for (const chunk of chunks) {
      const res = await this.fetchImpl(`${this.baseUrl}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: chunk,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as TelegramApiResponse<unknown>;
      if (!res.ok || !body.ok) {
        const err = new Error(
          `Telegram sendMessage failed: ${(body as { description?: string }).description || res.statusText}`,
        ) as Error & { code?: number };
        (err as { code?: number }).code = body.error_code || res.status;
        throw err;
      }
    }
  }
}

function splitMessage(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    // Try to split on newline or space near the limit for readability.
    let end = Math.min(start + maxLen, text.length);
    if (end < text.length) {
      const slice = text.slice(start, end);
      const lastNewline = slice.lastIndexOf('\n');
      const lastSpace = slice.lastIndexOf(' ');
      const breakAt = lastNewline > maxLen * 0.6 ? lastNewline : lastSpace > maxLen * 0.6 ? lastSpace : -1;
      if (breakAt !== -1) end = start + breakAt + 1;
    }
    chunks.push(text.slice(start, end).trimEnd());
    start = end;
  }
  return chunks.filter(Boolean);
}
