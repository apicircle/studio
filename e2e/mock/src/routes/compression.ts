// Compression endpoints. Returns a fixed JSON payload encoded with the
// requested algorithm. The browser transparently decompresses based on
// Content-Encoding, so e2e tests assert the wire byte count + the
// decoded body's shape via the response panel.

import { Hono } from 'hono';
import { gzipSync, deflateSync, brotliCompressSync } from 'node:zlib';

const PAYLOAD = JSON.stringify({
  hello: 'world',
  // 256 chars of filler so the compression ratio is observable on the wire.
  filler: 'abcdefghijklmnopqrstuvwxyz'.repeat(10),
});

const PAYLOAD_BYTES = new TextEncoder().encode(PAYLOAD);

function buildResponse(body: Buffer, encoding: string): Response {
  // zlib's sync helpers return Buffer, which is a Uint8Array subclass.
  // The DOM lib's BodyInit accepts BufferSource (ArrayBufferView), so
  // we copy into a fresh Uint8Array view to land on the typed path.
  const ab = new ArrayBuffer(body.byteLength);
  new Uint8Array(ab).set(body);
  return new Response(ab, {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'content-encoding': encoding,
      'content-length': String(body.byteLength),
      'x-original-size': String(PAYLOAD_BYTES.byteLength),
    },
  });
}

export function buildCompressionRoutes(): Hono {
  const app = new Hono();

  app.get('/gzip', () => buildResponse(gzipSync(PAYLOAD), 'gzip'));
  app.get('/deflate', () => buildResponse(deflateSync(PAYLOAD), 'deflate'));
  app.get('/brotli', () => buildResponse(brotliCompressSync(PAYLOAD), 'br'));
  // Alias matching the workbook's `/br` shorthand.
  app.get('/br', () => buildResponse(brotliCompressSync(PAYLOAD), 'br'));

  // identity: no encoding, raw bytes. Useful as a control case.
  app.get('/identity', () => {
    return new Response(PAYLOAD, {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'content-length': String(PAYLOAD_BYTES.byteLength),
      },
    });
  });

  return app;
}
