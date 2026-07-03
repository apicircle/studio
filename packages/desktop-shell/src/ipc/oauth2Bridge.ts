import { ipcMain } from 'electron';
import { assertTrustedSender } from '../security/assertTrustedSender';
import { assertHttpUrl } from '../security/assertHttpUrl';
import {
  findFreePort,
  openInBrowser,
  startCallbackServer,
  type CallbackResult,
} from '../oauth2Server';

// =============================================================================
// OAuth2 callback bridge — wraps the localhost http server in oauth2Server.ts.
// The renderer drives flows via the Auth tab UI; this surface stays small
// (find a port, run a flow) so the attack surface is contained.
// =============================================================================

const CHANNEL = {
  findFreePort: 'apicircle:oauth2:findFreePort',
  startFlow: 'apicircle:oauth2:startFlow',
} as const;

export function registerOAuth2Bridge(): void {
  ipcMain.handle(CHANNEL.findFreePort, async (event, preferred: unknown) => {
    assertTrustedSender(event);
    // Clamp the preferred port to the unprivileged range. A compromised
    // renderer could otherwise probe privileged ports (22, 80, 443) or coerce
    // us into binding ephemeral and reading the result — both to be rejected.
    if (typeof preferred !== 'number' || !Number.isInteger(preferred)) {
      throw new Error('preferred must be an integer');
    }
    if (preferred < 1024 || preferred > 65535) {
      throw new Error('preferred must be in 1024..65535');
    }
    return findFreePort(preferred);
  });

  ipcMain.handle(
    CHANNEL.startFlow,
    async (
      event,
      args: {
        authorizeUrl: string;
        port: number;
        mode: 'code' | 'token';
        callbackPath?: string;
        timeoutMs?: number;
      },
    ): Promise<CallbackResult> => {
      assertTrustedSender(event);
      // Sub-5-second timeouts fire before the user even sees the IdP consent
      // screen — no realistic flow completes that fast. Reject up-front.
      if (args.timeoutMs !== undefined && args.timeoutMs < 5000) {
        throw new Error('timeoutMs must be at least 5000ms');
      }
      // Scheme allowlist: an unvalidated URL handed to shell.openExternal is an
      // RCE vector (ms-msdt:, smb:, file:, custom protocol handlers).
      const safeAuthorizeUrl = assertHttpUrl(args.authorizeUrl, 'authorizeUrl');
      // Validate callbackPath shape — we string-compare it inside the http
      // handler, and a renderer-controlled value should look like a path.
      if (args.callbackPath !== undefined) {
        if (
          typeof args.callbackPath !== 'string' ||
          !/^\/[A-Za-z0-9_\-./]{0,128}$/.test(args.callbackPath)
        ) {
          throw new Error('callbackPath must match /^\\/[A-Za-z0-9_\\-./]{0,128}$/');
        }
      }
      // Race the callback promise with the browser-open call. If the browser
      // fails to open, the user can still complete the flow by pasting the URL.
      const callbackPromise = startCallbackServer({
        port: args.port,
        mode: args.mode,
        callbackPath: args.callbackPath,
        timeoutMs: args.timeoutMs,
      });
      try {
        await openInBrowser(safeAuthorizeUrl);
      } catch (err) {
        console.error('[oauth2] failed to open authorize URL in browser:', err);
      }
      return callbackPromise;
    },
  );
}

export const OAUTH2_CHANNELS = CHANNEL;
