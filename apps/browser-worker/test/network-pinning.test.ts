import { EventEmitter } from 'node:events';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { gzipSync } from 'node:zlib';
import type { BrowserSite } from '@travelclaw/shared';
const mocks = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }));
vi.mock('node:dns/promises', () => ({ lookup: mocks.lookup }));
vi.mock('node:https', () => ({ default: { request: mocks.request } }));
import { pinnedTransport, MAX_RESPONSE_BYTES } from '../src/network';
const site: BrowserSite = {
  id: 'fixture',
  name: 'Fixture',
  kind: 'flight',
  startUrl: 'https://fixture.test/',
  origins: ['https://fixture.test'],
  searchPostPaths: [],
};
describe('production transport DNS pinning', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });
  it('rejects mixed public/private DNS answers before opening a socket', async () => {
    mocks.lookup.mockResolvedValue([
      { address: '8.8.8.8', family: 4 },
      { address: '::1', family: 6 },
    ]);
    await expect(
      pinnedTransport(
        { url: site.startUrl, method: 'GET', headers: {} },
        site,
        AbortSignal.timeout(1000),
      ),
    ).rejects.toThrow();
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it('pins the connection lookup and strips credentials, even if DNS subsequently rebinds', async () => {
    mocks.lookup
      .mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }])
      .mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
    mocks.request.mockImplementation((_url, options, callback) => {
      expect(options.headers.authorization).toBeUndefined();
      expect(options.headers['proxy-authorization']).toBeUndefined();
      expect(options.agent).toBe(false);
      options.lookup('fixture.test', {}, (_err: unknown, ip: string) =>
        expect(ip).toBe('8.8.8.8'),
      );
      const req = new EventEmitter() as EventEmitter & { end: () => void };
      req.end = () => {
        const res = Object.assign(new EventEmitter(), {
          headers: { 'content-type': 'text/html' },
          statusCode: 200,
        });
        callback(res);
        res.emit('data', Buffer.from('public search'));
        res.emit('end');
      };
      return req;
    });
    const result = await pinnedTransport(
      {
        url: site.startUrl,
        method: 'GET',
        headers: { authorization: 'secret', 'proxy-authorization': 'other-secret' },
      },
      site,
      AbortSignal.timeout(1000),
    );
    expect(result.body.toString()).toBe('public search');
    expect(mocks.lookup).toHaveBeenCalledTimes(1);
  });
  it('bounds decompressed response size, not just wire size', async () => {
    mocks.lookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
    mocks.request.mockImplementation((_url, _options, callback) => {
      const req = new EventEmitter() as EventEmitter & { end: () => void };
      req.end = () => {
        const res = Object.assign(new EventEmitter(), {
          headers: { 'content-encoding': 'gzip' },
          statusCode: 200,
        });
        callback(res);
        res.emit('data', gzipSync(Buffer.alloc(MAX_RESPONSE_BYTES + 1)));
        res.emit('end');
      };
      return req;
    });
    await expect(
      pinnedTransport(
        { url: site.startUrl, method: 'GET', headers: {} },
        site,
        AbortSignal.timeout(1000),
      ),
    ).rejects.toThrow();
  });
  it('charges streaming wire bytes and decompression expansion against the shared budget', async () => {
    mocks.lookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
    const expanded = Buffer.alloc(4096, 'x');
    const compressed = gzipSync(expanded);
    mocks.request.mockImplementation((_url, _options, callback) => {
      const req = Object.assign(new EventEmitter(), {
        end: () => {
          const res = Object.assign(new EventEmitter(), {
            headers: { 'content-encoding': 'gzip' },
            statusCode: 200,
          });
          callback(res);
          res.emit('data', compressed);
          res.emit('end');
        },
      });
      return req;
    });
    const consume = vi.fn();
    await pinnedTransport(
      { url: site.startUrl, method: 'GET', headers: {} },
      site,
      AbortSignal.timeout(1000),
      consume,
    );
    expect(consume.mock.calls.map(([bytes]) => bytes)).toEqual([
      compressed.length,
      expanded.length - compressed.length,
    ]);
    expect(consume.mock.calls.reduce((sum, [bytes]) => sum + bytes, 0)).toBe(
      expanded.length,
    );
  });
  it('destroys the request immediately when a streaming shared budget rejects a chunk', async () => {
    mocks.lookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
    const destroy = vi.fn();
    mocks.request.mockImplementation((_url, _options, callback) => {
      const req = Object.assign(new EventEmitter(), {
        destroy: (error: Error) => {
          destroy();
          req.emit('error', error);
        },
        end: () => {
          const res = Object.assign(new EventEmitter(), { headers: {}, statusCode: 200 });
          callback(res);
          res.emit('data', Buffer.alloc(2048));
        },
      });
      return req;
    });
    await expect(
      pinnedTransport(
        { url: site.startUrl, method: 'GET', headers: {} },
        site,
        AbortSignal.timeout(1000),
        () => {
          throw new Error('budget exceeded');
        },
      ),
    ).rejects.toThrow();
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});
