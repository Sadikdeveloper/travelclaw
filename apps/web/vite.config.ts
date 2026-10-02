import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { createLogger, defineConfig } from 'vite';

const gateway = 'http://127.0.0.1:3000';
const noticeEveryMs = 30_000;

interface ConnectError extends Error {
  code?: string;
  address?: string;
  port?: number;
}

/**
 * `pnpm dev` starts this server and the gateway together. Vite is ready in a fraction of a
 * second, while `nest start --watch` needs several more to compile and boot, and again after
 * every save. A tab left open from the last run keeps retrying its socket through the proxy
 * in that gap, and Vite answers every refused connection with a full stack trace. A gateway
 * that is not up yet is an expected, passing state, so it gets one line, repeated at most
 * every 30 seconds. Every other proxy error is still logged in full.
 */
function devLogger() {
  const { hostname, host, port } = new URL(gateway);
  const logger = createLogger();
  const logError = logger.error;
  let lastNotice = 0;
  logger.error = (message, options) => {
    const error = options?.error as ConnectError | null | undefined;
    const refused =
      error?.code === 'ECONNREFUSED' &&
      error.address === hostname &&
      error.port === Number(port);
    if (!refused) return logError(message, options);
    const now = Date.now();
    if (now - lastNotice < noticeEveryMs) return;
    lastNotice = now;
    logger.warn(
      `gateway is not accepting connections on ${host} yet (still compiling, or apps/api is not running)`,
      { timestamp: true },
    );
  };
  return logger;
}

export default defineConfig({
  customLogger: devLogger(),
  plugins: [react()],
  resolve: {
    alias: {
      '@travelclaw/shared': fileURLToPath(
        new URL('../../packages/shared/src/index.ts', import.meta.url),
      ),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: true,
    proxy: {
      '/api': { target: gateway, changeOrigin: true },
      '/health': { target: gateway, changeOrigin: true },
      '/docs': { target: gateway, changeOrigin: true },
      '/socket.io': { target: gateway, ws: true, changeOrigin: true },
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
  },
});
