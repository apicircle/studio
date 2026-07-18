// Shared conventions for promoting mock endpoints into runnable collection
// requests. Kept here (pure, types-only) so every surface — the web/desktop
// store, the MCP server, and the VS Code extension — produces IDENTICAL env
// variables, folder names, URL templates, and request shapes. Change the
// convention once, here, and all three stay in lockstep.

import type { MockEndpoint } from './mock';
import type { Request as ApiRequest } from './types';

/** Name of the shared environment that holds the mock host + port. */
export const MOCK_ENV_NAME = 'Mock';

/**
 * URL prefix a promoted request targets: `{{MOCK_BASE_URL}}:{{MOCK_PORT}}<path>`
 * resolves against the {@link MOCK_ENV_NAME} environment at run time.
 */
export const MOCK_URL_PREFIX = '{{MOCK_BASE_URL}}:{{MOCK_PORT}}';

/**
 * The `MOCK_BASE_URL` + `MOCK_PORT` variable defaults as `[key, value]` pairs.
 * `MOCK_PORT` prefills from the mock server's port, falling back to `8080` when
 * none is set. Callers add these only when a variable is missing so re-promoting
 * never clobbers values the user has edited.
 */
export function mockEnvVarDefaults(port: number | null): Array<[string, string]> {
  return [
    ['MOCK_BASE_URL', 'http://localhost'],
    ['MOCK_PORT', String(port ?? 8080)],
  ];
}

/** The folder that groups a mock's promoted requests: `"<mockName> (mock)"`. */
export function mockFolderName(mockName: string): string {
  return `${mockName} (mock)`;
}

/**
 * Map a {@link MockEndpoint} to the request fields a promoted (or OpenAPI-
 * imported) request carries: method + templated URL + request-schema params as
 * disabled/empty rows the user fills in. `urlPrefix` is prepended to the path so
 * a promoted request targets the live mock; pass `''` for a bare-path shape.
 */
export function requestShapeFromMockEndpoint(
  ep: MockEndpoint,
  urlPrefix = '',
): Pick<ApiRequest, 'method' | 'url' | 'query' | 'headers' | 'pathParams'> {
  return {
    method: ep.method,
    url: `${urlPrefix}${ep.pathPattern}`,
    query: ep.requestSchema.queryParams.map((p) => ({
      key: p.name,
      value: p.example != null ? String(p.example) : '',
      enabled: false,
    })),
    headers: ep.requestSchema.headers.map((p) => ({ key: p.name, value: '', enabled: false })),
    pathParams: Object.fromEntries(ep.requestSchema.pathParams.map((p) => [p.name, ''])),
  };
}
