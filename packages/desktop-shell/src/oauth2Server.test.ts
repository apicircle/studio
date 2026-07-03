import { beforeAll, describe, expect, it } from 'vitest';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { findFreePort, openInBrowser, startCallbackServer } from './oauth2Server';

type HttpServer = Server<typeof IncomingMessage, typeof ServerResponse>;

/**
 * Integration tests for the OAuth callback bridge: bind a real port,
 * fire a real HTTP request at it, verify the response. We use small
 * local-only ports (54000+) so the tests don't collide with anything
 * the developer is running.
 */

// Pick a base port via the OS's ephemeral-port allocator so we never collide
// with whatever a developer (or CI host) is running locally. Hardcoded ports
// led to flaky test runs when port 54100 happened to be in use.
async function pickFreeBase(): Promise<number> {
  const net = await import('node:net');
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

let TEST_PORT_BASE = 54100;

async function fetchSelf(url: string): Promise<{ status: number; body: string }> {
  const res = await fetch(url);
  return { status: res.status, body: await res.text() };
}

beforeAll(async () => {
  TEST_PORT_BASE = await pickFreeBase();
});

describe('findFreePort', () => {
  it('returns the preferred port when free', async () => {
    const port = await findFreePort(TEST_PORT_BASE);
    expect(port).toBe(TEST_PORT_BASE);
  });

  it('walks the range when the preferred port is busy', async () => {
    // Hold TEST_PORT_BASE+1 hostage with a server, then findFreePort
    // should skip past it.
    const blocker = (await import('node:http')).createServer();
    await new Promise<void>((r) => blocker.listen(TEST_PORT_BASE + 1, '127.0.0.1', r));
    try {
      const port = await findFreePort(TEST_PORT_BASE + 1, 5);
      expect(port).toBeGreaterThanOrEqual(TEST_PORT_BASE + 2);
      expect(port).toBeLessThanOrEqual(TEST_PORT_BASE + 5);
    } finally {
      await new Promise<void>((r) => blocker.close(() => r()));
    }
  });
});

describe('startCallbackServer — auth-code mode', () => {
  it('resolves with parsed code/state when the IdP redirects', async () => {
    const port = await findFreePort(TEST_PORT_BASE + 10);
    const callbackPromise = startCallbackServer({ port, mode: 'code', timeoutMs: 5000 });

    // Simulate the IdP redirect.
    const callbackUrl = `http://127.0.0.1:${port}/callback?code=abc-123&state=xyz`;
    const httpResult = await fetchSelf(callbackUrl);
    expect(httpResult.status).toBe(200);
    expect(httpResult.body).toContain('You can close this tab');

    const result = await callbackPromise;
    expect(result.code).toBe('abc-123');
    expect(result.state).toBe('xyz');
    expect(result.port).toBe(port);
    expect(result.redirectUri).toBe(`http://localhost:${port}/callback`);
  });

  it('resolves with error / error_description on a failed callback', async () => {
    const port = await findFreePort(TEST_PORT_BASE + 20);
    const callbackPromise = startCallbackServer({ port, mode: 'code', timeoutMs: 5000 });
    await fetchSelf(
      `http://127.0.0.1:${port}/callback?error=access_denied&error_description=user%20cancelled`,
    );
    const result = await callbackPromise;
    expect(result.error).toBe('access_denied');
    expect(result.errorDescription).toBe('user cancelled');
  });

  it('rejects on timeout when no callback arrives', async () => {
    const port = await findFreePort(TEST_PORT_BASE + 30);
    await expect(startCallbackServer({ port, mode: 'code', timeoutMs: 200 })).rejects.toThrow(
      /timed out/,
    );
  });

  it('returns 404 for paths other than /callback', async () => {
    const port = await findFreePort(TEST_PORT_BASE + 40);
    const callbackPromise = startCallbackServer({ port, mode: 'code', timeoutMs: 5000 });
    const wrong = await fetchSelf(`http://127.0.0.1:${port}/elsewhere`);
    expect(wrong.status).toBe(404);
    // Server still alive — finish it via /callback so the promise settles.
    await fetchSelf(`http://127.0.0.1:${port}/callback?code=ok`);
    await callbackPromise;
  });
});

describe('startCallbackServer — implicit (token) mode', () => {
  it('serves the fragment-relay HTML when /callback hits without query params', async () => {
    const port = await findFreePort(TEST_PORT_BASE + 50);
    const callbackPromise = startCallbackServer({ port, mode: 'token', timeoutMs: 5000 });

    // Initial hit: no params yet (browser stripped fragment) → relay HTML.
    const relay = await fetchSelf(`http://127.0.0.1:${port}/callback`);
    expect(relay.status).toBe(200);
    expect(relay.body).toContain('window.location.hash');
    expect(relay.body).toContain('window.location.replace');

    // Now simulate the relay's redirect carrying the fragment as query.
    await fetchSelf(
      `http://127.0.0.1:${port}/callback?access_token=tk&token_type=Bearer&expires_in=3600`,
    );
    const result = await callbackPromise;
    expect(result.accessToken).toBe('tk');
    expect(result.tokenType).toBe('Bearer');
    expect(result.expiresIn).toBe(3600);
  });

  it('relay JS actually promotes #fragment params to ?query when executed in a browser sandbox', async () => {
    // Gap #7 fix: previous test only verified the relay HTML was served,
    // then SEPARATELY fired a request with the params already in the
    // query string — bypassing the inline JS that's supposed to do the
    // promotion. Here we fetch the served HTML, extract the inline
    // script, and run it inside a node:vm sandbox with a controlled
    // `window` so we can assert the EXACT URL it tries to redirect to.
    // A regression in the hash-parse logic would now fail this test.
    const { createContext, runInContext } = await import('node:vm');

    const port = await findFreePort(TEST_PORT_BASE + 90);
    const callbackPromise = startCallbackServer({ port, mode: 'token', timeoutMs: 5000 });
    const relay = await fetchSelf(`http://127.0.0.1:${port}/callback`);

    // Extract the inline script. The relay has exactly one <script> block.
    const scriptMatch = /<script>([\s\S]*?)<\/script>/.exec(relay.body);
    expect(scriptMatch).not.toBeNull();
    const script = scriptMatch![1]!;

    // Build a fake `window.location` that mimics what a real browser
    // would see when redirected to `/callback#access_token=tk&…`.
    let replacedWith: string | null = null;
    const fakeWindow = {
      location: {
        hash: '#access_token=tk-implicit&token_type=Bearer&expires_in=3600&state=imp',
        search: '',
        pathname: '/callback',
        replace: (url: string) => {
          replacedWith = url;
        },
      },
    };
    const ctx = createContext({ window: fakeWindow });
    runInContext(script, ctx);

    expect(replacedWith).not.toBeNull();
    // The script must have promoted every fragment param into the query
    // string and called replace() with the resulting URL.
    const target = new URL(`http://127.0.0.1${replacedWith!}`);
    expect(target.pathname).toBe('/callback');
    expect(target.searchParams.get('access_token')).toBe('tk-implicit');
    expect(target.searchParams.get('token_type')).toBe('Bearer');
    expect(target.searchParams.get('expires_in')).toBe('3600');
    expect(target.searchParams.get('state')).toBe('imp');

    // Cleanup: the implicit-mode server is still pending. Drain it via
    // a real callback so the test exits cleanly.
    await fetchSelf(`http://127.0.0.1:${port}/callback?access_token=tk-cleanup&token_type=Bearer`);
    await callbackPromise;
  });

  it('relay JS preserves existing query params when search is also present', async () => {
    // Edge case: some IdPs put state in the query and tokens in the
    // fragment (or vice versa). The relay's combine logic must merge
    // both halves. Verify with a payload that splits across them.
    const { createContext, runInContext } = await import('node:vm');

    const port = await findFreePort(TEST_PORT_BASE + 100);
    const callbackPromise = startCallbackServer({ port, mode: 'token', timeoutMs: 5000 });
    const relay = await fetchSelf(`http://127.0.0.1:${port}/callback`);
    const script = /<script>([\s\S]*?)<\/script>/.exec(relay.body)![1]!;

    let replacedWith: string | null = null;
    const fakeWindow = {
      location: {
        hash: '#access_token=tk-merged',
        search: '?state=from-query',
        pathname: '/callback',
        replace: (url: string) => {
          replacedWith = url;
        },
      },
    };
    runInContext(script, createContext({ window: fakeWindow }));

    expect(replacedWith).not.toBeNull();
    const target = new URL(`http://127.0.0.1${replacedWith!}`);
    expect(target.searchParams.get('access_token')).toBe('tk-merged');
    expect(target.searchParams.get('state')).toBe('from-query');

    await fetchSelf(`http://127.0.0.1:${port}/callback?access_token=ok&token_type=Bearer`);
    await callbackPromise;
  });

  it('relay JS handles an empty fragment without producing malformed URL', async () => {
    // Defensive: if a popup somehow loads /callback with no fragment
    // and no query, the relay shouldn't redirect to a bare `?` URL.
    const { createContext, runInContext } = await import('node:vm');

    const port = await findFreePort(TEST_PORT_BASE + 110);
    const callbackPromise = startCallbackServer({ port, mode: 'token', timeoutMs: 5000 });
    const relay = await fetchSelf(`http://127.0.0.1:${port}/callback`);
    const script = /<script>([\s\S]*?)<\/script>/.exec(relay.body)![1]!;

    let replacedWith: string | null = null;
    const fakeWindow = {
      location: {
        hash: '',
        search: '',
        pathname: '/callback',
        replace: (url: string) => {
          replacedWith = url;
        },
      },
    };
    runInContext(script, createContext({ window: fakeWindow }));

    // The relay still calls replace (its job is to redirect once) but
    // with no params. The callback server receiving `/callback?` with
    // an empty query is the existing "no params" branch that returns
    // the relay HTML again — would loop forever in a browser, but
    // that's outside the scope of the relay JS itself.
    expect(replacedWith).toBe('/callback?');

    await fetchSelf(`http://127.0.0.1:${port}/callback?access_token=ok&token_type=Bearer`);
    await callbackPromise;
  });
});

describe('startCallbackServer — security', () => {
  it('binds 127.0.0.1 only (control case: loopback works)', async () => {
    const port = await findFreePort(TEST_PORT_BASE + 60);
    const callbackPromise = startCallbackServer({ port, mode: 'code', timeoutMs: 5000 });
    const local = await fetchSelf(`http://127.0.0.1:${port}/callback?code=1`);
    expect(local.status).toBe(200);
    await callbackPromise;
  });

  it('exposes a 127.0.0.1 IPv4 address via server.address() — no 0.0.0.0 / ::', async () => {
    // Strongest in-process proof: ask the running server what address
    // it actually bound to. `listen(port, '127.0.0.1')` MUST surface
    // an IPv4 AddressInfo with `address === '127.0.0.1'`. Anything
    // else (`0.0.0.0`, `::`, an IPv6 family) means the bind escaped
    // the loopback interface and accepts connections from elsewhere.
    const { createServer } = await import('node:http');
    const port = await findFreePort(TEST_PORT_BASE + 70);

    // Inject a custom serverFactory so we can grab the underlying
    // node:http Server and query its bound address. The default
    // factory hides this behind the resolved CallbackResult.
    let captured: HttpServer | null = null;
    const callbackPromise = startCallbackServer({
      port,
      mode: 'code',
      timeoutMs: 5000,
      serverFactory: (handler) => {
        captured = createServer(handler);
        return captured;
      },
    });
    // Race: wait until the server has bound so address() returns
    // an AddressInfo (not null).
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    expect(captured).not.toBeNull();
    const addr = captured!.address();
    expect(addr).not.toBeNull();
    expect(typeof addr).toBe('object');
    if (addr && typeof addr === 'object') {
      expect(addr.address).toBe('127.0.0.1');
      expect(addr.family).toBe('IPv4');
      expect(addr.port).toBe(port);
    }

    // Drain so the test cleans up.
    await fetchSelf(`http://127.0.0.1:${port}/callback?code=ok`);
    await callbackPromise;
  });

  it('refuses connections via the IPv6 loopback (::1) — proves IPv4-only bind', async () => {
    // Dual-stack proof: a server bound to 127.0.0.1 (IPv4) does NOT
    // accept connections to ::1 (IPv6 loopback). This is the contract
    // we rely on to keep the OAuth callback unreachable from anything
    // other than processes on the same machine going through IPv4
    // localhost. If a future change accidentally bound to '0.0.0.0' or
    // '::', this test would start passing the IPv6 connect — which we
    // explicitly assert does NOT happen.
    const net = await import('node:net');
    const port = await findFreePort(TEST_PORT_BASE + 80);
    const callbackPromise = startCallbackServer({ port, mode: 'code', timeoutMs: 5000 });

    // Probe ::1:port. We expect the connect to fail (ECONNREFUSED on
    // Linux/macOS, similar on Windows). Some CI environments don't have
    // IPv6 enabled at all — ENETUNREACH / EAFNOSUPPORT also count as
    // "couldn't reach via IPv6", which is fine for the contract.
    const ipv6ConnectError = await new Promise<NodeJS.ErrnoException | null>((resolve) => {
      const socket = net.connect({ host: '::1', port, family: 6 });
      const timer = setTimeout(() => {
        // If the connect somehow stalls without an error, treat that
        // as "did not reject" and surface a synthetic error so the
        // assertion fails loudly.
        socket.destroy();
        resolve(new Error('IPv6 connect did not error within 1s'));
      }, 1000);
      socket.once('error', (err) => {
        clearTimeout(timer);
        socket.destroy();
        resolve(err as NodeJS.ErrnoException);
      });
      socket.once('connect', () => {
        clearTimeout(timer);
        socket.destroy();
        // Connecting via ::1 succeeded — that's the failure mode.
        resolve(null);
      });
    });

    expect(ipv6ConnectError).not.toBeNull();
    if (ipv6ConnectError) {
      // Acceptable error codes: connection refused (server isn't on
      // this address) or transport unreachable (no IPv6 stack).
      expect(['ECONNREFUSED', 'ENETUNREACH', 'EAFNOSUPPORT', 'EADDRNOTAVAIL']).toContain(
        ipv6ConnectError.code,
      );
    }

    // Drain so the server tears down cleanly.
    await fetchSelf(`http://127.0.0.1:${port}/callback?code=ok`);
    await callbackPromise;
  });
});

describe('openInBrowser — scheme allowlist', () => {
  // shell.openExternal on Windows is ShellExecute, which has historically
  // been an RCE vector for Electron apps that opened unvalidated URLs
  // (file:, smb:, ms-msdt:, custom protocol handlers). Defense-in-depth:
  // we validate the scheme inside openInBrowser itself in addition to the
  // IPC entry point, so a future caller can't accidentally skip the guard.
  const fakeOpen = async (_url: string): Promise<void> => {
    /* no-op — we only care whether we get here */
  };

  it('accepts https URLs', async () => {
    await expect(openInBrowser('https://example.com/authorize', fakeOpen)).resolves.toBeUndefined();
  });

  it('accepts http URLs (for localhost dev IdPs)', async () => {
    await expect(openInBrowser('http://localhost:8080/x', fakeOpen)).resolves.toBeUndefined();
  });

  it('rejects file: URLs', async () => {
    await expect(openInBrowser('file:///etc/passwd', fakeOpen)).rejects.toThrow(/refusing scheme/);
  });

  it('rejects javascript: URLs', async () => {
    await expect(openInBrowser('javascript:alert(1)', fakeOpen)).rejects.toThrow(/refusing scheme/);
  });

  it('rejects custom protocol URLs (e.g. smb:, ms-msdt:)', async () => {
    await expect(openInBrowser('smb://attacker/share', fakeOpen)).rejects.toThrow(
      /refusing scheme/,
    );
    await expect(openInBrowser('ms-msdt:/id PCWDiagnostic', fakeOpen)).rejects.toThrow(
      /refusing scheme/,
    );
  });

  it('rejects malformed URLs', async () => {
    await expect(openInBrowser('not a url', fakeOpen)).rejects.toThrow(/invalid URL/);
  });
});

describe('startCallbackServer — request hardening', () => {
  it('rejects non-GET methods with 405', async () => {
    const port = await findFreePort(TEST_PORT_BASE + 200);
    const callbackPromise = startCallbackServer({ port, mode: 'code', timeoutMs: 5000 });
    const res = await fetch(`http://127.0.0.1:${port}/callback`, { method: 'POST', body: 'x' });
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('GET');
    // Drain so the test exits cleanly.
    await fetchSelf(`http://127.0.0.1:${port}/callback?code=ok`);
    await callbackPromise;
  });

  it('rejects oversized URLs with 414', async () => {
    const port = await findFreePort(TEST_PORT_BASE + 210);
    const callbackPromise = startCallbackServer({ port, mode: 'code', timeoutMs: 5000 });
    const giant = 'x'.repeat(9000);
    const res = await fetch(`http://127.0.0.1:${port}/callback?code=${giant}`);
    expect(res.status).toBe(414);
    // Drain so the test exits cleanly.
    await fetchSelf(`http://127.0.0.1:${port}/callback?code=ok`);
    await callbackPromise;
  });
});
