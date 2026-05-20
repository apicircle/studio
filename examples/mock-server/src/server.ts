// Plan §10.1 — mock backend for the demo workspace + Playwright fixtures.
// Every endpoint here corresponds to a request in examples/demo-workspace.
// No external services, no DB — just enough state to exercise CRUD,
// auth, slow paths, and error codes deterministically.

import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { createHash } from 'node:crypto';

const app = new Hono();

interface User {
  id: number;
  name: string;
  email: string;
  createdAt: string;
}

let nextUserId = 4;
const users: Map<number, User> = new Map([
  [
    1,
    { id: 1, name: 'Ada Lovelace', email: 'ada@example.test', createdAt: '2026-01-01T00:00:00Z' },
  ],
  [
    2,
    { id: 2, name: 'Alan Turing', email: 'alan@example.test', createdAt: '2026-01-02T00:00:00Z' },
  ],
  [
    3,
    { id: 3, name: 'Grace Hopper', email: 'grace@example.test', createdAt: '2026-01-03T00:00:00Z' },
  ],
]);

const BEARER_TOKEN = process.env.MOCK_BEARER_TOKEN ?? 'demo-bearer-token';

// CORS — the renderer (web app + Playwright) lives on a different port.
app.use('*', async (c, next) => {
  await next();
  c.header('Access-Control-Allow-Origin', '*');
  c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  c.header('Access-Control-Allow-Headers', 'content-type, authorization');
});
app.options('*', (c) => c.body(null, 204));

// --- smoke / health -------------------------------------------------------

app.get('/health', (c) => c.json({ ok: true, ts: new Date().toISOString() }));

// --- /users CRUD ----------------------------------------------------------

app.get('/users', (c) => {
  const limit = Number(c.req.query('limit') ?? '10');
  return c.json({
    items: [...users.values()].slice(0, limit),
    total: users.size,
  });
});

app.get('/users/:id', (c) => {
  const id = Number(c.req.param('id'));
  const user = users.get(id);
  if (!user) return c.json({ message: 'Not Found' }, 404);
  return c.json(user);
});

app.post('/users', async (c) => {
  const body = (await c.req.json().catch(() => null)) as { name?: string; email?: string } | null;
  if (!body || typeof body.name !== 'string' || typeof body.email !== 'string') {
    return c.json({ message: 'name + email required' }, 422);
  }
  const id = nextUserId++;
  const created: User = {
    id,
    name: body.name,
    email: body.email,
    createdAt: new Date().toISOString(),
  };
  users.set(id, created);
  c.header('Location', `/users/${id}`);
  return c.json(created, 201);
});

app.put('/users/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!users.has(id)) return c.json({ message: 'Not Found' }, 404);
  const body = (await c.req.json().catch(() => null)) as { name?: string; email?: string } | null;
  if (!body || typeof body.name !== 'string' || typeof body.email !== 'string') {
    return c.json({ message: 'name + email required' }, 422);
  }
  const existing = users.get(id);
  if (!existing) return c.json({ message: 'Not Found' }, 404);
  const updated: User = { ...existing, name: body.name, email: body.email };
  users.set(id, updated);
  return c.json(updated);
});

app.patch('/users/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const existing = users.get(id);
  if (!existing) return c.json({ message: 'Not Found' }, 404);
  const body = (await c.req.json().catch(() => null)) as Partial<User> | null;
  const updated: User = { ...existing, ...(body ?? {}) };
  users.set(id, updated);
  return c.json(updated);
});

app.delete('/users/:id', (c) => {
  const id = Number(c.req.param('id'));
  if (!users.has(id)) return c.json({ message: 'Not Found' }, 404);
  users.delete(id);
  return c.body(null, 204);
});

// --- forms ----------------------------------------------------------------

app.post('/forms/text', async (c) => {
  const form = await c.req.formData();
  const out: Record<string, string> = {};
  for (const [k, v] of form.entries()) {
    if (typeof v === 'string') out[k] = v;
  }
  return c.json({ received: out });
});

app.post('/forms/multipart', async (c) => {
  const form = await c.req.formData();
  const fields: Record<string, string> = {};
  let fileSha: string | null = null;
  let fileName: string | null = null;
  let fileSize = 0;
  for (const [k, v] of form.entries()) {
    if (typeof v === 'string') {
      fields[k] = v;
    } else {
      const ab = await v.arrayBuffer();
      fileSha = createHash('sha256').update(Buffer.from(ab)).digest('hex');
      fileName = v.name;
      fileSize = ab.byteLength;
    }
  }
  return c.json({ fields, file: { name: fileName, sha256: fileSha, size: fileSize } });
});

// --- binary --------------------------------------------------------------

app.post('/binary/upload', async (c) => {
  const ab = await c.req.arrayBuffer();
  return c.json({
    contentType: c.req.header('content-type') ?? null,
    size: ab.byteLength,
    sha256: createHash('sha256').update(Buffer.from(ab)).digest('hex'),
  });
});

// --- auth -----------------------------------------------------------------

app.get('/auth/protected', (c) => {
  const auth = c.req.header('authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return c.json({ message: 'missing bearer' }, 401);
  const token = auth.slice('Bearer '.length);
  if (token !== BEARER_TOKEN) return c.json({ message: 'invalid bearer' }, 403);
  return c.json({ ok: true, user: 'demo' });
});

// --- slow / headers / json-tree / error / graphql ------------------------

app.get('/slow', async (c) => {
  const ms = Math.min(Math.max(Number(c.req.query('ms') ?? '0'), 0), 5_000);
  await new Promise((resolve) => setTimeout(resolve, ms));
  return c.json({ slept: ms });
});

app.get('/echo-headers', (c) => {
  const out: Record<string, string> = {};
  c.req.raw.headers.forEach((v, k) => {
    out[k] = v;
  });
  return c.json({ headers: out });
});

app.get('/json-tree', (c) =>
  c.json({
    org: {
      name: 'API Circle',
      teams: [
        { id: 't-1', name: 'Platform', members: 4 },
        { id: 't-2', name: 'Frontend', members: 3 },
      ],
    },
    flags: { darkMode: true, beta: false },
  }),
);

app.get('/error/:code', (c) => {
  const code = Number(c.req.param('code'));
  const safe = code >= 100 && code <= 599 ? code : 500;
  return c.json({ message: `error ${safe}` }, safe as 400);
});

app.post('/graphql', async (c) => {
  const body = (await c.req.json().catch(() => null)) as { query?: string } | null;
  if (!body || typeof body.query !== 'string') {
    return c.json({ errors: [{ message: 'query required' }] }, 400);
  }
  // Trivial resolver — only `greeting` is supported, anything else returns
  // a typed error like a real GraphQL endpoint.
  if (body.query.includes('greeting')) {
    return c.json({ data: { greeting: 'hello from mock-server' } });
  }
  return c.json({ data: null, errors: [{ message: 'unknown field' }] });
});

// --- bootstrap ------------------------------------------------------------

const port = Number(process.env.PORT ?? '4040');

// Autostart is opt-in so importing the app for tests doesn't bind a
// real port. The `start` / `dev` scripts pass MOCK_SERVER_AUTOSTART=true.
if (process.env.MOCK_SERVER_AUTOSTART === 'true') {
  serve({ fetch: app.fetch, port }, (info) => {
    // eslint-disable-next-line no-console
    console.log(`mock-server listening on http://localhost:${info.port}`);
  });
}

export { app };
