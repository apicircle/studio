/**
 * UI-level tests for `OAuth2FlowActions` — the React wrapper that owns
 * the per-grant flow buttons. The grant-dispatch logic itself lives in
 * `acquireOAuth2Token.ts` and is unit-tested separately
 * (`acquireOAuth2Token.test.tsx`); this file focuses on what the
 * component does ABOVE that helper:
 *
 *   - Disables the "Get token" / "Authorize" button while a flow is
 *     in-flight (the user-clicks-twice guard for gap #5).
 *   - Disables Refresh + Clear during a running flow.
 *   - Re-enables the buttons once the flow settles (success or error).
 */

import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { OAuth2FlowActions } from './OAuth2FlowActions';
import type { OAuth2Bridge, OAuth2CallbackResult } from '../../auth/oauth2Bridge';
import type { RequestAuth } from '@apicircle/shared';

type AuthCode = Extract<RequestAuth, { type: 'oauth2-auth-code' }>;

const baseAuthCode = (): AuthCode => ({
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

describe('OAuth2FlowActions — concurrent-click guard (gap #5)', () => {
  it('disables the Authorize button while the flow is running', async () => {
    // Bridge whose `startFlow` resolves only when we say so. Lets the
    // test inspect the in-flight UI state between click and resolution.
    let releaseStartFlow: (result: OAuth2CallbackResult) => void = () => {};
    const startFlowPromise = new Promise<OAuth2CallbackResult>((resolve) => {
      releaseStartFlow = resolve;
    });
    const bridge: OAuth2Bridge = {
      findFreePort: vi.fn().mockResolvedValue(0),
      startFlow: vi.fn().mockReturnValue(startFlowPromise),
      getRedirectUri: () => 'http://localhost/oauth-callback.html',
    };

    render(<OAuth2FlowActions auth={baseAuthCode()} onChange={vi.fn()} bridgeOverride={bridge} />);

    const authorizeBtn = screen.getByRole('button', { name: /^Authorize$/i });
    expect(authorizeBtn).toBeEnabled();

    // First click — starts the flow.
    await act(async () => {
      authorizeBtn.click();
      // Microtask flush so React schedules the `setState({ status: 'running' })`.
      await Promise.resolve();
    });

    // Now the button is disabled. A second click would be a no-op
    // (browsers don't dispatch click events to disabled buttons),
    // but we assert the disabled attribute directly so a regression
    // that drops the guard fails this test.
    expect(authorizeBtn).toBeDisabled();
    // Refresh + Clear are also disabled during a running flow.
    expect(screen.getByRole('button', { name: /^Refresh$/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^Clear$/i })).toBeDisabled();

    // startFlow was called exactly once even if the user keeps clicking.
    expect(bridge.startFlow).toHaveBeenCalledTimes(1);

    // Resolve the flow and confirm the buttons re-enable. We deliver a
    // callback whose state matches whatever the component generated;
    // since we don't see that, force the IdP echo to be undefined and
    // rely on the error handler to settle the in-flight state.
    await act(async () => {
      releaseStartFlow({
        port: 0,
        redirectUri: 'http://localhost/oauth-callback.html',
        // No state echoed → CSRF rejection. Settles the flow with an
        // error (status: 'error'), which still re-enables the button.
        code: 'c',
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(authorizeBtn).toBeEnabled();
  });

  it('rapid double-click does not start a second concurrent flow', async () => {
    // Browsers won't dispatch click events to disabled buttons, but
    // synthetic test events bypass that guard. This confirms the
    // disabled attribute is set in time to absorb a programmatic
    // double-click delivered before React's microtask flush.
    let releaseStartFlow: (result: OAuth2CallbackResult) => void = () => {};
    const startFlowPromise = new Promise<OAuth2CallbackResult>((resolve) => {
      releaseStartFlow = resolve;
    });
    const bridge: OAuth2Bridge = {
      findFreePort: vi.fn().mockResolvedValue(0),
      startFlow: vi.fn().mockReturnValue(startFlowPromise),
      getRedirectUri: () => 'http://localhost/oauth-callback.html',
    };

    render(<OAuth2FlowActions auth={baseAuthCode()} onChange={vi.fn()} bridgeOverride={bridge} />);

    const btn = screen.getByRole('button', { name: /^Authorize$/i });

    await act(async () => {
      btn.click();
      btn.click();
      btn.click();
      await Promise.resolve();
    });

    // Three rapid clicks — startFlow was only invoked once. The
    // disabled-attribute + React's state guard combine to absorb the
    // extras at the DOM level.
    expect(bridge.startFlow).toHaveBeenCalledTimes(1);

    // Cleanup so the pending Promise doesn't leak.
    await act(async () => {
      releaseStartFlow({
        port: 0,
        redirectUri: 'http://localhost/oauth-callback.html',
        code: 'c',
      });
      await Promise.resolve();
    });
  });
});
