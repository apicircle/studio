// Public API for @apicircle/mock-server-core (Node entry point).
//
// The engine is split into:
//   • Parsers (OpenAPI / Postman / Insomnia → MockEndpoint[])
//   • Router builder (MockServer → Hono app, with per-endpoint overrides)
//   • Node runtime adapter (Hono app → live HTTP server)
//
// Consumers (Desktop main / CLI / MCP / VS Code host / future hosted) call
// `parseSourceToEndpoints` once when a MockServer is created or refreshed,
// then `startMockServer` every time the user clicks Start. This entry uses
// swagger-parser for full external-`$ref` resolution; browser/renderer code
// imports the `@apicircle/mock-server-core/parsing` subpath instead, which
// resolves in-document refs only and never pulls in the Node runtime.

import type { MockServer, MockServerSource } from '@apicircle/shared';
import type { Hono } from 'hono';
import { parseOpenApiToEndpointsNode } from './parsers/openapiNode';
import { parseSourceToEndpointsWith, type ParseSourceResult } from './parsing';
import { buildRouter, type BuildRouterOptions } from './handlers/buildRouter';
import { serveOnNode, type MockServerHandle, type ServeOptions } from './runtime/nodeAdapter';

export type { MockServerHandle, ServeOptions } from './runtime/nodeAdapter';
export { MockServerStartError } from './runtime/nodeAdapter';
export type { BuildRouterOptions } from './handlers/buildRouter';
export { openApiPathToHono } from './handlers/buildRouter';
// The Node entry exposes the swagger-parser-backed OpenAPI parser as the
// canonical `parseOpenApiToEndpoints` so CLI / MCP consumers get full
// external-reference resolution.
export { parseOpenApiToEndpointsNode as parseOpenApiToEndpoints } from './parsers/openapiNode';
export { parsePostmanToEndpoints } from './parsers/postman';
export { parseInsomniaToEndpoints } from './parsers/insomnia';
export { schemaToExample } from './faker/schemaToExample';
export { dereferenceInternal } from './parsers/refDeref';
export type { ParseSourceResult } from './parsing';
export { getFreePort, isPortFree } from './runtime/portFinder';
export { buildRouter };

/**
 * Dispatch the right parser for a `MockServerSource` (Node — full `$ref`
 * resolution via swagger-parser). Returns the resolved `MockEndpoint[]`
 * along with any non-fatal warnings. The caller persists `endpoints` onto
 * `MockServer.endpoints`.
 */
export function parseSourceToEndpoints(source: MockServerSource): Promise<ParseSourceResult> {
  return parseSourceToEndpointsWith(source, (spec, format) =>
    parseOpenApiToEndpointsNode(spec, format),
  );
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
