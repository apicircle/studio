// Streaming endpoints. Two kinds:
//
//   GET /stream/sse?count=N   text/event-stream with N events @ 100ms each
//   GET /stream/chunks?n=N    chunked transfer-encoded text; N json chunks
//   GET /stream/large?bytes=N application/octet-stream with N random bytes
//
// All cap their counts to keep tests bounded.

import { Hono } from 'hono';

const MAX_EVENTS = 50;
const MAX_BYTES = 1024 * 1024; // 1 MB

export function buildStreamingRoutes(): Hono {
  const app = new Hono();

  app.get('/stream/sse', (c) => {
    const count = Math.min(
      Math.max(1, Number.parseInt(c.req.query('count') ?? '5', 10) || 5),
      MAX_EVENTS,
    );
    const interval = Math.min(
      Math.max(0, Number.parseInt(c.req.query('intervalMs') ?? '100', 10) || 100),
      1000,
    );
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const enc = new TextEncoder();
        try {
          for (let i = 0; i < count; i++) {
            const ev = `event: tick\ndata: ${JSON.stringify({ index: i, ts: Date.now() })}\n\n`;
            controller.enqueue(enc.encode(ev));
            if (i < count - 1) await new Promise((r) => setTimeout(r, interval));
          }
          controller.enqueue(enc.encode('event: done\ndata: {}\n\n'));
        } finally {
          controller.close();
        }
      },
    });
    return new Response(stream, {
      status: 200,
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        'x-accel-buffering': 'no',
      },
    });
  });

  app.get('/stream/chunks', (c) => {
    const count = Math.min(
      Math.max(1, Number.parseInt(c.req.query('n') ?? '5', 10) || 5),
      MAX_EVENTS,
    );
    const interval = Math.min(
      Math.max(0, Number.parseInt(c.req.query('intervalMs') ?? '50', 10) || 50),
      1000,
    );
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const enc = new TextEncoder();
        try {
          for (let i = 0; i < count; i++) {
            controller.enqueue(enc.encode(JSON.stringify({ index: i }) + '\n'));
            if (i < count - 1) await new Promise((r) => setTimeout(r, interval));
          }
        } finally {
          controller.close();
        }
      },
    });
    return new Response(stream, {
      status: 200,
      headers: {
        'content-type': 'application/x-ndjson',
        'transfer-encoding': 'chunked',
      },
    });
  });

  app.get('/stream/large', (c) => {
    const bytes = Math.min(
      Math.max(1, Number.parseInt(c.req.query('bytes') ?? '4096', 10) || 4096),
      MAX_BYTES,
    );
    const chunkSize = 4096;
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= bytes) {
          controller.close();
          return;
        }
        const remaining = bytes - sent;
        const size = Math.min(chunkSize, remaining);
        // Deterministic payload: byte n = n % 256.
        const chunk = new Uint8Array(size);
        for (let i = 0; i < size; i++) chunk[i] = (sent + i) & 0xff;
        controller.enqueue(chunk);
        sent += size;
      },
    });
    return new Response(stream, {
      status: 200,
      headers: {
        'content-type': 'application/octet-stream',
        'content-length': String(bytes),
      },
    });
  });

  return app;
}
