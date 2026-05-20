// Public API for @apicircle/mock-server-core.
//
// The engine is split into:
//   • Parsers (OpenAPI / Postman / Insomnia → MockEndpoint[])
//   • Router builder (MockServer → Hono app, with per-endpoint overrides)
//   • Node runtime adapter (Hono app → live HTTP server)
//
// Consumers (Desktop / CLI / future hosted) call `parseSourceToEndpoints`
// once when a MockServer is created or refreshed, then `startMockServer`
// every time the user clicks Start.

import type { MockServer, MockServerSource, MockEndpoint } from '@apicircle/shared';
import type { Hono } from 'hono';
import { parseOpenApiToEndpoints } from './parsers/openapi';
import { parsePostmanToEndpoints } from './parsers/postman';
import { parseInsomniaToEndpoints } from './parsers/insomnia';
import { buildRouter, type BuildRouterOptions } from './handlers/buildRouter';
import { serveOnNode, type MockServerHandle, type ServeOptions } from './runtime/nodeAdapter';

export type { MockServerHandle, ServeOptions } from './runtime/nodeAdapter';
export type { BuildRouterOptions } from './handlers/buildRouter';
export { openApiPathToHono } from './handlers/buildRouter';
export { parseOpenApiToEndpoints } from './parsers/openapi';
export { parsePostmanToEndpoints } from './parsers/postman';
export { parseInsomniaToEndpoints } from './parsers/insomnia';
export { schemaToExample } from './faker/schemaToExample';
export { getFreePort, isPortFree } from './runtime/portFinder';
export { buildRouter };

export interface ParseSourceResult {
  endpoints: MockEndpoint[];
  warnings: string[];
}

/**
 * Dispatch the right parser for a `MockServerSource`. Returns the
 * resolved `MockEndpoint[]` along with any non-fatal warnings the
 * parser surfaced. The caller persists `endpoints` onto
 * `MockServer.endpoints`.
 */
export async function parseSourceToEndpoints(source: MockServerSource): Promise<ParseSourceResult> {
  switch (source.kind) {
    case 'openapi':
      return parseOpenApiToEndpoints(source.spec, source.format);
    case 'postman':
      return parsePostmanToEndpoints(source.collection);
    case 'insomnia':
      return parseInsomniaToEndpoints(source.export);
    case 'manual':
      return { endpoints: source.endpoints, warnings: [] };
  }
}

/**
 * Build a Hono app for an in-memory MockServer without binding a port.
 * Useful for tests and for hosted/edge transports that bring their own
 * server.
 */
export function createMockApp(server: MockServer, opts: BuildRouterOptions = {}): Hono {
  return buildRouter(server, opts);
}

/**
 * Start a mock server on Node. Picks a free port when
 * `MockServer.defaultPort` is null or `opts.port` is omitted; otherwise
 * uses the requested port and errors if it's busy.
 */
export async function startMockServer(
  server: MockServer,
  opts: { port?: number; host?: string; onRequest?: BuildRouterOptions['onRequest'] } = {},
): Promise<MockServerHandle> {
  const app = createMockApp(server, { onRequest: opts.onRequest });
  const desired: ServeOptions = {
    host: opts.host,
    port: opts.port ?? server.defaultPort ?? undefined,
  };
  return serveOnNode(app, desired);
}

/** Convenience: stop a previously-started server. */
export async function stopMockServer(handle: MockServerHandle): Promise<void> {
  return handle.close();
}
