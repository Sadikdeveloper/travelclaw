import { describe, expect, it } from 'vitest';
import { parseSessionKey, sessionKey } from './session-key';

describe('sessionKey', () => {
  it('round-trips a peer id that contains colons', () => {
    const key = sessionKey({
      agentId: 'marlow',
      channel: 'webchat',
      peerId: 'room:42',
    });
    expect(key).toBe('agent:marlow:webchat:room:42');
    expect(parseSessionKey(key)).toEqual({
      agentId: 'marlow',
      channel: 'webchat',
      peerId: 'room:42',
    });
  });

  it('rejects an empty channel', () => {
    expect(() => sessionKey({ agentId: 'marlow', channel: '', peerId: 'a' })).toThrow(
      /channel/,
    );
  });

  it('returns null for a foreign key', () => {
    expect(parseSessionKey('session:1')).toBeNull();
  });
});
