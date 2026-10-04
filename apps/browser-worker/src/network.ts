import { lookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';
import { brotliDecompressSync, gunzipSync, inflateSync } from 'node:zlib';
import ipaddr from 'ipaddr.js';
import type { BrowserSite } from '@travelclaw/shared';

export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
export class NetworkDenied extends Error {
  constructor() {
    super(
      'The site requested a destination or operation outside its authorized search scope.',
    );
  }
}
export function publicAddress(address: string): boolean {
  try {
    const parsed = ipaddr.process(address);
    return parsed.range() === 'unicast' && parsed.toString() !== '168.63.129.16';
  } catch {
    return false;
  }
}

// A second, deliberately conservative barrier alongside exact origin/method scope.
const restricted =
  /(?:^|[\W_])(checkout|payment|purchase|reserve|reservation|login|logout|signin|signup|password|passport|creditcard|authorization)(?:$|[\W_])/i;
export function permittedUrl(raw: string, site: BrowserSite, method = 'GET'): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new NetworkDenied();
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.port && !['80', '443'].includes(url.port)) ||
    !site.origins.includes(url.origin) ||
    restricted.test(decodeURIComponentSafe(url.pathname + url.search)) ||
    !(
      ['GET', 'HEAD'].includes(method) ||
      (method === 'POST' && site.searchPostPaths.includes(url.pathname))
    )
  ) {
    throw new NetworkDenied();
  }
  return url;
}
function decodeURIComponentSafe(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new NetworkDenied();
  }
}
export interface WireRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: Buffer | null;
}
export interface WireResponse {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
}
export type Transport = (
  request: WireRequest,
  site: BrowserSite,
  signal: AbortSignal,
  consumeBytes?: (bytes: number) => void,
) => Promise<WireResponse>;

/** DNS is validated once and the actual socket connects to that IP. No redirect following. */
export const pinnedTransport: Transport = async (request, site, signal, consumeBytes) => {
  const url = permittedUrl(request.url, site, request.method);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host)
    ? [{ address: host, family: isIP(host) }]
    : await withAbort(lookup(host, { all: true }), signal);
  signal.throwIfAborted();
  if (!addresses.length || addresses.some(({ address }) => !publicAddress(address)))
    throw new NetworkDenied();
  const pinned = addresses[0];
  if (request.body && request.body.length > 32768) throw new NetworkDenied();
  const headers = { ...request.headers };
  for (const name of Object.keys(headers)) {
    if (
      /^(authorization|proxy-authorization|host|connection|content-length|accept-encoding|upgrade|proxy-connection)$/i.test(
        name,
      )
    )
      delete headers[name];
  }
  headers['accept-encoding'] = 'identity';
  // Passing the original URL preserves Host, SNI and certificate verification.
  return new Promise<WireResponse>((resolve, reject) => {
    const req = (url.protocol === 'https:' ? https : http).request(
      url,
      {
        method: request.method,
        headers,
        agent: false,
        signal,
        timeout: 10000,
        family: pinned.family,
        lookup: (_hostname, _options, callback) =>
          callback(null, pinned.address, pinned.family),
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          try {
            consumeBytes?.(chunk.length);
          } catch {
            req.destroy(new NetworkDenied());
            return;
          }
          size += chunk.length;
          if (size > MAX_RESPONSE_BYTES) {
            req.destroy(new NetworkDenied());
            return;
          }
          chunks.push(chunk);
        });
        res.on('error', reject);
        res.on('end', () => {
          void (async () => {
            const result: Record<string, string> = {};
            for (const [name, value] of Object.entries(res.headers)) {
              if (
                value !== undefined &&
                ![
                  'transfer-encoding',
                  'content-length',
                  'content-encoding',
                  'connection',
                ].includes(name)
              ) {
                result[name] = Array.isArray(value) ? value.join('\n') : value;
              }
            }
            if (/attachment/i.test(result['content-disposition'] || ''))
              throw new NetworkDenied();
            let body: Buffer = Buffer.concat(chunks);
            const enc = res.headers['content-encoding'];
            const options = { maxOutputLength: MAX_RESPONSE_BYTES };
            if (enc === 'gzip') body = gunzipSync(body, options);
            else if (enc === 'deflate') body = inflateSync(body, options);
            else if (enc === 'br') body = brotliDecompressSync(body, options);
            else if (enc && enc !== 'identity') throw new NetworkDenied();
            consumeBytes?.(Math.max(0, body.length - size));
            if (result.location)
              permittedUrl(new URL(result.location, url).href, site, 'GET');
            resolve({ status: res.statusCode || 502, headers: result, body });
          })().catch(reject);
        });
      },
    );
    req.on('timeout', () => req.destroy(new NetworkDenied()));
    req.on('error', reject);
    req.end(request.body || undefined);
  });
};

async function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let abort = () => {};
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(new NetworkDenied());
    signal.addEventListener('abort', abort, { once: true });
  });
  try {
    return await Promise.race([promise, cancelled]);
  } finally {
    signal.removeEventListener('abort', abort);
  }
}
