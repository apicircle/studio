import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createOAuth2Bridge, generateOAuth2State, validateOAuth2State } from './oauth2Bridge';

describe('generateOAuth2State', () => {
  it('returns a non-empty string', () => {
    const s = generateOAuth2State();
    expect(typeof s).toBe('string');
    expect(s.length).toBeGreaterThan(0);
  });

  it('returns different values across calls', () => {
    expect(generateOAuth2State()).not.toBe(generateOAuth2State());
  });

  it('produces an HMAC-bound form when a context is supplied', () => {
    const s = generateOAuth2State('client-id-123:https://app/cb');
    // <nonce>.<base64url HMAC> shape — exactly one '.' separator.
    expect(s.split('.').length).toBe(2);
    const [nonce, mac] = s.split('.');
    expect(nonce!.length).toBeGreaterThan(0);
    expect(mac!.length).toBeGreaterThan(0);
    // base64url charset only — no padding, +, or /.
    expect(mac!).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe('validateOAuth2State', () => {
  it('rejects a missing callback state (CSRF guard)', () => {
    const expected = generateOAuth2State();
    expect(validateOAuth2State(undefined, expected)).toBe(false);
    expect(validateOAuth2State('', expected)).toBe(false);
  });

  it('rejects a non-matching callback state', () => {
    expect(validateOAuth2State('different', 'expected')).toBe(false);
  });

  it('accepts an exact match (no context)', () => {
    const expected = generateOAuth2State();
    expect(validateOAuth2State(expected, expected)).toBe(true);
  });

  it('rejects a state whose HMAC was forged by a third party', () => {
    const expected = generateOAuth2State('client-x:cb-y');
    // Splice in a fresh nonce but keep the original HMAC — fails because
    // the HMAC was computed over the OLD nonce.
    const [, mac] = expected.split('.');
    const tampered = `attacker-nonce.${mac}`;
    expect(validateOAuth2State(tampered, expected, 'client-x:cb-y')).toBe(false);
  });

  it('rejects when the context differs from what was signed', () => {
    const expected = generateOAuth2State('client-x:cb-y');
    expect(validateOAuth2State(expected, expected, 'client-x:cb-DIFFERENT')).toBe(false);
  });

  it('accepts an HMAC-bound state with the same context that signed it', () => {
    const expected = generateOAuth2State('client-x:cb-y');
    expect(validateOAuth2State(expected, expected, 'client-x:cb-y')).toBe(true);
  });

  it('uses constant-time comparison (length mismatch shortcut is OK)', () => {
    // Different lengths return false immediately — that's fine; the
    // constant-time guarantee only applies to same-length inputs.
    expect(validateOAuth2State('a', 'aaaaa')).toBe(false);
    expect(validateOAuth2State('aaaaa', 'a')).toBe(false);
  });
});

describe('createOAuth2Bridge — desktop path', () => {
  beforeEach(() => {
    (globalThis as { apicircleDesktop?: unknown }).apicircleDesktop = {
      oauth2: {
        findFreePort: vi.fn().mockResolvedValue(8081),
        startFlow: vi.fn().mockResolvedValue({
          code: 'abc',
          state: 'xyz',
          port: 8081,
          redirectUri: 'http://localhost:8081/callback',
        }),
      },
    };
  });
  afterEach(() => {
    delete (globalThis as { apicircleDesktop?: unknown }).apicircleDesktop;
  });

  it('routes findFreePort through the desktop surface', async () => {
    const bridge = createOAuth2Bridge();
    const port = await bridge.findFreePort(8080);
    expect(port).toBe(8081);
  });

  it('routes startFlow + returns the desktop callback result', async () => {
    const bridge = createOAuth2Bridge();
    const result = await bridge.startFlow({
      authorizeUrl: 'https://idp/authorize?...',
      state: 'xyz',
      mode: 'code',
      port: 8081,
    });
    expect(result.code).toBe('abc');
    expect(result.state).toBe('xyz');
    expect(result.redirectUri).toBe('http://localhost:8081/callback');
  });

  it('builds redirectUri using the port the renderer passes', () => {
    const bridge = createOAuth2Bridge();
    expect(bridge.getRedirectUri({ port: 9090 })).toBe('http://localhost:9090/callback');
    expect(bridge.getRedirectUri({ port: 9090, callbackPath: '/cb' })).toBe(
      'http://localhost:9090/cb',
    );
  });
});

describe('createOAuth2Bridge — web path (no desktop surface)', () => {
  it('falls back to the WebBridge when apicircleDesktop is absent', async () => {
    delete (globalThis as { apicircleDesktop?: unknown }).apicircleDesktop;
    const bridge = createOAuth2Bridge();
    // findFreePort returns 0 (web has no port concept).
    expect(await bridge.findFreePort(8080)).toBe(0);
    // redirectUri uses window.location.origin (jsdom defaults to http://localhost).
    expect(bridge.getRedirectUri({ port: 0 })).toMatch(/oauth-callback\.html$/);
  });
});

describe('WebBridge.startFlow — popup choreography', () => {
  // Saved originals so we can restore between tests. window.open and
  // BroadcastChannel are mocked per-test to drive each branch
  // (popup blocked, popup closed early, callback received).

  const originalOpen = (globalThis as any).window?.open;

  const originalBroadcastChannel = (globalThis as any).BroadcastChannel;
  let activeChannels: MockChannel[] = [];

  class MockChannel {
    onmessage: ((event: { data: unknown }) => void) | null = null;
    constructor(public name: string) {
      activeChannels.push(this);
    }
    postMessage(_data: unknown): void {
      /* tests drive `onmessage` directly */
    }
    close(): void {
      /* noop */
    }
  }

  beforeEach(() => {
    delete (globalThis as { apicircleDesktop?: unknown }).apicircleDesktop;
    activeChannels = [];

    (globalThis as any).BroadcastChannel = MockChannel;
  });

  afterEach(() => {
    if (originalOpen) {
      window.open = originalOpen;
    }

    (globalThis as any).BroadcastChannel = originalBroadcastChannel;
    vi.useRealTimers();
  });

  it('throws "Popup blocked" when window.open returns null', async () => {
    window.open = vi.fn().mockReturnValue(null);
    const bridge = createOAuth2Bridge();
    await expect(
      bridge.startFlow({
        authorizeUrl: 'https://idp.example/authorize?client_id=x&state=s1',
        state: 's1',
        mode: 'code',
        port: 0,
      }),
    ).rejects.toThrow(/Popup blocked/i);
  });

  it('resolves with the parsed callback when the channel receives a message', async () => {
    const fakePopup = { closed: false, close: vi.fn() } as unknown as Window;
    window.open = vi.fn().mockReturnValue(fakePopup);

    const bridge = createOAuth2Bridge();
    const flowPromise = bridge.startFlow({
      authorizeUrl: 'https://idp.example/authorize?state=s2',
      state: 's2',
      mode: 'code',
      port: 0,
    });

    // The bridge attaches the channel listener inside the new Promise
    // body — wait a microtask so it's wired up before we deliver.
    await Promise.resolve();
    expect(activeChannels).toHaveLength(1);
    expect(activeChannels[0]!.name).toBe('apicircle-oauth-s2');

    // Simulate the popup posting through the channel.
    activeChannels[0]!.onmessage?.({
      data: {
        code: 'auth-code-from-popup',
        state: 's2',
      },
    });

    const result = await flowPromise;
    expect(result.code).toBe('auth-code-from-popup');
    expect(result.state).toBe('s2');
    expect(result.port).toBe(0);
    expect(result.redirectUri).toMatch(/oauth-callback\.html$/);
  });

  it('rejects with "popup was closed" when the user closes the popup early', async () => {
    vi.useFakeTimers();
    const fakePopup = { closed: false, close: vi.fn() } as unknown as Window & {
      closed: boolean;
    };
    window.open = vi.fn().mockReturnValue(fakePopup);

    const bridge = createOAuth2Bridge();
    const flowPromise = bridge.startFlow({
      authorizeUrl: 'https://idp.example/authorize?state=s3',
      state: 's3',
      mode: 'code',
      port: 0,
      timeoutMs: 60_000,
    });

    // Attach a catch handler immediately so jsdom doesn't flag the
    // pending rejection during the wait below.
    let caught: unknown = null;
    flowPromise.catch((e) => {
      caught = e;
    });

    // Let the bridge's setInterval start, then flip closed=true and
    // advance past the next 500ms tick.
    await Promise.resolve();
    fakePopup.closed = true;
    await vi.advanceTimersByTimeAsync(600);

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toMatch(/popup was closed/i);
  });

  it('rejects with timeout when neither callback nor popup-close fires', async () => {
    vi.useFakeTimers();
    const fakePopup = { closed: false, close: vi.fn() } as unknown as Window;
    window.open = vi.fn().mockReturnValue(fakePopup);

    const bridge = createOAuth2Bridge();
    const flowPromise = bridge.startFlow({
      authorizeUrl: 'https://idp.example/authorize?state=s4',
      state: 's4',
      mode: 'code',
      port: 0,
      timeoutMs: 1000,
    });

    let caught: unknown = null;
    flowPromise.catch((e) => {
      caught = e;
    });

    await vi.advanceTimersByTimeAsync(1100);

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toMatch(/timed out/i);
  });

  it("keeps two in-flight flows isolated — flow A's callback does not resolve flow B", async () => {
    // Real-world race: user clicks "Get token" on request A, then clicks
    // "Get token" on request B before A completes. Both flows are
    // pending; each has its OWN state value and listens on its OWN
    // BroadcastChannel. The callback for one MUST NOT settle the
    // other's promise.
    const fakePopup = { closed: false, close: vi.fn() } as unknown as Window;
    window.open = vi.fn().mockReturnValue(fakePopup);

    const bridge = createOAuth2Bridge();
    const flowA = bridge.startFlow({
      authorizeUrl: 'https://idp.example/authorize?state=state-A',
      state: 'state-A',
      mode: 'code',
      port: 0,
    });
    const flowB = bridge.startFlow({
      authorizeUrl: 'https://idp.example/authorize?state=state-B',
      state: 'state-B',
      mode: 'code',
      port: 0,
    });

    // Wait for both Promises to install their channel listeners.
    await Promise.resolve();
    await Promise.resolve();

    expect(activeChannels.map((c) => c.name)).toEqual([
      'apicircle-oauth-state-A',
      'apicircle-oauth-state-B',
    ]);

    // Track which flow resolved without awaiting (so we can confirm
    // exactly one settles per delivery). `void` marks the floating
    // promise as intentional — we observe via the captured result vars.
    let flowAResult: unknown = 'pending';
    let flowBResult: unknown = 'pending';
    void flowA.then((r) => {
      flowAResult = r;
    });
    void flowB.then((r) => {
      flowBResult = r;
    });

    // Deliver to channel A only — flow B must remain pending.
    activeChannels[0]!.onmessage?.({
      data: { code: 'code-for-A', state: 'state-A' },
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(flowAResult).toMatchObject({ code: 'code-for-A', state: 'state-A' });
    expect(flowBResult).toBe('pending');

    // Now deliver to channel B — flow B settles independently.
    activeChannels[1]!.onmessage?.({
      data: { code: 'code-for-B', state: 'state-B' },
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(flowBResult).toMatchObject({ code: 'code-for-B', state: 'state-B' });
  });

  it('ignores a callback delivered with the wrong state (receiver-level CSRF guard)', async () => {
    // Threat: a same-origin browser extension or malicious tab guesses the
    // channel name (`apicircle-oauth-<state>`) and posts a forged payload
    // with a DIFFERENT state field. The bridge must NOT settle the
    // promise — the legitimate IdP redirect may still be in flight, and
    // the caller's downstream `validateOAuth2State` would reject it
    // anyway. This is defense-in-depth at the receiver level.
    vi.useFakeTimers();
    const fakePopup = { closed: false, close: vi.fn() } as unknown as Window;
    window.open = vi.fn().mockReturnValue(fakePopup);

    const bridge = createOAuth2Bridge();
    const flowPromise = bridge.startFlow({
      authorizeUrl: 'https://idp/authorize?state=correct-state',
      state: 'correct-state',
      mode: 'code',
      port: 0,
      timeoutMs: 1000,
    });

    let settled: unknown = 'pending';
    flowPromise.then((r) => (settled = r)).catch((e) => (settled = e));

    await Promise.resolve();
    expect(activeChannels).toHaveLength(1);

    // Hostile post on the right channel with a wrong state — must be ignored.
    activeChannels[0]!.onmessage?.({
      data: { code: 'forged', state: 'NOT-the-correct-state' },
    });
    await Promise.resolve();
    expect(settled).toBe('pending');

    // A payload with NO state at all is similarly ignored.
    activeChannels[0]!.onmessage?.({ data: { code: 'still-forged' } });
    await Promise.resolve();
    expect(settled).toBe('pending');

    // The real callback arrives — now we settle. Two microtask flushes:
    // one to clear `finish` → `resolve`, one for the `.then` callback to
    // run and set the captured `settled` variable. Matches the cadence
    // used by adjacent multi-flow tests in this file.
    activeChannels[0]!.onmessage?.({
      data: { code: 'real-code', state: 'correct-state' },
    });
    await Promise.resolve();
    await Promise.resolve();
    expect((settled as { code?: string }).code).toBe('real-code');
  });

  it('settles via window.postMessage when sent from same origin', async () => {
    // postMessage is the fallback path when BroadcastChannel is unavailable
    // (privacy modes, browser extensions stripping the API). The receiver
    // gates on `event.origin === window.location.origin` so cross-origin
    // attackers can't push payloads at us. Same-origin posts that carry
    // the right state must settle the flow.
    const fakePopup = { closed: false, close: vi.fn() } as unknown as Window;
    window.open = vi.fn().mockReturnValue(fakePopup);

    const bridge = createOAuth2Bridge();
    const flowPromise = bridge.startFlow({
      authorizeUrl: 'https://idp/authorize?state=pm-state',
      state: 'pm-state',
      mode: 'code',
      port: 0,
    });

    await Promise.resolve();

    // Synthesize a same-origin message event. jsdom's `MessageEvent`
    // accepts `origin` via the init dict.
    const messageEvent = new MessageEvent('message', {
      data: { code: 'pm-code', state: 'pm-state' },
      origin: window.location.origin,
    });
    window.dispatchEvent(messageEvent);

    const result = await flowPromise;
    expect(result.code).toBe('pm-code');
    expect(result.state).toBe('pm-state');
  });

  it('ignores postMessage from a cross-origin sender', async () => {
    vi.useFakeTimers();
    const fakePopup = { closed: false, close: vi.fn() } as unknown as Window;
    window.open = vi.fn().mockReturnValue(fakePopup);

    const bridge = createOAuth2Bridge();
    const flowPromise = bridge.startFlow({
      authorizeUrl: 'https://idp/authorize?state=xo-state',
      state: 'xo-state',
      mode: 'code',
      port: 0,
      timeoutMs: 1000,
    });

    let settled: unknown = 'pending';
    flowPromise.then((r) => (settled = r)).catch((e) => (settled = e));

    await Promise.resolve();

    const xo = new MessageEvent('message', {
      data: { code: 'xo-code', state: 'xo-state' },
      origin: 'https://attacker.example',
    });
    window.dispatchEvent(xo);
    await Promise.resolve();
    expect(settled).toBe('pending');

    // Advance past timeout — we expect a timeout rejection now, proving
    // the cross-origin post never settled the flow.
    await vi.advanceTimersByTimeAsync(1100);
    expect(settled).toBeInstanceOf(Error);
    expect((settled as Error).message).toMatch(/timed out/i);
  });

  it('opens the channel BEFORE window.open so the popup can post immediately', async () => {
    // Race condition: if window.open is called first and the popup
    // navigates + posts before the parent's BroadcastChannel listener
    // exists, the message is lost. Verify the channel is constructed
    // before window.open returns.
    const events: string[] = [];
    const fakePopup = { closed: false, close: vi.fn() } as unknown as Window;
    window.open = vi.fn(() => {
      events.push('window.open');
      return fakePopup;
    });

    (globalThis as any).BroadcastChannel = function (name: string) {
      events.push(`channel:${name}`);
      return new MockChannel(name);
    };

    const bridge = createOAuth2Bridge();
    const promise = bridge.startFlow({
      authorizeUrl: 'https://idp/auth?state=order',
      state: 'order',
      mode: 'code',
      port: 0,
      timeoutMs: 1000,
    });
    promise.catch(() => {}); // suppress unhandled-rejection warning when we abandon below
    await Promise.resolve();

    expect(events[0]).toBe('channel:apicircle-oauth-order');
    expect(events[1]).toBe('window.open');
  });
});
