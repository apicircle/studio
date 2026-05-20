import { describe, expect, it } from 'vitest';
import { app } from './server';

// Hono apps expose `.fetch` which lets us invoke routes without binding
// to a port. Plan §10.3 wants integration coverage — these tests poke
// every endpoint that the demo workspace's requests target so a renamed
// route or a broken handler fails CI rather than the Playwright suite.

async function get(path: string, init: RequestInit = {}) {
  return app.fetch(new Request(`http://test${path}`, { method: 'GET', ...init }));
}

async function postJson(path: string, body: unknown, init: RequestInit = {}) {
  return app.fetch(
    new Request(`http://test${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      ...init,
    }),
  );
}

describe('mock-server', () => {
  it('GET /health → ok', async () => {
    const res = await get('/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it('GET /users → paginated, default limit', async () => {
    const res = await get('/users?limit=2');
    const body = (await res.json()) as { items: unknown[]; total: number };
    expect(body.items).toHaveLength(2);
    expect(body.total).toBeGreaterThanOrEqual(2);
  });

  it('GET /users/:id → 404 on unknown', async () => {
    const res = await get('/users/9999');
    expect(res.status).toBe(404);
  });

  it('POST /users → 201 + Location header', async () => {
    const res = await postJson('/users', { name: 'X', email: 'x@y' });
    expect(res.status).toBe(201);
    expect(res.headers.get('Location')).toMatch(/^\/users\/\d+$/);
    const body = (await res.json()) as { id: number; name: string };
    expect(body.name).toBe('X');
  });

  it('POST /users → 422 when fields missing', async () => {
    const res = await postJson('/users', { name: 'X' });
    expect(res.status).toBe(422);
  });

  it('PUT/PATCH/DELETE /users/:id → CRUD round-trip', async () => {
    const created = (await (await postJson('/users', { name: 'A', email: 'a@b' })).json()) as {
      id: number;
    };
    const id = created.id;

    const put = await app.fetch(
      new Request(`http://test/users/${id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'A2', email: 'a2@b' }),
      }),
    );
    expect(put.status).toBe(200);
    expect(((await put.json()) as { name: string }).name).toBe('A2');

    const patch = await app.fetch(
      new Request(`http://test/users/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'patched@b' }),
      }),
    );
    expect(((await patch.json()) as { email: string }).email).toBe('patched@b');

    const del = await app.fetch(new Request(`http://test/users/${id}`, { method: 'DELETE' }));
    expect(del.status).toBe(204);
    const after = await get(`/users/${id}`);
    expect(after.status).toBe(404);
  });

  it('GET /auth/protected → 401 without bearer, 200 with the right one', async () => {
    expect((await get('/auth/protected')).status).toBe(401);
    expect(
      (await get('/auth/protected', { headers: { authorization: 'Bearer wrong' } })).status,
    ).toBe(403);
    expect(
      (await get('/auth/protected', { headers: { authorization: 'Bearer demo-bearer-token' } }))
        .status,
    ).toBe(200);
  });

  it('GET /slow respects the ms parameter', async () => {
    const t0 = Date.now();
    await get('/slow?ms=50');
    expect(Date.now() - t0).toBeGreaterThanOrEqual(40);
  });

  it('GET /echo-headers reflects the request headers', async () => {
    const res = await get('/echo-headers', { headers: { 'x-trace': 'abc' } });
    const body = (await res.json()) as { headers: Record<string, string> };
    expect(body.headers['x-trace']).toBe('abc');
  });

  it('GET /json-tree returns nested data for json-path assertions', async () => {
    const body = (await (await get('/json-tree')).json()) as {
      org: { teams: unknown[] };
    };
    expect(body.org.teams).toHaveLength(2);
  });

  it('GET /error/:code passes through the requested status', async () => {
    expect((await get('/error/418')).status).toBe(418);
    expect((await get('/error/503')).status).toBe(503);
    // Out-of-range codes coerce to 500.
    expect((await get('/error/9999')).status).toBe(500);
  });

  it('POST /graphql resolves greeting and errors on unknown fields', async () => {
    const ok = (await (await postJson('/graphql', { query: '{ greeting }' })).json()) as {
      data: { greeting: string };
    };
    expect(ok.data.greeting).toMatch(/hello/);
    const err = (await (await postJson('/graphql', { query: '{ noSuchField }' })).json()) as {
      errors: { message: string }[];
    };
    expect(err.errors[0]?.message).toMatch(/unknown/);
  });

  it('POST /binary/upload reports size + sha256 of the body', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const res = await app.fetch(
      new Request('http://test/binary/upload', {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        body: bytes,
      }),
    );
    const body = (await res.json()) as { size: number; sha256: string };
    expect(body.size).toBe(5);
    expect(body.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});
