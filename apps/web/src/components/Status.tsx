import type { ChannelStatus, TripStatus } from '@travelclaw/shared';

export function StatusTag({ status }: { status: TripStatus | ChannelStatus | string }) {
  return <span className={`tag ${status}`}>{status.replaceAll('_', ' ')}</span>;
}

export function Banner({
  message,
  tone = 'warn',
}: {
  message: string;
  tone?: 'warn' | 'bad';
}) {
  return <div className={tone === 'bad' ? 'banner bad' : 'banner'}>{message}</div>;
}
