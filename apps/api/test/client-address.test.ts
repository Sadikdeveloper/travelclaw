import { isDirectLoopback, isLoopback } from '../src/auth/pairing';
import { configureApp } from '../src/app.setup';
import { loadConfig } from '../src/config';
import { clientKey } from '../src/common/rate-limit';
import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { Express } from 'express';

@Module({})
class EmptyModule {}

describe('trusted proxy configuration and client identity', () => {
  const savedEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it.each([
    '',
    'loopback',
    '*',
    '0.0.0.0/0',
    '::/0',
    '::ffff:0.0.0.0/96',
    '0:0:0:0:0:ffff:0:0/96',
    '127.0.0.1/33',
    '::1/129',
    '127.0.0.1/',
    'not-an-ip',
    '127.0.0.1,',
  ])('rejects unsafe proxy config without echoing values: %s', (value) => {
    expect(() =>
      loadConfig({ TRAVELCLAW_TRUST_PROXY: '1', TRAVELCLAW_TRUSTED_PROXIES: value }),
    ).toThrow('requires TRAVELCLAW_TRUSTED_PROXIES');
  });

  it('requires an explicit list in proxy mode, but not for direct local development', () => {
    expect(() => loadConfig({ TRAVELCLAW_TRUST_PROXY: '1' })).toThrow(
      'requires TRAVELCLAW_TRUSTED_PROXIES',
    );
    expect(loadConfig({}).trustedProxies).toEqual([]);
    expect(
      loadConfig({
        TRAVELCLAW_TRUST_PROXY: '1',
        TRAVELCLAW_TRUSTED_PROXIES: '10.0.0.2/32, ::1/128',
      }).trustedProxies,
    ).toEqual(['10.0.0.2/32', '::1/128']);
  });

  it.each(['127.0.0.1', '127.255.255.1', '::1', '::ffff:127.0.0.1', '::ffff:7f00:1'])(
    'recognizes a valid direct loopback peer: %s',
    (ip) => {
      process.env.TRAVELCLAW_TRUST_PROXY = '0';
      expect(isLoopback(ip)).toBe(true);
      expect(isDirectLoopback(ip, {})).toBe(true);
    },
  );

  it.each([
    '127.999.1.1',
    '127.0.0.1.evil.test',
    '127.1',
    '',
    undefined,
    '10.0.0.1',
    '203.0.113.5',
  ])('does not exempt a remote or invalid peer, regardless of headers: %s', (ip) => {
    process.env.TRAVELCLAW_TRUST_PROXY = '0';
    expect(isLoopback(ip)).toBe(false);
    expect(isDirectLoopback(ip, { 'x-forwarded-for': '127.0.0.1' })).toBe(false);
    expect(isDirectLoopback(ip, {})).toBe(false);
  });

  it.each([
    ['0', '', '127.0.0.1, 203.0.113.5', 'loopback'],
    ['1', '10.0.0.2/32', '127.0.0.1, 203.0.113.5', 'loopback'],
    ['1', '127.0.0.1/32,::1/128', '127.0.0.1, 203.0.113.5', '203.0.113.5'],
    [
      '1',
      '127.0.0.1/32,::1/128,10.0.0.2/32',
      '198.51.100.8, 203.0.113.5, 10.0.0.2',
      '203.0.113.5',
    ],
  ])(
    'bounds Express identity by trusted hops (%s, %s)',
    async (enabled, proxies, chain, expected) => {
      process.env.TRAVELCLAW_TRUST_PROXY = enabled;
      process.env.TRAVELCLAW_TRUSTED_PROXIES = proxies;
      const app = await NestFactory.create<NestExpressApplication>(EmptyModule, {
        logger: false,
      });
      try {
        configureApp(app);
        (app.getHttpAdapter().getInstance() as Express).get('/identity', (req, res) =>
          res.json({ key: clientKey(req) }),
        );
        await app.init();
        const result = await request(app.getHttpServer())
          .get('/identity')
          .set('X-Forwarded-For', chain);
        expect(result.status).toBe(200);
        if (expected === 'loopback') expect(isLoopback(result.body.key)).toBe(true);
        else expect(result.body.key).toBe(expected);
      } finally {
        await app.close();
      }
    },
  );
});
