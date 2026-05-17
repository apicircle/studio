// Long-hold endpoint. Like /delay, but holds the connection open until
// either `ms` elapses or the client aborts. Tests that want to assert
// abort/cancel semantics use this — /delay's await pauses the route
// handler so the request never actually streams, while /hold drives a
// real ReadableStream that responds to backpressure + cancel signals.
//
//   GET /hold?ms=N    Holds the response for N ms, then responds with
//                     `{ heldMs: N }`. ms capped at 30s. If the client
//                     aborts before then, the stream cancels cleanly.

import { Hono } from 'hono';

const MAX_HOLD_MS = 30_000;

export function buildHoldRoutes(): Hono {
  const app = new Hono();

  app.get('/hold', (c) => {
    const ms = Math.min(
      Math.max(0, Number.parseInt(c.req.query('ms') ?? '1000', 10) || 0),
      MAX_HOLD_MS,
    );
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const enc = new TextEncoder();
        try {
          // Trickle a single space byte every 200ms so the response is
          // active from the wire's perspective; finalize with JSON.
          const chunks = Math.max(1, Math.floor(ms / 200));
          for (let i = 0; i < chunks; i++) {
            controller.enqueue(enc.encode(' '));
            await new Promise((r) => setTimeout(r, 200));
          }
          controller.enqueue(enc.encode(JSON.stringify({ heldMs: ms })));
        } finally {
          controller.close();
        }
      },
    });
    return new Response(stream, {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      },
    });
  });

  return app;
}
