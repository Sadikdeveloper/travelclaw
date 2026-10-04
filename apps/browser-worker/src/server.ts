import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage } from 'node:http';
import { z } from 'zod';
import { BrowserEngine, BusySession, MissingSession } from './engine';

const openSchema = z
  .object({ siteId: z.string().max(50), request: z.string().min(1).max(8000) })
  .strict();
async function jsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 32768) throw new Error('body too large');
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export function workerServer(engine: BrowserEngine, token: string) {
  if (token.length < 32)
    throw new Error('Browser worker token must be at least 32 characters.');
  const hash = createHash('sha256').update(`Bearer ${token}`).digest();
  const server = createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    const send = (status: number, body: unknown) => {
      res.writeHead(status);
      res.end(JSON.stringify(body));
    };
    if (req.method === 'GET' && req.url === '/health') return send(200, { ok: true });
    if (
      !timingSafeEqual(
        hash,
        createHash('sha256')
          .update(req.headers.authorization || '')
          .digest(),
      )
    )
      return send(401, { error: 'Unauthorized' });
    try {
      if (req.method === 'GET' && req.url === '/sites')
        return send(200, engine.listSites());
      if (req.method === 'POST' && req.url === '/sessions') {
        const input = openSchema.parse(await jsonBody(req));
        return send(201, await engine.open(input.siteId, input.request));
      }
      const route = /^\/sessions\/([a-f0-9-]{36})(\/actions)?$/.exec(req.url || '');
      if (!route) return send(404, { error: 'Not found' });
      const key =
        typeof req.headers['x-session-key'] === 'string'
          ? req.headers['x-session-key']
          : '';
      if (req.method === 'DELETE' && !route[2]) {
        await engine.close(route[1], key);
        return send(200, { ok: true });
      }
      if (req.method === 'POST' && route[2])
        return send(200, await engine.act(route[1], key, await jsonBody(req)));
      return send(404, { error: 'Not found' });
    } catch (error) {
      // Never return browser errors, request URLs, cookies or credential-bearing objects.
      return send(
        error instanceof MissingSession ? 404 : error instanceof BusySession ? 409 : 400,
        {
          error:
            error instanceof MissingSession
              ? 'Not found'
              : 'Browser request could not complete',
        },
      );
    }
  });
  server.requestTimeout = 20000;
  server.headersTimeout = 5000;
  return server;
}
