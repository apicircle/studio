// Entrypoint: builds the mock server, binds it to the configured port,
// and logs the URL so Playwright + manual debugging can find it. Reads
// `E2E_MOCK_PORT` from env (default 5176). Bind address is fixed to
// 127.0.0.1 so the server is never reachable from outside the dev box.

import { serve } from '@hono/node-server';
import { buildE2eMockServer } from './server';

const PORT = Number.parseInt(process.env.E2E_MOCK_PORT ?? '5176', 10);
const HOST = '127.0.0.1';

async function main(): Promise<void> {
  const { app, close } = await buildE2eMockServer();

  const server = serve({
    fetch: app.fetch,
    port: PORT,
    hostname: HOST,
  });

  // The startup banner + shutdown breadcrumb are intentional operator
  // output — Playwright's webServer hook needs the URL on stdout to
  // know the server is alive, and the shutdown line tells the operator
  // a Ctrl-C landed. Use console.warn so the no-console rule (which
  // allows warn/error) doesn't fire; semantically these are status
  // notices rather than warnings, but the project lint config doesn't
  // let us distinguish.
  const url = `http://${HOST}:${PORT}`;
  console.warn(`[e2e-mock] listening on ${url}`);
  console.warn(`[e2e-mock]   /__health         — health check`);
  console.warn(`[e2e-mock]   /__inspect/last   — last captured requests (newest first)`);
  console.warn(`[e2e-mock]   DELETE /__inspect — clear capture buffer`);

  const shutdown = async (signal: string): Promise<void> => {
    console.warn(`[e2e-mock] received ${signal}, closing…`);
    server.close((err) => {
      if (err) console.error('[e2e-mock] server.close error:', err);
    });
    await close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

void main().catch((err: unknown) => {
  console.error('[e2e-mock] fatal:', err);
  process.exit(1);
});
