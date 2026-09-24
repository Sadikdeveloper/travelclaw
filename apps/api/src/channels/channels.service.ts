import { Injectable } from '@nestjs/common';
import type { ChannelPlugin } from '@travelclaw/shared';

/**
 * Plugins are registered here on purpose. Scanning a folder for code is a
 * later roadmap item, and it should ship with an allowlist.
 */
@Injectable()
export class ChannelsService {
  list(): ChannelPlugin[] {
    const telegramToken = Boolean(process.env.TELEGRAM_BOT_TOKEN);
    const discordToken = Boolean(process.env.DISCORD_BOT_TOKEN);
    return [
      {
        id: 'webchat',
        label: 'Webchat',
        status: 'ready',
        configured: true,
        detail: 'Built into the control UI. This is the channel the desk answers today.',
      },
      {
        id: 'telegram',
        label: 'Telegram',
        status: telegramToken ? 'disabled' : 'not_configured',
        configured: telegramToken,
        detail: telegramToken
          ? 'Token is set, but the adapter is not implemented. See docs/adding-a-channel.md.'
          : 'Set TELEGRAM_BOT_TOKEN only after the adapter exists. See docs/adding-a-channel.md.',
      },
      {
        id: 'discord',
        label: 'Discord',
        status: discordToken ? 'disabled' : 'not_configured',
        configured: discordToken,
        detail: discordToken
          ? 'Token is set, but the adapter is not implemented. See docs/adding-a-channel.md.'
          : 'Discord is a slot, not a connection. See docs/adding-a-channel.md.',
      },
    ];
  }
}
