import { browserSiteSchema } from '@travelclaw/shared';
import { z } from 'zod';
import { BrowserEngine } from './engine';
import { permittedUrl } from './network';
import { workerServer } from './server';

async function main() {
  const token = process.env.TRAVELCLAW_BROWSER_WORKER_TOKEN || '';
  if (token.length < 32)
    throw new Error('Configure a browser worker token of at least 32 characters.');
  const sites = z
    .array(browserSiteSchema)
    .min(1)
    .max(20)
    .parse(JSON.parse(process.env.TRAVELCLAW_BROWSER_SITES_JSON || '[]'));
  if (new Set(sites.map((s) => s.id)).size !== sites.length)
    throw new Error('Browser site ids must be unique.');
  for (const site of sites) {
    if (site.origins.some((origin) => new URL(origin).origin !== origin))
      throw new Error('Browser origins must be exact HTTP(S) origins without paths.');
    permittedUrl(site.startUrl, site);
  }
  const engine = await BrowserEngine.launch(sites);
  const server = workerServer(engine, token);
  const close = () => {
    server.close();
    void engine.shutdown().finally(() => process.exit(0));
  };
  process.once('SIGTERM', close);
  process.once('SIGINT', close);
  server.listen(Number(process.env.PORT || 3001), '0.0.0.0', () =>
    console.log('Browser worker ready. No personal browser is attached.'),
  );
}
main().catch(() => {
  console.error(
    'Browser worker failed to start. Check site configuration, worker token, and Chromium sandbox support.',
  );
  process.exitCode = 1;
});
