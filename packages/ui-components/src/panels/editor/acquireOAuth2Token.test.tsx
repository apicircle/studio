/**
 * Coverage for `acquireToken` in `OAuth2FlowActions.tsx` — the unit that
 * dispatches each OAuth2 grant after the bridge returns. This file
 * focuses on the CSRF protection paths (auth-code / PKCE / implicit):
 *
 *   - The IdP redirect MUST echo back the state we sent (RFC 6749 §10.12).
 *   - A missing `state` in the callback is a CSRF vector; fail closed.
 *   - A mismatched `state` is also a CSRF vector; fail closed.
 *   - When state matches, the grant proceeds and exchanges the code.
 *
 * `acquireToken` is exported just for these tests — production code only
 * uses it through the React wrapper. We pass a synthetic bridge that
 * returns canned `startFlow` payloads so each branch is reachable without
 * a real popup window.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestAuth } from '@apicircle/shared';
import { acquireToken } from './acquireOAuth2Token';
import type { OAuth2Bridge, OAuth2CallbackResult } from '../../auth/oauth2Bridge';

interface FakeBridgeOpts {
  /** What `startFlow` resolves with — usually the IdP's echoed state. */
  callback?: Partial<OAuth2CallbackResult>;
  /** Override the state value that startFlow returns (defaults to whatever was passed). */
  echoState?: string | undefined;
}

function makeBridge(opts: FakeBridgeOpts = {}): OAuth2Bridge {
  return {
    findFreePort: vi.fn().mockResolvedValue(0),
    startFlow: vi.fn(async (args): Promise<OAuth2CallbackResult> => {
      const echoed = 'echoState' in opts ? opts.echoState : args.state;
      return {
        port: 0,
        redirectUri: 'http://localhost/oauth-callback.html',
        code: 'auth-code',
        accessToken: opts.callback?.accessToken,
        tokenType: opts.callback?.tokenType,
        expiresIn: opts.callback?.expiresIn,
        scope: opts.callback?.scope,
        error: opts.callback?.error,
        errorDescription: opts.callback?.errorDescription,
        ...opts.callback,
        // Echo state by default; tests pass `echoState: undefined` to
        // force the missing-state branch.
        state: echoed,
      };
    }),
    getRedirectUri: () => 'http://localhost/oauth-callback.html',
  };
}

const baseAuthCode = (): Extract<RequestAuth, { type: 'oauth2-auth-code' }> => ({
  type: 'oauth2-auth-code',
  authUrl: 'https://idp/authorize',
  tokenUrl: 'https://idp/token',
  clientId: 'c',
  clientSecret: 's',
  redirectUri: '',
  scope: 'read',
  state: '',
  accessToken: '',
  tokenType: 'Bearer',
  refreshToken: '',
  expiresAt: null,
  obtainedScope: '',
});

const basePkce = (): Extract<RequestAuth, { type: 'oauth2-pkce' }> => ({
  type: 'oauth2-pkce',
  authUrl: 'https://idp/authorize',
  tokenUrl: 'https://idp/token',
  clientId: 'c',
  clientSecret: '',
  codeVerifier: '',
  codeChallengeMethod: 'S256',
  redirectUri: '',
  scope: 'read',
  state: '',
  accessToken: '',
  tokenType: 'Bearer',
  refreshToken: '',
  expiresAt: null,
  obtainedScope: '',
});

const baseImplicit = (): Extract<RequestAuth, { type: 'oauth2-implicit' }> => ({
  type: 'oauth2-implicit',
  authUrl: 'https://idp/authorize',
  clientId: 'c',
  redirectUri: '',
  scope: '',
  accessToken: '',
  tokenType: 'Bearer',
  expiresAt: null,
  obtainedScope: '',
});

// Every browser-redirect grant exchanges the code through fetchToken,
// which we stub at the network layer. Mock once per test.
beforeEach(() => {
  globalThis.fetch = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          access_token: 'tk-after-exchange',
          token_type: 'Bearer',
          expires_in: 3600,
          scope: 'read',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
  ) as unknown as typeof fetch;
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('acquireToken — auth-code CSRF rejection', () => {
  it('throws when the IdP omits state from the callback', async () => {
    const bridge = makeBridge({ echoState: undefined });
    await expect(acquireToken(baseAuthCode(), bridge)).rejects.toThrow(
      /state missing or mismatched/i,
    );
  });

  it('throws when the IdP echoes a different state value', async () => {
    const bridge = {
      findFreePort: vi.fn().mockResolvedValue(0),
      startFlow: vi.fn(async () => ({
        port: 0,
        redirectUri: 'http://localhost/oauth-callback.html',
        code: 'auth-code',
        state: 'attacker-supplied-state',
      })),
      getRedirectUri: () => 'http://localhost/oauth-callback.html',
    };
    await expect(acquireToken(baseAuthCode(), bridge)).rejects.toThrow(
      /state missing or mismatched/i,
    );
  });

  it('proceeds to exchange the code when state matches', async () => {
    const bridge = makeBridge();
    const tk = await acquireToken(baseAuthCode(), bridge);
    expect(tk.accessToken).toBe('tk-after-exchange');
    expect(tk.tokenType).toBe('Bearer');
  });

  it('surfaces an IdP-returned error before checking state', async () => {
    // If the IdP itself returned `error=access_denied`, we throw with
    // that error — which is more informative than "state missing"
    // (state is often absent on error redirects).
    const bridge = makeBridge({
      callback: {
        error: 'access_denied',
        errorDescription: 'user cancelled',
        code: undefined,
      },
      echoState: undefined,
    });
    await expect(acquireToken(baseAuthCode(), bridge)).rejects.toThrow(
      /access_denied.*user cancelled/i,
    );
  });
});

describe('acquireToken — PKCE CSRF rejection', () => {
  it('throws when the IdP omits state from the callback', async () => {
    const bridge = makeBridge({ echoState: undefined });
    await expect(acquireToken(basePkce(), bridge)).rejects.toThrow(/state missing or mismatched/i);
  });

  it('throws when the IdP echoes a different state value', async () => {
    const bridge = {
      findFreePort: vi.fn().mockResolvedValue(0),
      startFlow: vi.fn(async () => ({
        port: 0,
        redirectUri: 'http://localhost/oauth-callback.html',
        code: 'auth-code',
        state: 'wrong-state',
      })),
      getRedirectUri: () => 'http://localhost/oauth-callback.html',
    };
    await expect(acquireToken(basePkce(), bridge)).rejects.toThrow(/state missing or mismatched/i);
  });

  it('emits code_challenge + code_challenge_method=S256 in the authorize URL', async () => {
    const bridge = makeBridge();
    await acquireToken(basePkce(), bridge);
    const startCall = (bridge.startFlow as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(startCall.authorizeUrl).toMatch(/code_challenge=/);
    expect(startCall.authorizeUrl).toMatch(/code_challenge_method=S256/);
  });

  it('proceeds to exchange the code when state matches', async () => {
    const bridge = makeBridge();
    const tk = await acquireToken(basePkce(), bridge);
    expect(tk.accessToken).toBe('tk-after-exchange');
  });
});

describe('acquireToken — implicit CSRF rejection', () => {
  // Previously implicit had no state check at all — this was the worst
  // gap closed in cycle 3.4. Lock that in.
  it('throws when the IdP omits state from the callback', async () => {
    const bridge = {
      findFreePort: vi.fn().mockResolvedValue(0),
      startFlow: vi.fn(async () => ({
        port: 0,
        redirectUri: 'http://localhost/oauth-callback.html',
        accessToken: 'tk-from-fragment',
        tokenType: 'Bearer',
        // state intentionally undefined — pre-cycle-3.4 we'd accept this.
      })),
      getRedirectUri: () => 'http://localhost/oauth-callback.html',
    };
    await expect(acquireToken(baseImplicit(), bridge)).rejects.toThrow(
      /state missing or mismatched/i,
    );
  });

  it('throws when the IdP echoes a different state value', async () => {
    const bridge = {
      findFreePort: vi.fn().mockResolvedValue(0),
      startFlow: vi.fn(async () => ({
        port: 0,
        redirectUri: 'http://localhost/oauth-callback.html',
        accessToken: 'tk-from-fragment',
        tokenType: 'Bearer',
        state: 'wrong-state',
      })),
      getRedirectUri: () => 'http://localhost/oauth-callback.html',
    };
    await expect(acquireToken(baseImplicit(), bridge)).rejects.toThrow(
      /state missing or mismatched/i,
    );
  });

  it('returns the fragment-supplied access_token when state matches', async () => {
    const bridge = makeBridge({
      callback: {
        accessToken: 'tk-from-fragment',
        tokenType: 'Bearer',
        expiresIn: 600,
      },
    });
    const tk = await acquireToken(baseImplicit(), bridge);
    expect(tk.accessToken).toBe('tk-from-fragment');
    expect(tk.tokenType).toBe('Bearer');
    expect(tk.expiresIn).toBe(600);
  });
});

describe('acquireToken — non-redirect grants do not invoke the bridge', () => {
  it('client-credentials calls fetch directly, never opens a popup', async () => {
    const bridge = makeBridge();
    const tk = await acquireToken(
      {
        type: 'oauth2-client-credentials',
        tokenUrl: 'https://idp/token',
        clientId: 'c',
        clientSecret: 's',
        scope: 'read',
        clientAuthMethod: 'header',
        accessToken: '',
        tokenType: 'Bearer',
        refreshToken: '',
        expiresAt: null,
        obtainedScope: '',
      },
      bridge,
    );
    expect(tk.accessToken).toBe('tk-after-exchange');
    expect(bridge.startFlow).not.toHaveBeenCalled();
    expect(bridge.findFreePort).not.toHaveBeenCalled();
  });

  it('ROPC (password) calls fetch directly, never opens a popup', async () => {
    const bridge = makeBridge();
    const tk = await acquireToken(
      {
        type: 'oauth2-password',
        tokenUrl: 'https://idp/token',
        clientId: 'c',
        clientSecret: 's',
        username: 'alice',
        password: 'p',
        scope: '',
        accessToken: '',
        tokenType: 'Bearer',
        refreshToken: '',
        expiresAt: null,
        obtainedScope: '',
      },
      bridge,
    );
    expect(tk.accessToken).toBe('tk-after-exchange');
    expect(bridge.startFlow).not.toHaveBeenCalled();
  });
});
