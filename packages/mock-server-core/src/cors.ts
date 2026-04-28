// CORS middleware honoring `MockServer.cors`. Hono ships a `cors()`
// middleware in `hono/cors`; we wrap it so the origins list comes from
// the workspace doc instead of being hardcoded.

import { cors as honoCors } from 'hono/cors';
import type { MiddlewareHandler } from 'hono';
import type { MockServer } from '@apicircle/shared';

export function buildCors(config: MockServer['cors']): MiddlewareHandler | null {
  if (!config.enabled) return null;
  return honoCors({
    origin: config.origins.length === 0 ? '*' : config.origins,
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
    allowHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-Requested-With'],
    exposeHeaders: ['Content-Type'],
    credentials: false,
    maxAge: 600,
  });
}
