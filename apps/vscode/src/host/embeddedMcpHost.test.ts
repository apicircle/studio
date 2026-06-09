import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as http from 'node:http';
import {
  assertLoopbackBindHost,
  UnsafeBindHostError,
  EmbeddedMcpHost,
  LOOPBACK_HOSTS,
} from './embeddedMcpHost';
import type { VsCodeBridge } from './vscodeBridge';

// Minimal bridge stub — embedded host only needs activeWorkspace() during
// the request handling path. The security guards run BEFORE any tool call,
// so the smoke tests below never reach into the workspace provider.
function makeFakeBridge(): VsCodeBridge {
  return {
    activeWorkspace: () => null,
    listWorkspaces: () => [],
    onDidChangeActiveWorkspace: () => ({ dispose: () => undefined }),
    dispose: vi.fn(),
  } as unknown as VsCodeBridge;
}

function fetchOnce(
  url: string,
  init: { headers?: Record<string, string> } = {},
): Promise<{
  statusCode: number;
  body: string;
  headers: http.IncomingHttpHeaders;
}> {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: 'GET', headers: init.headers ?? {} }, (res) => {
      let body = '';
      res.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')));
      res.on('end', () => resolve({ statusCode: res.statusCode ?? 0, body, headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('assertLoopbackBindHost', () => {
  it('accepts 127.0.0.1', () => {
    expect(assertLoopbackBindHost('127.0.0.1')).toBe('127.0.0.1');
  });

  it('accepts localhost', () => {
    expect(assertLoopbackBindHost('localhost')).toBe('localhost');
  });

  it('accepts ::1', () => {
    expect(assertLoopbackBindHost('::1')).toBe('::1');
  });

  it('accepts any 127.x.y.z (whole /8 block)', () => {
    expect(assertLoopbackBindHost('127.0.0.2')).toBe('127.0.0.2');
    expect(assertLoopbackBindHost('127.255.255.1')).toBe('127.255.255.1');
  });

  it('accepts ::1 with brackets stripped', () => {
    expect(assertLoopbackBindHost('[::1]')).toBe('::1');
  });

  it('rejects 0.0.0.0', () => {
    expect(() => assertLoopbackBindHost('0.0.0.0')).toThrow(UnsafeBindHostError);
  });

  it('rejects a public IP', () => {
    expect(() => assertLoopbackBindHost('8.8.8.8')).toThrow(UnsafeBindHostError);
  });

  it('rejects an external hostname', () => {
    expect(() => assertLoopbackBindHost('example.com')).toThrow(UnsafeBindHostError);
  });

  it('rejects 192.168.x.x (private but non-loopback)', () => {
    expect(() => assertLoopbackBindHost('192.168.1.1')).toThrow(UnsafeBindHostError);
  });

  it('rejects 169.254.x.x (link-local non-loopback)', () => {
    expect(() => assertLoopbackBindHost('169.254.1.1')).toThrow(UnsafeBindHostError);
  });

  it('LOOPBACK_HOSTS contains the three canonical names', () => {
    expect(LOOPBACK_HOSTS.has('127.0.0.1')).toBe(true);
    expect(LOOPBACK_HOSTS.has('localhost')).toBe(true);
    expect(LOOPBACK_HOSTS.has('::1')).toBe(true);
  });
});

describe('EmbeddedMcpHost — lifecycle', () => {
  let host: EmbeddedMcpHost | null = null;

  beforeEach(() => {
    host = null;
  });

  afterEach(async () => {
    await host?.stop();
  });

  it('refuses to start when bindHost is non-loopback', async () => {
    host = new EmbeddedMcpHost(makeFakeBridge());
    await expect(host.start({ bindHost: '0.0.0.0' })).rejects.toThrow(UnsafeBindHostError);
  });

  it('starts on a free port + returns connection info with token', async () => {
    host = new EmbeddedMcpHost(makeFakeBridge());
    const info = await host.start({ port: 0 });
    expect(info.port).toBeGreaterThan(0);
    expect(info.bindHost).toBe('127.0.0.1');
    expect(info.token.length).toBeGreaterThan(20);
    expect(info.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp\?token=/);
    expect(host.isRunning()).toBe(true);
    expect(host.info()).toEqual(info);
  });

  it('refuses to start twice without stopping in between', async () => {
    host = new EmbeddedMcpHost(makeFakeBridge());
    await host.start({ port: 0 });
    await expect(host.start({ port: 0 })).rejects.toThrow(/already running/);
  });

  it('stop() is idempotent (safe to call on a not-started host)', async () => {
    host = new EmbeddedMcpHost(makeFakeBridge());
    await expect(host.stop()).resolves.toBeUndefined();
    await expect(host.stop()).resolves.toBeUndefined();
  });

  it('restart() rotates the bearer token', async () => {
    host = new EmbeddedMcpHost(makeFakeBridge());
    const first = await host.start({ port: 0 });
    const second = await host.restart({ port: 0 });
    expect(second.token).not.toBe(first.token);
  });
});

describe('EmbeddedMcpHost — security guards (live HTTP)', () => {
  let host: EmbeddedMcpHost | null = null;
  let url = '';
  let token = '';

  beforeEach(async () => {
    host = new EmbeddedMcpHost(makeFakeBridge());
    const info = await host.start({ port: 0 });
    url = `http://${info.bindHost}:${info.port}/mcp`;
    token = info.token;
  });

  afterEach(async () => {
    await host?.stop();
  });

  it('returns 401 when no token is presented', async () => {
    const r = await fetchOnce(url);
    expect(r.statusCode).toBe(401);
    expect(r.headers['www-authenticate']).toMatch(/Bearer/);
  });

  it('returns 401 when the bearer token is wrong', async () => {
    const r = await fetchOnce(url, { headers: { Authorization: 'Bearer not-the-token' } });
    expect(r.statusCode).toBe(401);
  });

  it('returns 401 when the query-string token is wrong', async () => {
    const r = await fetchOnce(`${url}?token=wrong`);
    expect(r.statusCode).toBe(401);
  });

  it('returns 403 when the Host header is non-loopback (DNS rebinding guard)', async () => {
    const r = await fetchOnce(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Host: 'evil.example.com',
      },
    });
    expect(r.statusCode).toBe(403);
    expect(r.body).toContain('non-loopback Host header');
  });

  it('accepts the request when token + Host are both valid', async () => {
    // The /mcp path with a valid token + loopback Host should reach the
    // SDK transport. The SDK returns a 4xx/5xx because we're sending a
    // bare GET without the proper MCP handshake, but the GUARDS passed —
    // the response code is not 401 / 403.
    const r = await fetchOnce(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(r.statusCode).not.toBe(401);
    expect(r.statusCode).not.toBe(403);
  });

  it('accepts the query-string token form', async () => {
    const r = await fetchOnce(`${url}?token=${encodeURIComponent(token)}`);
    expect(r.statusCode).not.toBe(401);
    expect(r.statusCode).not.toBe(403);
  });
});
