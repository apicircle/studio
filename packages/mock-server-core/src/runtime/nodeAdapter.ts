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

/**
 * Thrown by `serveOnNode` when the requested port is invalid (non-integer,
 * negative, > 65535) OR the OS refuses to bind it (EADDRINUSE / EACCES /
 * EADDRNOTAVAIL). Carries `port`, `host`, and an OS-level `code` so the
 * UI / CLI / VS Code surfaces can render an actionable message instead of
 * Node's raw `listen EADDRINUSE …` line.
 *
 * `code` values you'll see in practice:
 *   • `EADDRINUSE`    — another process already owns the port
 *   • `EACCES`        — usually a port below 1024 without privileges
 *   • `EADDRNOTAVAIL` — host string doesn't resolve to a local interface
 *   • `INVALID_PORT`  — caller passed something that isn't a 1-65535 integer
 */
export class MockServerStartError extends Error {
  readonly code: string;
  readonly port: number;
  readonly host: string;
  constructor(opts: { code: string; port: number; host: string; message: string }) {
    super(opts.message);
    this.name = 'MockServerStartError';
    this.code = opts.code;
    this.port = opts.port;
    this.host = opts.host;
  }
}

function explainBindError(code: string, port: number, host: string): string {
  switch (code) {
    case 'EADDRINUSE':
      return `Port ${port} on ${host} is already in use. Stop the other process or pick a different port.`;
    case 'EACCES':
      return `Permission denied binding to port ${port} on ${host}. Ports below 1024 usually require elevated privileges — pick a port in 1024–65535.`;
    case 'EADDRNOTAVAIL':
      return `Cannot bind to ${host}:${port} — that address is not available on this machine.`;
    default:
      return `Failed to bind ${host}:${port} (${code}).`;
  }
}

export async function serveOnNode(app: Hono, opts: ServeOptions = {}): Promise<MockServerHandle> {
  const host = opts.host ?? '127.0.0.1';
  // `port: 0` (or absent) means "OS picks a free port" — we resolve that
  // up-front via getFreePort so the returned handle can report the actual
  // bound port. Any explicit port goes through validation first so we
  // throw a clean MockServerStartError instead of crashing inside
  // @hono/node-server with a raw RangeError.
  let port: number;
  if (opts.port === undefined || opts.port === 0) {
    port = await getFreePort();
  } else {
    if (!Number.isInteger(opts.port) || opts.port < 1 || opts.port > 65535) {
      throw new MockServerStartError({
        code: 'INVALID_PORT',
        port: opts.port,
        host,
        message: `Invalid port ${String(opts.port)} — must be an integer between 1 and 65535.`,
      });
    }
    port = opts.port;
  }

  let server: ServerType | null = null;
  await new Promise<void>((resolve, reject) => {
    const wrapError = (err: unknown) => {
      const candidate = err && typeof err === 'object' && 'code' in err ? err.code : undefined;
      const code = typeof candidate === 'string' ? candidate : 'UNKNOWN';
      reject(
        new MockServerStartError({
          code,
          port,
          host,
          message: explainBindError(code, port, host),
        }),
      );
    };
    try {
      server = serve(
        {
          fetch: app.fetch,
          port,
          hostname: host,
        },
        () => resolve(),
      );
      server.on('error', wrapError);
    } catch (err) {
      wrapError(err);
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
