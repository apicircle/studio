import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { buildCors } from './cors';

describe('buildCors', () => {
  it('returns null when CORS is disabled', () => {
    expect(buildCors({ enabled: false, origins: [] })).toBeNull();
    expect(buildCors({ enabled: false, origins: ['x'] })).toBeNull();
  });

  it('returns null when enabled but origins are empty (same-origin only — never silently wildcard)', () => {
    expect(buildCors({ enabled: true, origins: [] })).toBeNull();
  });

  it('responds to OPTIONS preflight when at least one origin is listed', async () => {
    const middleware = buildCors({ enabled: true, origins: ['https://example.com'] });
    expect(middleware).not.toBeNull();
    const app = new Hono();
    app.use('*', middleware!);
    app.get('/x', (c) => c.text('ok'));
    const res = await app.request('/x', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://example.com',
        'Access-Control-Request-Method': 'GET',
      },
    });
    expect(res.headers.get('access-control-allow-methods')).toContain('GET');
  });

  it('honors an explicit origins list', async () => {
    const middleware = buildCors({
      enabled: true,
      origins: ['http://localhost:5174', 'https://example.com'],
    });
    expect(middleware).not.toBeNull();
    const app = new Hono();
    app.use('*', middleware!);
    app.get('/x', (c) => c.text('ok'));
    const res = await app.request('/x', { headers: { Origin: 'https://example.com' } });
    expect(res.headers.get('access-control-allow-origin')).toBe('https://example.com');
  });
});
