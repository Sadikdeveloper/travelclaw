import { authHeaders, connectorBase, fetchWithTimeout } from './http';
import type { ToolContext } from './types';

/**
 * Two tools that read the public web: `web.search` and `web.fetch`.
 *
 * The shape follows what OpenClaw and Hermes do — a search/extract pair behind a
 * provider, with a keyless tier so a bare install still reaches the web:
 *
 * 1. An operator connector named `search` (base URL + key) is used when it
 *    exists, so a self-hosted SearXNG or a paid API is one env var away.
 * 2. Otherwise the keyless DuckDuckGo HTML endpoint is used, the same
 *    no-credential fallback OpenClaw ships as its `duckduckgo` provider and
 *    Hermes reaches through `ddgs`. It is a parsed public page, not an API, so a
 *    markup change is reported as "no readable results" rather than dressed up.
 * 3. With the network flag off (`TRAVELCLAW_NETWORK=0`) nothing is fetched and
 *    the tool says so.
 *
 * Everything here is read-only. A page is data, never an instruction: the text
 * is bounded, the source and retrieval time travel with it, and `web.fetch`
 * refuses anything that is not a public http(s) page — no loopback, no private
 * literal address, no credentials in the URL, no redirect to another host.
 * Full DNS pinning is the browser worker's job, not this one's.
 */

const SEARCH_TIMEOUT_MS = 7000;
const FETCH_TIMEOUT_MS = 9000;
export const MAX_WEB_RESULTS = 5;
const MAX_FETCH_BYTES = 400_000;
export const MAX_FETCH_CHARS = 4000;

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchData {
  query: string;
  provider: string;
  retrievedAt: string;
  results: WebSearchResult[];
}

export interface WebFetchData {
  url: string;
  title: string;
  text: string;
  retrievedAt: string;
  truncated: boolean;
}

export type WebSearchOutcome =
  { ok: true; data: WebSearchData } | { ok: false; reason: string };

export type WebFetchOutcome =
  { ok: true; data: WebFetchData } | { ok: false; reason: string };

/** Search the public web. Never throws: a failure is a reason the desk can say out loud. */
export async function webSearch(
  rawQuery: string,
  count: number,
  ctx: ToolContext,
): Promise<WebSearchOutcome> {
  const query = rawQuery.replace(/\s+/g, ' ').trim().slice(0, 200);
  if (query.length < 2) return { ok: false, reason: 'That search needs a few more words.' };
  if (!ctx.network || !ctx.fetchImpl) {
    return {
      ok: false,
      reason:
        'This desk is offline, so it did not search the web. Set TRAVELCLAW_NETWORK=1 to allow it.',
    };
  }

  const wanted = Math.max(1, Math.min(count || MAX_WEB_RESULTS, MAX_WEB_RESULTS));
  const connector = ctx.connectors?.get('search');
  const retrievedAt = ctx.now.toISOString();

  if (connector?.baseUrl && connector.apiKey) {
    const configured = await searchConfiguredProvider(query, wanted, connector, ctx);
    if (configured) return { ok: true, data: { query, retrievedAt, ...configured } };
    // An operator source that answered nothing usable is not silently swapped for
    // a public scrape: say which source failed instead of changing the source.
    return {
      ok: false,
      reason: 'The configured search source did not answer with results.',
    };
  }

  const keyless = await searchDuckDuckGo(query, wanted, ctx);
  if (!keyless.length) return { ok: false, reason: 'No readable web results came back.' };
  return {
    ok: true,
    data: { query, provider: 'DuckDuckGo', retrievedAt, results: keyless },
  };
}

async function searchConfiguredProvider(
  query: string,
  count: number,
  connector: { baseUrl?: string; apiKey?: string },
  ctx: ToolContext,
): Promise<{ provider: string; results: WebSearchResult[] } | null> {
  const base = connectorBase(connector.baseUrl, '');
  if (!base) return null;
  try {
    const url = new URL(`${base}/search`);
    url.searchParams.set('q', query);
    url.searchParams.set('count', String(count));
    const response = await fetchWithTimeout(
      ctx.fetchImpl!,
      url.toString(),
      SEARCH_TIMEOUT_MS,
      { headers: { Accept: 'application/json', ...authHeaders(connector.apiKey) } },
    );
    if (!response.ok) {
      if (response.status === 401 || response.status === 403)
        ctx.connectors?.rejected?.('search');
      return null;
    }
    const body: unknown = await response.json();
    const results = normalizeProviderResults(body).slice(0, count);
    return results.length ? { provider: providerLabel(body, base), results } : null;
  } catch {
    // A connector that hangs or answers nonsense is a failure, never a fallback
    // that quietly changes which source the traveler's search ran against.
    return null;
  }
}

function providerLabel(body: unknown, base: string): string {
  const label = (body as { provider?: unknown })?.provider;
  if (typeof label === 'string' && label.trim()) return label.trim().slice(0, 60);
  try {
    return new URL(base).host;
  } catch {
    return 'search source';
  }
}

/** Accepts the same `{ results: [...] }` / `{ web: [...] }` shapes the desk documents. */
function normalizeProviderResults(body: unknown): WebSearchResult[] {
  const list =
    (body as { results?: unknown; web?: unknown })?.results ??
    (body as { web?: unknown })?.web;
  if (!Array.isArray(list)) return [];
  return list.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const item = entry as {
      title?: unknown;
      url?: unknown;
      link?: unknown;
      snippet?: unknown;
      description?: unknown;
    };
    const url =
      typeof item.url === 'string'
        ? item.url
        : typeof item.link === 'string'
          ? item.link
          : '';
    if (!/^https?:\/\//i.test(url)) return [];
    return [
      {
        title: text(typeof item.title === 'string' ? item.title : url),
        url: url.slice(0, 2048),
        snippet: text(
          typeof item.snippet === 'string'
            ? item.snippet
            : typeof item.description === 'string'
              ? item.description
              : '',
        ).slice(0, 400),
      },
    ];
  });
}

/**
 * The keyless tier: DuckDuckGo's no-JavaScript HTML endpoint, parsed for the
 * result anchors and snippets it renders. Nothing is sent but the query.
 */
async function searchDuckDuckGo(
  query: string,
  count: number,
  ctx: ToolContext,
): Promise<WebSearchResult[]> {
  try {
    const response = await fetchWithTimeout(
      ctx.fetchImpl!,
      'https://html.duckduckgo.com/html/',
      SEARCH_TIMEOUT_MS,
      {
        method: 'POST',
        headers: {
          Accept: 'text/html',
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'TravelClaw/0.1 (+https://github.com/Sadikdeveloper/travelclaw)',
        },
        body: new URLSearchParams({ q: query }).toString(),
        redirect: 'error',
      },
    );
    if (!response.ok) return [];
    const html = (await response.text()).slice(0, 600_000);
    return parseDuckDuckGo(html).slice(0, count);
  } catch {
    return [];
  }
}

/** Result anchors and snippets, paired by order. Tolerant of attribute reordering. */
export function parseDuckDuckGo(html: string): WebSearchResult[] {
  const titles = [
    ...html.matchAll(/<a\b[^>]*class="[^"]*result__a[^"]*"[^>]*>([\s\S]*?)<\/a>/gi),
  ];
  const snippets = [
    ...html.matchAll(/<a\b[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi),
  ];
  const results: WebSearchResult[] = [];
  for (const [index, match] of titles.entries()) {
    const url = decodeResultUrl(match[0]);
    const title = text(stripTags(match[1]));
    if (!url || !title) continue;
    const snippet = snippets[index]
      ? text(stripTags(snippets[index][1])).slice(0, 400)
      : '';
    results.push({ title: title.slice(0, 200), url, snippet });
  }
  return results;
}

/** `//duckduckgo.com/l/?uddg=<encoded>` is the shape the HTML endpoint wraps results in. */
function decodeResultUrl(anchor: string): string {
  const href = /href="([^"]+)"/i.exec(anchor)?.[1];
  if (!href) return '';
  let decoded = decodeEntities(href);
  try {
    const url = new URL(decoded, 'https://duckduckgo.com');
    if (/(^|\.)duckduckgo\.com$/i.test(url.hostname) && url.pathname.startsWith('/l/')) {
      decoded = url.searchParams.get('uddg') ?? decoded;
    }
  } catch {
    return '';
  }
  return /^https?:\/\//i.test(decoded) ? decoded.slice(0, 2048) : '';
}

/**
 * Read one public page as text. Refuses anything that is not a public http(s)
 * page, caps how much it will read, and says when it truncated rather than
 * handing the model an unmarked partial.
 */
export async function webFetch(rawUrl: string, ctx: ToolContext): Promise<WebFetchOutcome> {
  const url = publicHttpUrl(rawUrl);
  if (!url) {
    return {
      ok: false,
      reason:
        'That is not a public http(s) page the desk will open. Use a normal public link, without credentials or a private address.',
    };
  }
  if (!ctx.network || !ctx.fetchImpl) {
    return {
      ok: false,
      reason:
        'This desk is offline, so it did not open that page. Set TRAVELCLAW_NETWORK=1 to allow it.',
    };
  }
  try {
    const response = await fetchWithTimeout(
      ctx.fetchImpl,
      url.toString(),
      FETCH_TIMEOUT_MS,
      {
        headers: {
          Accept: 'text/html,application/xhtml+xml,text/plain,application/json;q=0.8',
          'User-Agent': 'TravelClaw/0.1 (+https://github.com/Sadikdeveloper/travelclaw)',
        },
        redirect: 'error',
      },
    );
    if (!response.ok) {
      return { ok: false, reason: `That page answered HTTP ${response.status}.` };
    }
    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    if (contentType && !/text\/|application\/(xhtml|json|xml)/.test(contentType)) {
      return { ok: false, reason: 'That link is not a readable text page.' };
    }
    const body = await readCapped(response, MAX_FETCH_BYTES);
    const isJson = contentType.includes('json');
    const readable = isJson
      ? text(body)
      : text(`${titleOf(body)}\n\n${stripTags(extractReadable(body))}`);
    const excerpt = readable.slice(0, MAX_FETCH_CHARS);
    if (!excerpt) return { ok: false, reason: 'That page had no readable text.' };
    return {
      ok: true,
      data: {
        url: url.toString(),
        title: titleOf(body) || url.hostname,
        text: excerpt,
        retrievedAt: ctx.now.toISOString(),
        truncated: readable.length > excerpt.length || body.length >= MAX_FETCH_BYTES,
      },
    };
  } catch {
    return {
      ok: false,
      reason: 'That page could not be read (timeout, blocked, or unreachable).',
    };
  }
}

/** http(s) only, public host only, no credentials, no redirect surface of our own. */
export function publicHttpUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;
  if (port !== 80 && port !== 443) return null;
  if (isPrivateHost(url.hostname)) return null;
  return url;
}

/**
 * Literal-only blocking: a name that resolves to a private address is caught by
 * the DNS pinning in the browser worker, and by the operator's egress rules for
 * this process. This stops the obvious direct asks — `localhost`, a bare host
 * label, and a private or link-local literal address.
 */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (!host) return true;
  if (host.startsWith('[') || host.includes(':')) return true; // any IPv6 literal
  if (!host.includes('.')) return true; // single-label names: localhost, intranet, ...
  if (
    /^(localhost|.*\.localhost|.*\.local|.*\.internal|.*\.home\.arpa|.*\.localdomain)$/.test(
      host,
    )
  ) {
    return true;
  }
  if (host === 'metadata.google.internal' || host === 'metadata.goog') return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!v4) return false;
  const [a, b] = [Number(v4[1]), Number(v4[2])];
  if ([a, b, Number(v4[3]), Number(v4[4])].some((part) => part > 255)) return true;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 192 && b === 0) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a >= 224) return true;
  return false;
}

async function readCapped(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > maxBytes * 4) return '';
  if (!response.body) return (await response.text()).slice(0, maxBytes);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let out = '';
  let size = 0;
  try {
    while (size < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      out += decoder.decode(value, { stream: true });
      if (out.length > maxBytes) break;
    }
    out += decoder.decode();
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  return out.slice(0, maxBytes);
}

/** Drop what no reader needs: scripts, styles, chrome, and the head's metadata. */
function extractReadable(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg|template|iframe)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(nav|footer|header|form)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
}

function titleOf(html: string): string {
  return text(
    decodeEntities(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? ''),
  ).slice(0, 160);
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, ' ');
}

function text(value: string): string {
  return decodeEntities(value).replace(/\s+/g, ' ').trim();
}

function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&');
}

/**
 * The router's copy of a search: the traveler's sentence with the command words
 * removed, so "search the web for Lisbon tram passes" searches for the subject
 * rather than the sentence.
 */
export function searchQueryFrom(text: string): string {
  const stripped = text
    .replace(
      /^\s*(please\s+)?(can you\s+|could you\s+|i want you to\s+)?(search|google|look up|find|browse|check)\b[^,]*?\b(web|online|internet)\b\s*(for|about|on)?\s*/i,
      '',
    )
    .replace(
      /^\s*(please\s+)?(search|google|look up|find online|browse)\s+(for|about)?\s*/i,
      '',
    )
    .replace(/\s+/g, ' ')
    .trim();
  return (stripped || text).slice(0, 200);
}

export function firstUrlIn(text: string): string {
  return /https?:\/\/[^\s<>"')\]]+/i.exec(text)?.[0] ?? '';
}
