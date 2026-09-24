export interface SessionKeyParts {
  agentId: string;
  channel: string;
  peerId: string;
}

const KEY = /^agent:([^:]+):([^:]+):(.+)$/;

/** Session identity. Peer id may contain colons; agent and channel may not. */
export function sessionKey(parts: SessionKeyParts): string {
  if (!parts.agentId || parts.agentId.includes(':')) {
    throw new Error('agentId is required and cannot contain ":"');
  }
  if (!parts.channel || parts.channel.includes(':')) {
    throw new Error('channel is required and cannot contain ":"');
  }
  if (!parts.peerId) {
    throw new Error('peerId is required');
  }
  return `agent:${parts.agentId}:${parts.channel}:${parts.peerId}`;
}

export function parseSessionKey(key: string): SessionKeyParts | null {
  const match = KEY.exec(key);
  if (!match) return null;
  return { agentId: match[1], channel: match[2], peerId: match[3] };
}
