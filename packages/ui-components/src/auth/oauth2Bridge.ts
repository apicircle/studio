/**
 * OAuth2 callback bridge — abstraction over Desktop's localhost server
 * and Web's popup-window relay. The Auth tab UI doesn't care which one
 * is active; it just calls `findFreePort` + `startFlow` and gets back a
 * parsed callback.
 *
 *   - Desktop: `apicircleDesktop.oauth2.startFlow` runs the localhost
 *     http server + opens the IdP URL in the system browser. Provides a
 *     truly arbitrary `redirect_uri = http://localhost:<port>/callback`
 *     since the user controls the port.
 *
 *   - Web: opens a popup at the bundled `/oauth-callback.html`,
 *     listens for the result via `BroadcastChannel`. The redirect_uri
 *     is fixed at the deploy origin's `/oauth-callback.html` — IdP must
 *     have it pre-registered.
 *
 * The `factory()` picks the right implementation at runtime; tests
 * override with a synthetic bridge.
 */

export interface OAuth2CallbackResult {
  code?: string;
  accessToken?: string;
  tokenType?: string;
  expiresIn?: number;
  scope?: string;
  state?: string;
  error?: string;
  errorDescription?: string;
  /** Final port we bound (desktop) or 0 (web — port unused). */
  port: number;
  /** The redirect_uri the IdP was told to redirect to. */
  redirectUri: string;
}

export interface OAuth2Bridge {
  /** Always present in desktop; web returns 0 (no port concept). */
  findFreePort(preferred: number): Promise<number>;
  startFlow(args: {
    authorizeUrl: string;
    /** Used as both the BroadcastChannel suffix (web) AND must match the IdP's `state` param. */
    state: string;
    /** `code` for auth-code/PKCE; `token` for implicit. */
    mode: 'code' | 'token';
    /** Desktop only — caller should pass `findFreePort` result. */
    port: number;
    /** Desktop only — defaults to `/callback`. */
    callbackPath?: string;
    /** Hard timeout. Defaults to 120s. */
    timeoutMs?: number;
  }): Promise<OAuth2CallbackResult>;
  /**
   * The redirect_uri the IdP must be told to use. Computed at flow-start
   * time because desktop's port can vary; web's is the deploy origin.
   */
  getRedirectUri(args: { port: number; callbackPath?: string }): string;
}

interface DesktopOAuth2Surface {
  findFreePort(preferred: number): Promise<number>;
  startFlow(args: {
    authorizeUrl: string;
    port: number;
    mode: 'code' | 'token';
    callbackPath?: string;
    timeoutMs?: number;
  }): Promise<OAuth2CallbackResult>;
}

function getDesktopBridge(): DesktopOAuth2Surface | null {
  const w = globalThis as unknown as {
    apicircleDesktop?: { oauth2?: DesktopOAuth2Surface };
  };
  return w.apicircleDesktop?.oauth2 ?? null;
}

class DesktopBridge implements OAuth2Bridge {
  constructor(private surface: DesktopOAuth2Surface) {}
  findFreePort(preferred: number): Promise<number> {
    return this.surface.findFreePort(preferred);
  }
  async startFlow(args: Parameters<OAuth2Bridge['startFlow']>[0]): Promise<OAuth2CallbackResult> {
    return this.surface.startFlow({
      authorizeUrl: args.authorizeUrl,
      port: args.port,
      mode: args.mode,
      callbackPath: args.callbackPath,
      timeoutMs: args.timeoutMs,
    });
  }
  getRedirectUri(args: { port: number; callbackPath?: string }): string {
    return `http://localhost:${args.port}${args.callbackPath ?? '/callback'}`;
  }
}

class WebBridge implements OAuth2Bridge {
  /**
   * Web doesn't bind ports — return 0 for symmetry with the desktop
   * API. The base method has no await body so we explicitly return
   * a resolved Promise to satisfy the @typescript-eslint/require-await
   * rule (declaring `async` without `await` is a smell).
   */
  findFreePort(): Promise<number> {
    return Promise.resolve(0);
  }

  async startFlow(args: Parameters<OAuth2Bridge['startFlow']>[0]): Promise<OAuth2CallbackResult> {
    if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') {
      throw new Error(
        'OAuth2 web flow requires a browser environment with BroadcastChannel support',
      );
    }
    const timeoutMs = args.timeoutMs ?? 120_000;
    const redirectUri = this.getRedirectUri({ port: 0 });
    const channelName = `apicircle-oauth-${args.state}`;

    return new Promise<OAuth2CallbackResult>((resolve, reject) => {
      const channel = new BroadcastChannel(channelName);
      let popup: Window | null = null;
      let settled = false;
      // `popupCheckInterval` and `timeoutHandle` are assigned in two
      // places below: the timeoutHandle is set unconditionally; the
      // popupCheckInterval is set only if window.open succeeds. They
      // MUST be `let` (not `const` with init at declaration) because
      // `finish` references both, and the popup-blocked branch invokes
      // `finish` synchronously BEFORE either has been set — using
      // `const` would throw a TDZ error on cleanup. The lint rule
      // `prefer-const` doesn't see the cross-closure dependency.
      // eslint-disable-next-line prefer-const
      let popupCheckInterval: ReturnType<typeof setInterval> | undefined;
      // eslint-disable-next-line prefer-const
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

      // Same-origin `postMessage` fallback. The callback page posts to
      // `window.opener` (with `targetOrigin = location.origin`) for
      // environments where BroadcastChannel is unavailable, blocked by
      // privacy settings, or stripped by a browser extension. We require
      // `event.origin === location.origin` so a cross-origin attacker
      // can't push a forged payload at us. Declared before `finish` so
      // `finish` can tear down the listener in any exit path.
      const messageHandler = (event: MessageEvent<unknown>): void => {
        if (typeof window === 'undefined' || event.origin !== window.location.origin) return;
        acceptPayload(event.data);
      };

      const finish = (result: OAuth2CallbackResult | Error) => {
        if (settled) return;
        settled = true;
        try {
          channel.close();
        } catch {
          /* noop */
        }
        try {
          if (typeof window !== 'undefined') {
            window.removeEventListener('message', messageHandler);
          }
        } catch {
          /* noop */
        }
        if (timeoutHandle) clearTimeout(timeoutHandle);
        if (popupCheckInterval) clearInterval(popupCheckInterval);
        try {
          popup?.close();
        } catch {
          /* popup may already be gone */
        }
        if (result instanceof Error) reject(result);
        else resolve(result);
      };

      // Settle on the first payload that arrives AND carries our expected
      // state value. Defense-in-depth: a same-origin attacker (browser
      // extension, malicious tab) can post on the BroadcastChannel because
      // the channel name is derived from the (non-secret) state. Filtering
      // by `payload.state === args.state` here means a forged payload
      // carrying a different state is ignored rather than racing the
      // legitimate IdP redirect. The caller still re-validates with HMAC
      // context downstream — this is the receiver-level gate.
      const acceptPayload = (raw: unknown): void => {
        if (!raw || typeof raw !== 'object') return;
        const payload = raw as Partial<OAuth2CallbackResult>;
        const incomingState = typeof payload.state === 'string' ? payload.state : '';
        if (!incomingState || !constantTimeEqual(incomingState, args.state)) {
          // Wrong (or missing) state — don't settle. Keep waiting; the
          // real IdP redirect may still be in flight.
          return;
        }
        finish({
          code: payload.code,
          accessToken: payload.accessToken,
          tokenType: payload.tokenType,
          expiresIn: payload.expiresIn,
          scope: payload.scope,
          state: incomingState,
          error: payload.error,
          errorDescription: payload.errorDescription,
          port: 0,
          redirectUri,
        });
      };

      timeoutHandle = setTimeout(
        () => finish(new Error(`OAuth2 callback timed out after ${timeoutMs}ms`)),
        timeoutMs,
      );

      channel.onmessage = (event: MessageEvent<unknown>) => acceptPayload(event.data);
      window.addEventListener('message', messageHandler);

      // Open the popup AFTER the channel is listening. Centered on the
      // current screen, fixed dimensions — most IdP login pages render
      // fine in this size.
      popup = window.open(args.authorizeUrl, 'apicircle-oauth', 'width=520,height=700');
      if (!popup) {
        finish(new Error('Popup blocked. Allow pop-ups for this site and retry.'));
        return;
      }

      // If the user closes the popup without completing, surface a
      // clear error rather than waiting for the timeout.
      popupCheckInterval = setInterval(() => {
        if (popup && popup.closed) {
          finish(new Error('OAuth2 popup was closed before sign-in completed'));
        }
      }, 500);
    });
  }

  getRedirectUri(_args: { port: number; callbackPath?: string }): string {
    if (typeof window === 'undefined') return '/oauth-callback.html';
    return `${window.location.origin}/oauth-callback.html`;
  }
}

/**
 * Pick the desktop bridge when `apicircleDesktop.oauth2` is exposed,
 * otherwise the web popup bridge. Tests override by passing an explicit
 * bridge to whatever consumes this.
 */
export function createOAuth2Bridge(): OAuth2Bridge {
  const desktop = getDesktopBridge();
  if (desktop) return new DesktopBridge(desktop);
  return new WebBridge();
}

/**
 * Generate a fresh `state` value — caller passes it to the IdP. The
 * format is `<nonce>` (random URL-safe ID, 128 bits of entropy from
 * `crypto.randomUUID`) or `<nonce>.<hmac>` when a `context` is supplied.
 *
 * The HMAC variant (RFC 6749 §10.12 + OWASP "OAuth 2.0 stateless CSRF
 * defense") binds the state to a specific request context — typically
 * `${clientId}:${redirectUri}` — so a state leaked from one flow can't
 * be replayed against a different client/redirect. The HMAC is keyed
 * by a per-process secret created lazily on first use; this prevents
 * an attacker who only sees the nonce from forging a matching state.
 *
 * Callers passing `context` MUST validate via `validateOAuth2State`.
 * Callers omitting it can compare raw strings (the same closure that
 * generated `state` also receives the IdP echo, so a constant-time
 * equality check is sufficient).
 */
export function generateOAuth2State(context?: string): string {
  const nonce = randomNonce();
  if (context === undefined) return nonce;
  return `${nonce}.${hmacB64Url(getProcessSecret(), `${nonce}:${context}`)}`;
}

/**
 * Constant-time validation of an OAuth2 `state` echoed by the IdP.
 *
 * Two modes:
 *   - When `expected` was generated WITHOUT context: pass `expected`
 *     and we compare strings constant-time. The function REQUIRES the
 *     callback state to be a non-empty string (RFC 6749 §10.12 mandates
 *     verifying state — silently accepting a missing state is the
 *     classic CSRF vector this guards against).
 *   - When `expected` was generated WITH a context: pass `context` too;
 *     we recompute the expected HMAC, verify it constant-time, and
 *     allow rejection even if the attacker spliced in a different
 *     nonce. The `expected` argument is still required to anchor the
 *     comparison against THIS specific flow.
 */
export function validateOAuth2State(
  callbackState: string | undefined,
  expected: string,
  context?: string,
): boolean {
  if (!callbackState || typeof callbackState !== 'string') return false;
  if (!constantTimeEqual(callbackState, expected)) return false;
  if (context !== undefined) {
    const dotIx = callbackState.indexOf('.');
    if (dotIx <= 0) return false;
    const nonce = callbackState.slice(0, dotIx);
    const mac = callbackState.slice(dotIx + 1);
    const expectedMac = hmacB64Url(getProcessSecret(), `${nonce}:${context}`);
    if (!constantTimeEqual(mac, expectedMac)) return false;
  }
  return true;
}

let cachedProcessSecret: Uint8Array | null = null;
function getProcessSecret(): Uint8Array {
  if (cachedProcessSecret) return cachedProcessSecret;
  const secret = new Uint8Array(32);
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.getRandomValues) {
    c.getRandomValues(secret);
  } else {
    // Defensive fallback — Math.random is NOT cryptographically secure,
    // but every modern runtime we ship into has crypto.getRandomValues.
    for (let i = 0; i < secret.length; i++) secret[i] = Math.floor(Math.random() * 256);
  }
  cachedProcessSecret = secret;
  return secret;
}

function randomNonce(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * HMAC-SHA-256 keyed by `key`, hashing the UTF-8 bytes of `message`.
 * Returns base64url (no padding) so the result is safe in URLs without
 * percent-encoding. We use the synchronous fallback here because
 * `generateOAuth2State` is called from synchronous flow setup; HMAC over
 * 32-byte key + ~80-byte message via inline impl is microseconds.
 */
function hmacB64Url(key: Uint8Array, message: string): string {
  // Inline HMAC-SHA-256 — the WebCrypto API is async and we want a sync
  // call here to keep `generateOAuth2State` synchronous (matches the
  // existing API). For the tiny inputs we hash, this is cheap.
  const blockSize = 64;
  let k = key;
  if (k.length > blockSize) k = sha256Bytes(k);
  if (k.length < blockSize) {
    const padded = new Uint8Array(blockSize);
    padded.set(k);
    k = padded;
  }
  const oKeyPad = new Uint8Array(blockSize);
  const iKeyPad = new Uint8Array(blockSize);
  for (let i = 0; i < blockSize; i++) {
    oKeyPad[i] = k[i] ^ 0x5c;
    iKeyPad[i] = k[i] ^ 0x36;
  }
  const msgBytes = new TextEncoder().encode(message);
  const inner = new Uint8Array(iKeyPad.length + msgBytes.length);
  inner.set(iKeyPad);
  inner.set(msgBytes, iKeyPad.length);
  const innerHash = sha256Bytes(inner);
  const outer = new Uint8Array(oKeyPad.length + innerHash.length);
  outer.set(oKeyPad);
  outer.set(innerHash, oKeyPad.length);
  return bytesToB64Url(sha256Bytes(outer));
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function bytesToB64Url(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ── inline SHA-256 (FIPS 180-4) ──────────────────────────────────────────────
// Used to keep `generateOAuth2State` synchronous. Not exported — callers
// outside this module should use crypto.subtle.digest instead.
const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function sha256Bytes(bytes: Uint8Array): Uint8Array {
  const bitLen = bytes.length * 8;
  // Padding: 0x80 + zeros + 64-bit big-endian length, total ≡ 0 mod 64.
  let padLen = 56 - ((bytes.length + 1) % 64);
  if (padLen < 0) padLen += 64;
  const padded = new Uint8Array(bytes.length + 1 + padLen + 8);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  // 32-bit lengths in JS — high 32 bits zero in practice for our inputs.
  const dv = new DataView(padded.buffer, padded.byteOffset, padded.byteLength);
  dv.setUint32(padded.length - 4, bitLen >>> 0, false);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;
  const W = new Uint32Array(64);
  for (let block = 0; block < padded.length; block += 64) {
    for (let t = 0; t < 16; t++) {
      W[t] = dv.getUint32(block + t * 4, false);
    }
    for (let t = 16; t < 64; t++) {
      const w15 = W[t - 15];
      const w2 = W[t - 2];
      const s0 = ((w15 >>> 7) | (w15 << 25)) ^ ((w15 >>> 18) | (w15 << 14)) ^ (w15 >>> 3);
      const s1 = ((w2 >>> 17) | (w2 << 15)) ^ ((w2 >>> 19) | (w2 << 13)) ^ (w2 >>> 10);
      W[t] = (W[t - 16] + s0 + W[t - 7] + s1) >>> 0;
    }
    let a = h0,
      b = h1,
      c = h2,
      d = h3,
      e = h4,
      f = h5,
      g = h6,
      h = h7;
    for (let t = 0; t < 64; t++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const T1 = (h + S1 + ch + SHA256_K[t] + W[t]) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const T2 = (S0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + T1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (T1 + T2) >>> 0;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }
  const out = new Uint8Array(32);
  const outDv = new DataView(out.buffer);
  outDv.setUint32(0, h0, false);
  outDv.setUint32(4, h1, false);
  outDv.setUint32(8, h2, false);
  outDv.setUint32(12, h3, false);
  outDv.setUint32(16, h4, false);
  outDv.setUint32(20, h5, false);
  outDv.setUint32(24, h6, false);
  outDv.setUint32(28, h7, false);
  return out;
}
