/**
 * Pure grant-dispatch logic for the OAuth2 flow buttons. Lives in its
 * own module (rather than alongside `OAuth2FlowActions.tsx`) so:
 *
 *   1. Vite's React fast-refresh stays happy — the rule "a file may
 *      export only components" only applies to TSX modules. Splitting
 *      the helper into a `.ts` file keeps HMR for the React component.
 *   2. Unit tests can import `acquireToken` directly without pulling in
 *      React, jsdom, or the rest of the auth-tab UI.
 *
 * Production callers (the React component) wrap this in `runFlow`. Tests
 * call it directly with a synthetic `OAuth2Bridge` to drive each grant
 * branch — most importantly the CSRF rejection paths for auth-code,
 * PKCE, and implicit (RFC 6749 §10.12).
 */

import {
  buildAuthorizeUrl,
  computeCodeChallenge,
  exchangeAuthCode,
  exchangePkce,
  generateCodeVerifier,
  pollDeviceFlow,
  requestDeviceAuthorization,
  runClientCredentials,
  runRopc,
  type OAuth2TokenResponse,
} from '@apicircle/core';
import type { RequestAuth } from '@apicircle/shared';
import {
  createOAuth2Bridge,
  generateOAuth2State,
  validateOAuth2State,
  type OAuth2Bridge,
} from '../../auth/oauth2Bridge';

export type OAuth2Auth = Extract<
  RequestAuth,
  | { type: 'oauth2-client-credentials' }
  | { type: 'oauth2-auth-code' }
  | { type: 'oauth2-pkce' }
  | { type: 'oauth2-password' }
  | { type: 'oauth2-implicit' }
  | { type: 'oauth2-device' }
>;

export interface AcquireTokenCallbacks {
  /**
   * Fired exactly once for the device flow when the IdP returns a
   * device authorization response — gives the UI a chance to display
   * the user_code + verification_uri before `pollDeviceFlow` starts.
   */
  onDeviceCode?: (info: {
    userCode: string;
    verificationUri: string;
    verificationUriComplete?: string;
  }) => void;
  /**
   * Fired before each poll cycle in the device flow. Lets the UI tick
   * a progress indicator so the user sees we're alive while they enter
   * the code on the IdP side.
   */
  onPoll?: (info: { pollCount: number; elapsedMs: number }) => void;
}

export async function acquireToken(
  auth: OAuth2Auth,
  bridgeOverride?: OAuth2Bridge,
  callbacks: AcquireTokenCallbacks = {},
): Promise<OAuth2TokenResponse> {
  switch (auth.type) {
    case 'oauth2-client-credentials':
      return runClientCredentials({
        tokenUrl: auth.tokenUrl,
        clientId: auth.clientId,
        clientSecret: auth.clientSecret,
        scope: auth.scope || undefined,
        clientAuthMethod: auth.clientAuthMethod,
      });

    case 'oauth2-password':
      return runRopc({
        tokenUrl: auth.tokenUrl,
        clientId: auth.clientId,
        clientSecret: auth.clientSecret || undefined,
        username: auth.username,
        password: auth.password,
        scope: auth.scope || undefined,
        clientAuthMethod: 'header',
      });

    case 'oauth2-auth-code': {
      const bridge = bridgeOverride ?? createOAuth2Bridge();
      const port = await bridge.findFreePort(8080);
      const redirectUri = bridge.getRedirectUri({ port });
      // Bind state to the (clientId, redirectUri) tuple via HMAC so a state
      // observed in one flow cannot be replayed against a different client/
      // redirect — OAuth 2.0 stateless CSRF defense (RFC 6749 §10.12 +
      // OWASP cheat sheet). The matching `validateOAuth2State` re-derives
      // and verifies the MAC; without `stateContext` the validator falls
      // back to bare-nonce equality, which is materially weaker.
      const stateContext = `${auth.clientId}:${redirectUri}`;
      const state = generateOAuth2State(stateContext);
      const authorizeUrl = buildAuthorizeUrl({
        authorizeUrl: auth.authUrl,
        clientId: auth.clientId,
        redirectUri,
        responseType: 'code',
        scope: auth.scope || undefined,
        state,
      });
      const callback = await bridge.startFlow({
        authorizeUrl,
        state,
        mode: 'code',
        port,
      });
      if (callback.error) {
        throw new Error(
          `${callback.error}${callback.errorDescription ? `: ${callback.errorDescription}` : ''}`,
        );
      }
      // RFC 6749 §10.12: state MUST be present in the callback and MUST
      // match what we sent. Silently accepting a missing state is the
      // classic CSRF vector — fail closed instead.
      if (!validateOAuth2State(callback.state, state, stateContext)) {
        throw new Error('OAuth2 state missing or mismatched — possible CSRF attempt');
      }
      if (!callback.code) throw new Error('No code received from authorization endpoint');
      return exchangeAuthCode({
        tokenUrl: auth.tokenUrl,
        clientId: auth.clientId,
        clientSecret: auth.clientSecret || undefined,
        code: callback.code,
        redirectUri,
      });
    }

    case 'oauth2-pkce': {
      const bridge = bridgeOverride ?? createOAuth2Bridge();
      const port = await bridge.findFreePort(8080);
      const redirectUri = bridge.getRedirectUri({ port });
      const stateContext = `${auth.clientId}:${redirectUri}`;
      const state = generateOAuth2State(stateContext);
      const verifier = generateCodeVerifier();
      const challenge = await computeCodeChallenge(verifier, 'S256');
      const authorizeUrl = buildAuthorizeUrl({
        authorizeUrl: auth.authUrl,
        clientId: auth.clientId,
        redirectUri,
        responseType: 'code',
        scope: auth.scope || undefined,
        state,
        extraParams: { code_challenge: challenge, code_challenge_method: 'S256' },
      });
      const callback = await bridge.startFlow({
        authorizeUrl,
        state,
        mode: 'code',
        port,
      });
      if (callback.error) {
        throw new Error(
          `${callback.error}${callback.errorDescription ? `: ${callback.errorDescription}` : ''}`,
        );
      }
      if (!validateOAuth2State(callback.state, state, stateContext)) {
        throw new Error('OAuth2 state missing or mismatched — possible CSRF attempt');
      }
      if (!callback.code) throw new Error('No code received from authorization endpoint');
      return exchangePkce({
        tokenUrl: auth.tokenUrl,
        clientId: auth.clientId,
        clientSecret: auth.clientSecret || undefined,
        code: callback.code,
        redirectUri,
        codeVerifier: verifier,
      });
    }

    case 'oauth2-implicit': {
      const bridge = bridgeOverride ?? createOAuth2Bridge();
      const port = await bridge.findFreePort(8080);
      const redirectUri = bridge.getRedirectUri({ port });
      const stateContext = `${auth.clientId}:${redirectUri}`;
      const state = generateOAuth2State(stateContext);
      const authorizeUrl = buildAuthorizeUrl({
        authorizeUrl: auth.authUrl,
        clientId: auth.clientId,
        redirectUri,
        responseType: 'token',
        scope: auth.scope || undefined,
        state,
      });
      const callback = await bridge.startFlow({
        authorizeUrl,
        state,
        mode: 'token',
        port,
      });
      if (callback.error) {
        throw new Error(
          `${callback.error}${callback.errorDescription ? `: ${callback.errorDescription}` : ''}`,
        );
      }
      // Implicit grant: state MUST round-trip too (RFC 6749 §10.12).
      if (!validateOAuth2State(callback.state, state, stateContext)) {
        throw new Error('OAuth2 state missing or mismatched — possible CSRF attempt');
      }
      if (!callback.accessToken) {
        throw new Error('No access_token received from authorize endpoint');
      }
      // Implicit returns a token directly — wrap into the
      // OAuth2TokenResponse shape callers expect.
      return {
        accessToken: callback.accessToken,
        tokenType: callback.tokenType ?? 'Bearer',
        expiresIn: callback.expiresIn,
        scope: callback.scope,
        raw: { ...callback },
      };
    }

    case 'oauth2-device': {
      // Device flow per RFC 8628 — clients are typically PUBLIC
      // (clientSecret omitted) because they run on devices that can't
      // keep secrets. The OAuth2DeviceAuth type omits clientSecret for
      // that reason; if a confidential-client device flow is ever
      // needed, the caller can shape that via extraParams.
      const device = await requestDeviceAuthorization({
        deviceAuthorizationUrl: auth.deviceAuthUrl,
        clientId: auth.clientId,
        scope: auth.scope || undefined,
      });
      // Surface the user_code + verification_uri to the UI BEFORE we
      // start polling — the user has to type the code into the IdP at
      // the verification URI for our /token poll to succeed. Without
      // this hook the user sees a spinner with no instructions and
      // wonders why nothing's happening.
      callbacks.onDeviceCode?.({
        userCode: device.userCode,
        verificationUri: device.verificationUri,
        verificationUriComplete: device.verificationUriComplete,
      });
      return pollDeviceFlow({
        tokenUrl: auth.tokenUrl,
        clientId: auth.clientId,
        deviceCode: device.deviceCode,
        intervalSeconds: device.interval,
        maxWaitMs: device.expiresIn * 1000,
        onPoll: callbacks.onPoll,
      });
    }
  }
}
