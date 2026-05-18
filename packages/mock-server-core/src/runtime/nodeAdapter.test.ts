import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { serveOnNode } from './nodeAdapter';

describe('serveOnNode', () => {
  it('boots an app on a free port and serves requests', async () => {
    const app = new Hono();
    app.get('/health', (c) => c.json({ ok: true }));
    const handle = await serveOnNode(app);
    try {
      const res = await fetch(`http://127.0.0.1:${handle.port}/health`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
    } finally {
      await handle.close();
    }
  });

  it('binds the requested port when explicit', async () => {
    const app = new Hono();
    app.get('/x', (c) => c.text('y'));
    const handle = await serveOnNode(app, { port: 0 });
    try {
      expect(handle.port).toBeGreaterThan(0);
    } finally {
      await handle.close();
    }
  });

  it('errors when the requested port is already in use', async () => {
    const app1 = new Hono();
    app1.get('/x', (c) => c.text('first'));
    const handle = await serveOnNode(app1);
    try {
      const app2 = new Hono();
      app2.get('/x', (c) => c.text('second'));
      await expect(serveOnNode(app2, { port: handle.port })).rejects.toThrow();
    } finally {
      await handle.close();
    }
  });

  it('honors a custom hostname', async () => {
    const app = new Hono();
    app.get('/x', (c) => c.text('y'));
    const handle = await serveOnNode(app, { host: '127.0.0.1' });
    try {
      const res = await fetch(`http://127.0.0.1:${handle.port}/x`);
      expect(await res.text()).toBe('y');
    } finally {
      await handle.close();
    }
  });
});
