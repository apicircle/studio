// Pauses for `:ms` milliseconds before responding. Use for duration
// assertion testing (`duration > 100ms`, `duration < 500ms`, etc.).
// Capped at 5000ms so a test typo can't stall the suite indefinitely.

import { Hono } from 'hono';

const MAX_DELAY_MS = 5000;

export function buildDelayRoutes(): Hono {
  const app = new Hono();

  app.all('/delay/:ms', async (c) => {
    const msStr = c.req.param('ms');
    const ms = Math.min(Math.max(0, Number.parseInt(msStr, 10) || 0), MAX_DELAY_MS);
    await new Promise((resolve) => setTimeout(resolve, ms));
    return c.json({ delayedMs: ms });
  });

  return app;
}
