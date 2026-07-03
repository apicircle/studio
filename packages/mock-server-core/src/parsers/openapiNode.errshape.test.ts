import { describe, expect, it, vi } from 'vitest';

// Force swagger-parser to reject with a NON-Error value so the
// `err instanceof Error ? err.message : 'unknown error'` fallback branch in
// `swaggerDereference` is exercised. Isolated in its own file because the
// module mock is hoisted for the whole file.
vi.mock('@apidevtools/swagger-parser', () => ({
  default: { dereference: vi.fn().mockRejectedValue('not-an-error') },
}));

import { parseOpenApiToEndpointsNode } from './openapiNode';

describe('parseOpenApiToEndpointsNode — non-Error dereference failure', () => {
  it('reports "unknown error" and falls back to in-document resolution', async () => {
    const spec = JSON.stringify({
      openapi: '3.0.0',
      info: { title: 'P', version: '1.0.0' },
      paths: {
        '/x': {
          get: {
            responses: { '200': { content: { 'application/json': { example: { ok: 1 } } } } },
          },
        },
      },
    });
    const { endpoints, warnings } = await parseOpenApiToEndpointsNode(spec, 'json');
    expect(endpoints).toHaveLength(1);
    expect(warnings.some((w) => w.includes('unknown error'))).toBe(true);
  });
});
