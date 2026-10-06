import { describe, expect, it } from 'vitest';
import { isPrivateHost, parseDuckDuckGo, publicHttpUrl, webFetch, webSearch } from './web';
import type { ToolContext } from './types';

/** The shape the no-JavaScript endpoint renders, including an encoded redirect. */
const DDG_FIXTURE = `
<div class="result results_links results_links_deep web-result">
  <div class="links_main links_deep result__body">
    <h2 class="result__title">
      <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.visitlisboa.com%2Fen&amp;rut=abc">Visit Lisboa — official</a>
    </h2>
    <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.visitlisboa.com%2Fen">The official <b>Lisbon</b> tourism site: what to see &amp; when to come.</a>
  </div>
</div>
<div class="result results_links results_links_deep web-result">
  <div class="links_main links_deep result__body">
    <h2 class="result__title">
      <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Fweather">Best time to visit Lisbon</a>
    </h2>
    <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Fweather">April to June and September to October are the mild months.</a>
  </div>
</div>
<div class="result">
  <a class="result__a" href="javascript:alert(1)">Not a result</a>
</div>
`;

describe('parseDuckDuckGo', () => {
  it('reads titles, unwraps the redirect URL, and decodes entities', () => {
    const results = parseDuckDuckGo(DDG_FIXTURE);
    expect(results).toEqual([
      {
        title: 'Visit Lisboa — official',
        url: 'https://www.visitlisboa.com/en',
        snippet: 'The official Lisbon tourism site: what to see & when to come.',
      },
      {
        title: 'Best time to visit Lisbon',
        url: 'https://example.org/weather',
        snippet: 'April to June and September to October are the mild months.',
      },
    ]);
  });

  it('drops an anchor that is not a public http(s) link', () => {
    expect(
      parseDuckDuckGo(DDG_FIXTURE).some((item) => item.url.startsWith('javascript:')),
    ).toBe(false);
  });
});

describe('publicHttpUrl', () => {
  it('accepts a normal public page', () => {
    expect(publicHttpUrl('https://example.com/guide?x=1')?.hostname).toBe('example.com');
  });

  it.each([
    'http://localhost/admin',
    'http://127.0.0.1:80/',
    'http://10.0.0.5/',
    'http://192.168.1.1/',
    'http://169.254.169.254/latest/meta-data/',
    'http://[::1]/',
    'http://router/',
    'http://printer.local/',
    'https://user:pass@example.com/',
    'https://example.com:8080/',
    'file:///etc/passwd',
    'not a url',
  ])('refuses %s', (url) => {
    expect(publicHttpUrl(url)).toBeNull();
  });

  it('treats reserved and special-use ranges as private', () => {
    for (const host of ['100.64.0.1', '198.19.5.5', '224.0.0.1', '0.0.0.0', '172.20.3.4']) {
      expect(isPrivateHost(host)).toBe(true);
    }
    expect(isPrivateHost('example.com')).toBe(false);
  });
});

const ctx = (fetchImpl?: typeof fetch, network = true): ToolContext => ({
  now: new Date('2026-10-06T09:00:00Z'),
  network,
  ...(fetchImpl ? { fetchImpl } : {}),
});

/** A search source that is briefly down, counting how often it is asked. */
function busySource() {
  const calls: string[] = [];
  const fetchImpl = (async (url: string | URL | Request) => {
    calls.push(String(url));
    return new Response('upstream error', { status: 503 });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

describe('webSearch', () => {
  it('returns nothing, and says so, when the desk is offline', async () => {
    const outcome = await webSearch('lisbon in november', 5, ctx(undefined, false));
    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.reason).toMatch(/offline/i);
  });

  it('reads the keyless endpoint when no search connector is configured', async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), body: String(init?.body ?? '') });
      return new Response(DDG_FIXTURE, { status: 200 });
    }) as typeof fetch;

    const outcome = await webSearch('best time to visit Lisbon', 3, ctx(fetchImpl));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.data.provider).toBe('DuckDuckGo');
    expect(outcome.data.results).toHaveLength(2);
    expect(calls[0].url).toBe('https://html.duckduckgo.com/html/');
    expect(calls[0].body).toContain('q=best+time+to+visit+Lisbon');
  });

  it('asks a briefly-busy source again before giving up', async () => {
    const { fetchImpl, calls } = busySource();
    const outcome = await webSearch('lisbon', 3, ctx(fetchImpl));
    // A source that is down for a second is not the same as one that will not
    // answer: the search is worth one more ask inside its budget.
    expect(calls).toHaveLength(2);
    expect(outcome.ok).toBe(false);
  });

  it('stops asking the moment the traveler stops', async () => {
    const { fetchImpl, calls } = busySource();
    const controller = new AbortController();
    controller.abort();
    const outcome = await webSearch('lisbon', 3, {
      ...ctx(fetchImpl),
      signal: controller.signal,
    });
    // Stop ends the call, the retry, and the pause between them.
    expect(calls).toHaveLength(0);
    expect(outcome.ok).toBe(false);
  });

  it('prefers an operator search connector and never silently falls back', async () => {
    const urls: string[] = [];
    const fetchImpl = (async (url: string | URL | Request) => {
      urls.push(String(url));
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    }) as typeof fetch;
    const withConnector: ToolContext = {
      ...ctx(fetchImpl),
      connectors: {
        get: () => ({ baseUrl: 'https://search.example/v1', apiKey: 'secret-key' }),
      },
    };

    const outcome = await webSearch('lisbon', 3, withConnector);
    expect(outcome.ok).toBe(false);
    expect(urls).toEqual(['https://search.example/v1/search?q=lisbon&count=3']);
  });
});

describe('webFetch', () => {
  it('reads a page as text and labels the source', async () => {
    const fetchImpl = (async () =>
      new Response(
        '<html><head><title>Lisbon in November</title><style>p{}</style></head><body><script>alert(1)</script><p>November is cool and quiet.</p></body></html>',
        { status: 200, headers: { 'Content-Type': 'text/html' } },
      )) as typeof fetch;

    const outcome = await webFetch('https://example.org/lisbon', ctx(fetchImpl));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.data.title).toBe('Lisbon in November');
    expect(outcome.data.text).toContain('November is cool and quiet.');
    expect(outcome.data.text).not.toContain('alert(1)');
    expect(outcome.data.retrievedAt).toBe('2026-10-06T09:00:00.000Z');
  });

  it('refuses a private address before making any request', async () => {
    let called = false;
    const fetchImpl = (async () => {
      called = true;
      return new Response('nope', { status: 200 });
    }) as typeof fetch;

    const outcome = await webFetch(
      'http://169.254.169.254/latest/meta-data/',
      ctx(fetchImpl),
    );
    expect(outcome.ok).toBe(false);
    expect(called).toBe(false);
  });
});
