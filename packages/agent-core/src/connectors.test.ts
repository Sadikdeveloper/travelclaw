import { describe, expect, it, vi } from 'vitest';
import { convertCurrency, weatherOutlook } from './tools';
import type { ToolContext } from './types';

const now = new Date('2026-03-01T00:00:00Z');

function ctxWithConnector(
  name: string,
  credentials: { baseUrl?: string; apiKey?: string },
  fetchImpl: typeof fetch,
  rejected: (name: string) => void = () => {},
): ToolContext {
  return {
    now,
    network: true,
    fetchImpl,
    connectors: {
      get: (wanted: string) => (wanted === name ? credentials : undefined),
      rejected,
    },
  };
}

describe('currency connector', () => {
  it('calls the connector base URL with the key in a header, not the URL', async () => {
    const seen: Array<{ url: string; headers: Record<string, string> }> = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      seen.push({
        url: String(url),
        headers: (init?.headers ?? {}) as Record<string, string>,
      });
      return new Response(JSON.stringify({ rates: { EUR: 92 } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const data = await convertCurrency(
      100,
      'USD',
      'EUR',
      ctxWithConnector(
        'currency',
        { baseUrl: 'https://rates.example.com/', apiKey: 'secret-key-1234' },
        fetchImpl,
      ),
    );

    expect(data.source).toBe('frankfurter');
    expect(data.converted).toBe(92);
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe('https://rates.example.com/latest?from=USD&to=EUR&amount=100');
    expect(seen[0].headers.Authorization).toBe('Bearer secret-key-1234');
    expect(seen[0].url).not.toContain('secret-key-1234');
    expect(JSON.stringify(data)).not.toContain('secret-key-1234');
  });

  it('marks the connector rejected on a 401 and falls back to the desk table', async () => {
    const rejected = vi.fn();
    const fetchImpl = (async () => new Response('no', { status: 401 })) as typeof fetch;

    const data = await convertCurrency(
      100,
      'USD',
      'EUR',
      ctxWithConnector('currency', { apiKey: 'bad-key' }, fetchImpl, rejected),
    );

    expect(rejected).toHaveBeenCalledWith('currency');
    expect(data.source).toBe('desk-table');
    expect(data.converted).toBeGreaterThan(0);
  });

  it('ignores a non-http base and keeps the desk default', async () => {
    const seen: string[] = [];
    const fetchImpl = (async (url: string | URL | Request) => {
      seen.push(String(url));
      return new Response(JSON.stringify({ rates: { EUR: 92 } }), { status: 200 });
    }) as typeof fetch;

    await convertCurrency(
      100,
      'USD',
      'EUR',
      ctxWithConnector('currency', { baseUrl: 'file:///etc/passwd' }, fetchImpl),
    );

    expect(seen[0]).toMatch(/^https:\/\/api\.frankfurter\.app\//);
  });
});

describe('weather connector', () => {
  it('calls the connector base URL with the key in a header', async () => {
    const seen: Array<{ url: string; headers: Record<string, string> }> = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      seen.push({
        url: String(url),
        headers: (init?.headers ?? {}) as Record<string, string>,
      });
      return new Response(
        JSON.stringify({
          daily: {
            time: ['2026-03-02'],
            weathercode: [0],
            temperature_2m_max: [14],
            temperature_2m_min: [6],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    const data = await weatherOutlook(
      { destination: 'Lisbon', interests: [] },
      ctxWithConnector(
        'weather',
        { baseUrl: 'https://sky.example.com', apiKey: 'sky-secret-9999' },
        fetchImpl,
      ),
    );

    expect(data.source).toBe('open-meteo');
    expect(data.days).toHaveLength(1);
    expect(seen[0].url).toMatch(/^https:\/\/sky\.example\.com\/v1\/forecast\?/);
    expect(seen[0].headers.Authorization).toBe('Bearer sky-secret-9999');
    expect(JSON.stringify(data)).not.toContain('sky-secret-9999');
  });

  it('marks the connector rejected on a 403 and falls back to the seasonal card', async () => {
    const rejected = vi.fn();
    const fetchImpl = (async () => new Response('no', { status: 403 })) as typeof fetch;

    const data = await weatherOutlook(
      { destination: 'Lisbon', interests: [] },
      ctxWithConnector('weather', { apiKey: 'bad-key' }, fetchImpl, rejected),
    );

    expect(rejected).toHaveBeenCalledWith('weather');
    expect(data.source).toBe('seasonal-card');
  });
});
