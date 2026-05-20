// Node.js runtime adapter. Wraps `@hono/node-server`'s `serve()` so the
// public API can return a typed `MockServerHandle` regardless of the
// underlying transport (Node / Bun / Workers).

import { serve, type ServerType } from '@hono/node-server';
import type { Hono } from 'hono';
import { getFreePort } from './portFinder';

export interface MockServerHandle {
  port: number;
  /** Stop the server. Resolves once the listener is closed. */
  close: () => Promise<void>;
}

export interface ServeOptions {
  /** Use this port; if undefined or 0, pick a free port via portFinder. */
  port?: number;
  /** Bind address. Default `127.0.0.1` so the server isn't internet-exposed. */
  host?: string;
}

export async function serveOnNode(app: Hono, opts: ServeOptions = {}): Promise<MockServerHandle> {
  const port = opts.port && opts.port > 0 ? opts.port : await getFreePort();
  const host = opts.host ?? '127.0.0.1';

  let server: ServerType | null = null;
  await new Promise<void>((resolve, reject) => {
    try {
      server = serve(
        {
          fetch: app.fetch,
          port,
          hostname: host,
        },
        () => resolve(),
      );
      server.on('error', reject);
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });

  return {
    port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        if (!server) return resolve();
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      }),
  };
}
