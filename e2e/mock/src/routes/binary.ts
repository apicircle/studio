// Returns a known binary payload. Tests assert byte equality + the
// response viewer's "binary body" rendering path.

import { Hono } from 'hono';

export const BINARY_PAYLOAD = new Uint8Array([
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a, // PNG signature
  ...Array.from({ length: 56 }, (_v, i) => i & 0xff), // 56 bytes of varying values
]);

export function buildBinaryRoutes(): Hono {
  const app = new Hono();
  app.get('/binary', (_c) => {
    return new Response(BINARY_PAYLOAD, {
      status: 200,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(BINARY_PAYLOAD.byteLength),
      },
    });
  });
  return app;
}
