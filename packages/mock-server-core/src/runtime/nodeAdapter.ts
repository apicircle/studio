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

// Hard cap on how long we'll wait for a graceful close before treating the
// server as stopped anyway. Node's `http.Server.close()` resolves only after
// every open connection has ended — browsers hold keep-alive sockets open for
// minutes after the last response, so without intervention `stop()` looks
// like it hangs forever from the user's perspective. We force-drop sockets
// (closeAllConnections / closeIdleConnections) before awaiting; the timeout
// is the belt-and-braces fallback if a socket somehow refuses to die.
const CLOSE_TIMEOUT_MS = 3_000;

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
      new Promise<void>((resolve) => {
        if (!server) return resolve();
        const s = server;
        // Force-drop every open socket (active + idle) before awaiting the
        // close callback. Node ≥18.2 exposes these as first-class APIs;
        // typed loosely here because @hono/node-server's ServerType union
        // doesn't include them.
        const withCloseHelpers = s as ServerType & {
          closeAllConnections?: () => void;
          closeIdleConnections?: () => void;
        };
        try {
          withCloseHelpers.closeIdleConnections?.();
          withCloseHelpers.closeAllConnections?.();
        } catch {
          // Best-effort: if a helper throws (older Node, exotic transport),
          // we still rely on the timeout below to bound the wait.
        }
        let settled = false;
        const settle = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve();
        };
        const timer = setTimeout(settle, CLOSE_TIMEOUT_MS);
        s.close(() => settle());
      }),
  };
}
