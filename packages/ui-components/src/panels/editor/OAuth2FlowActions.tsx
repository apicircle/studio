/**
 * OAuth2 flow-actions strip — sits below each OAuth2 grant's form in
 * the auth editor. Drives the actual token acquisition that the inline
 * form just collects config for.
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ [Get token]  [Refresh]  [Clear]      <token state summary>   │
 *   └──────────────────────────────────────────────────────────────┘
 *
 * - Get token: kicks off the grant-specific flow (code / pkce =
 *   browser redirect; client-credentials / ROPC = direct POST; device
 *   = polling).
 * - Refresh: only enabled when the IdP returned a refresh_token.
 * - Clear: drops the stored token + state — useful when the IdP
 *   rotated keys and the current token is permanently invalid.
 *
 * Persistence is the caller's job — we hand back the new auth payload
 * via `onChange`, the host wires it through the workspace store.
 */

import { useRef, useState } from 'react';
import { CheckCircle2, Copy, KeyRound, Loader2, RefreshCw, Trash2, XCircle } from 'lucide-react';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { refreshToken as runRefreshToken } from '@apicircle/core';
import { safeExternalHref } from '@apicircle/shared';
import { cn } from '../../primitives/cn';
import { ConfirmDialog } from '../../primitives/ConfirmDialog';
import type { createOAuth2Bridge } from '../../auth/oauth2Bridge';
import { acquireToken, type OAuth2Auth } from './acquireOAuth2Token';

interface OAuth2FlowActionsProps {
  auth: OAuth2Auth;
  onChange: (next: OAuth2Auth) => void;
  /**
   * Test seam — supply a deterministic bridge instead of the runtime
   * factory. Production code calls `createOAuth2Bridge()` lazily.
   */
  bridgeOverride?: ReturnType<typeof createOAuth2Bridge>;
}

interface FlowState {
  status: 'idle' | 'running' | 'success' | 'error' | 'device-pending';
  message?: string;
  /** Device-flow user code + verification URI to show the user. */
  device?: {
    userCode: string;
    verificationUri: string;
    verificationUriComplete?: string;
  };
  /**
   * Device-flow polling progress — updated by `pollDeviceFlow` via the
   * `onPoll` hook. Lets the UI tick a "still waiting…" indicator instead
   * of looking frozen during the multi-minute device-code window.
   */
  pollInfo?: {
    pollCount: number;
    elapsedMs: number;
  };
}

export function OAuth2FlowActions({ auth, onChange, bridgeOverride }: OAuth2FlowActionsProps) {
  const [state, setState] = useState<FlowState>({ status: 'idle' });
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  // Synchronous re-entry guard — `state.status` updates via setState are
  // only visible after React's next render, so two click events fired in
  // the same tick would both pass `state.status === 'idle'` and start
  // concurrent flows. The ref flips immediately, blocking the second
  // call before it can call `acquireToken`. The disabled attribute on
  // the button is a UI-level guard; this ref is the logic-level guard.
  const inflightRef = useRef(false);
  const hasToken = auth.accessToken.trim().length > 0;
  const expiresAt = auth.expiresAt ?? 0;
  const expiresInSeconds =
    expiresAt > 0 ? Math.max(0, Math.floor((expiresAt - Date.now()) / 1000)) : null;
  const isExpired = expiresAt > 0 && expiresAt < Date.now();
  const refreshTokenValue = 'refreshToken' in auth ? auth.refreshToken : '';
  // Refresh requires BOTH an accessToken (something to renew) AND a
  // refreshToken (the renewal credential). Without the access token,
  // "refresh" is meaningless — user should run the full flow to mint a
  // fresh pair instead.
  const canRefresh =
    hasToken && auth.type !== 'oauth2-implicit' && refreshTokenValue.trim().length > 0;

  const runFlow = async () => {
    // Re-entry guard: if a flow is already running, drop the click.
    // Prevents synchronous double-clicks (keyboard mash, programmatic
    // .click()) from starting parallel flows before React's render
    // cycle disables the button.
    if (inflightRef.current) return;
    inflightRef.current = true;
    setState({ status: 'running' });
    try {
      // Device flow needs to surface the user_code BEFORE polling starts —
      // the user has to type it into the IdP before our /token poll can
      // succeed. Other grants run as a single async call.
      const next = await acquireToken(auth, bridgeOverride, {
        onDeviceCode: (device) => {
          setState({
            status: 'device-pending',
            device: {
              userCode: device.userCode,
              verificationUri: device.verificationUri,
              verificationUriComplete: device.verificationUriComplete,
            },
          });
        },
        onPoll: (pollInfo) => {
          // Functional setState so we don't drop the device fields.
          setState((prev) => (prev.status === 'device-pending' ? { ...prev, pollInfo } : prev));
        },
      });
      onChange({
        ...auth,
        accessToken: next.accessToken,
        tokenType: next.tokenType,
        refreshToken: next.refreshToken ?? '',
        expiresAt: next.expiresIn ? Date.now() + next.expiresIn * 1000 : 0,
        obtainedScope: next.scope ?? auth.scope ?? '',
      } as OAuth2Auth);
      setState({ status: 'success', message: 'Token acquired.' });
    } catch (err) {
      setState({
        status: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      // Always release the in-flight guard, even on error — otherwise a
      // failed flow would lock the button until the component unmounts.
      inflightRef.current = false;
    }
  };

  const refresh = async () => {
    // Implicit grant doesn't have refresh tokens — the type system
    // models this by omitting `refreshToken` / `tokenUrl` from
    // OAuth2ImplicitAuth. Narrow before calling refresh.
    if (auth.type === 'oauth2-implicit') {
      setState({
        status: 'error',
        message: 'Implicit grant does not issue refresh tokens — re-run the flow instead.',
      });
      return;
    }
    if (!auth.refreshToken) {
      setState({ status: 'error', message: 'No refresh token to use.' });
      return;
    }
    setState({ status: 'running' });
    try {
      const clientSecret = 'clientSecret' in auth ? auth.clientSecret || undefined : undefined;
      const refreshed = await runRefreshToken({
        tokenUrl: auth.tokenUrl,
        clientId: auth.clientId,
        clientSecret,
        refreshToken: auth.refreshToken,
        scope: auth.scope || undefined,
      });
      // The spread + overrides keeps `auth.type` so TS narrows correctly
      // — no need for an `as OAuth2Auth` assertion here. (The other two
      // sites in this file DO need the assertion because their spread
      // adds fields the implicit type can't infer.)
      onChange({
        ...auth,
        accessToken: refreshed.accessToken,
        tokenType: refreshed.tokenType,
        refreshToken: refreshed.refreshToken ?? auth.refreshToken,
        expiresAt: refreshed.expiresIn ? Date.now() + refreshed.expiresIn * 1000 : 0,
        obtainedScope: refreshed.scope ?? auth.obtainedScope ?? '',
      });
      setState({ status: 'success', message: 'Token refreshed.' });
    } catch (err) {
      setState({
        status: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const clear = () => {
    onChange({
      ...auth,
      accessToken: '',
      refreshToken: '',
      expiresAt: 0,
      obtainedScope: '',
    } as OAuth2Auth);
    setState({ status: 'idle' });
  };

  return (
    <div className="mt-3 flex flex-col gap-2 rounded-sm border border-border-subtle bg-card/40 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void runFlow()}
          disabled={state.status === 'running' || state.status === 'device-pending'}
          className="inline-flex h-7 items-center gap-1.5 rounded-sm border border-accent/40 bg-accent/10 px-2 text-[0.6875rem] text-accent hover:bg-accent/20 disabled:opacity-50"
        >
          {state.status === 'running' ? (
            <Loader2 size={11} className="animate-spin" aria-hidden="true" />
          ) : (
            <KeyRound size={11} aria-hidden="true" />
          )}
          {hasToken ? 'Re-run flow' : flowButtonLabel(auth.type)}
        </button>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={!canRefresh || state.status === 'running'}
          className="inline-flex h-7 items-center gap-1.5 rounded-sm border border-border bg-surface px-2 text-[0.6875rem] text-text-primary hover:bg-card disabled:opacity-40"
        >
          <RefreshCw size={11} aria-hidden="true" />
          Refresh
        </button>
        <button
          type="button"
          onClick={() => setConfirmClearOpen(true)}
          disabled={!hasToken || state.status === 'running'}
          className="inline-flex h-7 items-center gap-1.5 rounded-sm border border-border bg-surface px-2 text-[0.6875rem] text-text-muted hover:border-danger/40 hover:text-danger disabled:opacity-40"
        >
          <Trash2 size={11} aria-hidden="true" />
          Clear
        </button>
        <TokenStateSummary
          hasToken={hasToken}
          isExpired={isExpired}
          expiresInSeconds={expiresInSeconds}
        />
      </div>

      {state.status === 'success' && state.message && (
        <p className="inline-flex items-center gap-1.5 text-[0.6875rem] text-success">
          <CheckCircle2 size={11} aria-hidden="true" />
          {state.message}
        </p>
      )}
      {state.status === 'error' && state.message && (
        <div
          className="flex flex-wrap items-center gap-2 rounded-sm border border-danger/30 bg-danger/5 px-2 py-1.5 text-[0.6875rem] text-danger"
          role="alert"
        >
          <XCircle size={11} aria-hidden="true" />
          <span className="flex-1 break-words">{state.message}</span>
          {/*
            Refresh failures are usually because the IdP rotated keys or
            the refresh token expired. Re-authorize is the actionable next
            step — surface it inline so the user doesn't have to find the
            primary button again.
          */}
          <button
            type="button"
            onClick={() => void runFlow()}
            className="inline-flex h-6 items-center gap-1 rounded-sm border border-accent/40 bg-accent/10 px-2 text-[0.625rem] text-accent hover:bg-accent/20"
          >
            <KeyRound size={10} aria-hidden="true" />
            Re-authorize
          </button>
        </div>
      )}
      {state.status === 'device-pending' && state.device && (
        <DeviceCodeHint device={state.device} pollInfo={state.pollInfo} />
      )}

      <ConfirmDialog
        open={confirmClearOpen}
        title="Clear OAuth2 token?"
        description={
          <p>
            Wipes the cached access token, refresh token, expiry, and obtained scope. The IdP
            configuration (client id, scopes, URLs) is kept. You will need to re-run the flow to get
            a new token.
          </p>
        }
        confirmLabel="Clear token"
        tone="danger"
        onCancel={() => setConfirmClearOpen(false)}
        onConfirm={() => {
          clear();
          setConfirmClearOpen(false);
        }}
      />
    </div>
  );
}

function flowButtonLabel(type: OAuth2Auth['type']): string {
  switch (type) {
    case 'oauth2-auth-code':
    case 'oauth2-pkce':
      return 'Authorize';
    case 'oauth2-implicit':
      return 'Authorize (implicit)';
    case 'oauth2-device':
      return 'Start device flow';
    case 'oauth2-client-credentials':
    case 'oauth2-password':
      return 'Get token';
  }
}

function TokenStateSummary({
  hasToken,
  isExpired,
  expiresInSeconds,
}: {
  hasToken: boolean;
  isExpired: boolean;
  expiresInSeconds: number | null;
}) {
  if (!hasToken) {
    return <span className="ml-auto text-[0.6875rem] text-text-dim">No token yet.</span>;
  }
  if (isExpired) {
    return (
      <span className="ml-auto inline-flex items-center gap-1 text-[0.6875rem] text-warning">
        <XCircle size={11} aria-hidden="true" />
        Token expired — refresh or re-run flow.
      </span>
    );
  }
  const expiry =
    expiresInSeconds === null
      ? 'no expiry recorded'
      : expiresInSeconds > 60
        ? `expires in ${Math.floor(expiresInSeconds / 60)} min`
        : `expires in ${expiresInSeconds}s`;
  return (
    <span className="ml-auto inline-flex items-center gap-1 text-[0.6875rem] text-text-muted">
      <CheckCircle2 size={11} className="text-success" aria-hidden="true" />
      Token cached · {expiry}
    </span>
  );
}

function DeviceCodeHint({
  device,
  pollInfo,
}: {
  device: NonNullable<FlowState['device']>;
  pollInfo?: NonNullable<FlowState['pollInfo']>;
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-1 rounded-sm border border-accent/30 bg-accent/5 px-3 py-2 text-[0.6875rem]',
      )}
      role="status"
      aria-live="polite"
    >
      <p className="flex flex-wrap items-center gap-1 text-text-primary">
        Visit{' '}
        {/* IdP returns verification_uri verbatim — restrict scheme to http(s)
            before rendering as a clickable link, otherwise a hostile IdP
            could push javascript:/data:/file: at us. Unsafe values still
            render as plain text so the user can copy them out manually. */}
        {(() => {
          const safe = safeExternalHref(device.verificationUri);
          return safe ? (
            <a
              href={safe}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent underline"
            >
              {device.verificationUri}
            </a>
          ) : (
            <span
              className="font-mono text-text-muted"
              title="Unsupported URL scheme — copy manually"
            >
              {device.verificationUri}
            </span>
          );
        })()}{' '}
        and enter code: <code className="font-mono text-accent">{device.userCode}</code>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard
              .writeText(device.userCode)
              .then(() =>
                useWorkspaceStore.getState().pushToast({
                  tone: 'success',
                  title: 'Code copied',
                  ttlMs: 1500,
                }),
              )
              .catch(() =>
                useWorkspaceStore.getState().pushToast({
                  tone: 'error',
                  title: 'Copy failed',
                  detail: 'Clipboard access denied — copy the code manually.',
                }),
              );
          }}
          aria-label={`Copy device code ${device.userCode}`}
          title="Copy device code"
          className="inline-flex h-5 w-5 items-center justify-center rounded-sm text-text-faint hover:text-text-primary"
        >
          <Copy size={10} aria-hidden="true" />
        </button>
      </p>
      {device.verificationUriComplete &&
        (() => {
          const safeComplete = safeExternalHref(device.verificationUriComplete);
          if (!safeComplete) return null;
          return (
            <p className="text-text-dim">
              Or open{' '}
              <a
                href={safeComplete}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent underline"
              >
                this pre-filled link
              </a>{' '}
              to skip typing.
            </p>
          );
        })()}
      {pollInfo && (
        <p className="text-text-dim">
          Waiting for authorization… (poll #{pollInfo.pollCount},{' '}
          {Math.floor(pollInfo.elapsedMs / 1000)}s elapsed)
        </p>
      )}
    </div>
  );
}
