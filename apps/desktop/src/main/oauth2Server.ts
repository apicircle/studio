/**
 * OAuth2 callback server — runs in the Electron main process. The
 * renderer (web bundle) doesn't have permission to bind a TCP port, so
 * any flow that requires a localhost callback (auth-code, PKCE, implicit)
 * tunnels through here:
 *
 *   1. Renderer calls `findFreePort(preferred)` to get a port the OS will
 *      let us bind. We try a small range so the user's pre-registered
 *      redirect_uri (e.g. http://localhost:8081/callback) keeps working
 *      across restarts.
 *
 *   2. Renderer calls `startCallbackServer({ port, mode })`. We bind, start
 *      listening, return immediately — the caller is responsible for
 *      opening the IdP authorize URL in the system browser.
 *
 *   3. The IdP redirects the browser to http://localhost:<port>/callback
 *      with `?code=...&state=...` (auth-code mode) or `#access_token=...`
 *      (implicit mode). For implicit, the browser strips the fragment
 *      before sending it to us, so we serve a tiny relay HTML page that
 *      reads `location.hash` client-side and re-redirects with the
 *      values as query params.
 *
 *   4. We parse the query, render a "you can close this tab" page,
 *      shut the server down, and resolve the original promise.
 *
 * Security:
 *  - Bind to 127.0.0.1 only — never 0.0.0.0. A non-loopback bind would
 *    let a co-located process intercept the auth code.
 *  - Single-shot: server closes on first callback or timeout.
 *  - State validation is the renderer's job (we don't see the original
 *    `state` value); we just hand the parsed params back.
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';

const DEFAULT_TIMEOUT_MS = 120_000;

export interface CallbackResult {
  /** Auth-code grant: `?code=...&state=...`. */
  code?: string;
  /** Implicit grant: relayed `#access_token=...&token_type=...&...`. */
  accessToken?: string;
  tokenType?: string;
  expiresIn?: number;
  scope?: string;
  state?: string;
  /** Error from `?error=...` — `access_denied`, `invalid_request`, etc. */
  error?: string;
  errorDescription?: string;
  /** Final port we bound (callers may have asked for a range). */
  port: number;
  redirectUri: string;
}

export interface StartCallbackArgs {
  port: number;
  /**
   * `code` for auth-code / PKCE; `token` for implicit grant. Determines
   * whether we serve the fragment-relay HTML on `/callback`.
   */
  mode: 'code' | 'token';
  /** Path the IdP redirects to. Defaults to `/callback`. */
  callbackPath?: string;
  /** Hard timeout — defaults to 120s. The IdP redirect must arrive within this. */
  timeoutMs?: number;
  /** Test seam — provides a custom server factory (defaults to node:http.createServer). */
  serverFactory?: typeof createServer;
}

/**
 * Try to bind a TCP listener on `preferred` first; if it's in use, walk
 * up `preferred + 1`, `+2`, ... up to `range` slots. Returns the first
 * free port. Throws when the entire range is occupied.
 *
 * Important: ports < 1024 are privileged on Linux/macOS; the IdP-side
 * callback URL almost always uses a high port (8080, 8081, ...) anyway.
 */
export async function findFreePort(preferred: number, range: number = 10): Promise<number> {
  for (let i = 0; i < range; i++) {
    const port = preferred + i;
    if (await isPortFree(port)) return port;
  }
  throw new Error(`No free port available in range ${preferred}..${preferred + range - 1}`);
}

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => {
      probe.close(() => resolve(true));
    });
    probe.listen(port, '127.0.0.1');
  });
}

/**
 * Start the callback server. Returns a promise that resolves with the
 * parsed callback params once the IdP redirects, or rejects on timeout.
 *
 * Side effects:
 *  - Binds 127.0.0.1:<port>.
 *  - Closes itself on first callback OR timeout.
 *  - Does NOT open a browser — caller is expected to call shell.openExternal()
 *    with the IdP authorize URL after `startCallbackServer` returns its
 *    promise (we don't await the redirect promise before opening because
 *    the caller may want to do extra setup first).
 */
export async function startCallbackServer(args: StartCallbackArgs): Promise<CallbackResult> {
  const callbackPath = args.callbackPath ?? '/callback';
  const factory = args.serverFactory ?? createServer;
  const timeoutMs = args.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return new Promise<CallbackResult>((resolve, reject) => {
    let settled = false;

    // `server` is referenced inside `finish` and inside the request handler
    // closure passed to `factory(...)`. Both references resolve at call
    // time (not declaration time), so this lazy capture is safe even
    // though the `const server = factory(...)` line appears below.
    const finish = (result: CallbackResult | Error) => {
      if (settled) return;
      settled = true;
      try {
        server.close();
      } catch {
        /* server may already be closed */
      }
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (result instanceof Error) reject(result);
      else resolve(result);
    };

    const timeoutHandle = setTimeout(() => {
      finish(new Error(`OAuth2 callback timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const server: Server = factory((req: IncomingMessage, res: ServerResponse) => {
      handleRequest(req, res, args, callbackPath, finish);
    });

    server.on('error', (err) => finish(err));
    server.listen(args.port, '127.0.0.1', () => {
      const address = server.address();
      const actualPort = address && typeof address === 'object' ? address.port : args.port;
      // We resolve only when the redirect arrives, but capture the actual
      // port now so the redirect URL we hand to the IdP is correct.
      void actualPort; // no-op — the caller asked for `args.port` and we honor it.
    });
  });
}

function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  args: StartCallbackArgs,
  callbackPath: string,
  finish: (result: CallbackResult | Error) => void,
): void {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${args.port}`);

  if (url.pathname !== callbackPath) {
    // Anything that isn't the callback path gets a 404 — keeps the
    // server tight and avoids accidentally serving stuff we didn't mean to.
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('Not Found');
    return;
  }

  // Implicit mode: token comes in the fragment, which the browser strips
  // before sending. We serve a relay HTML page that reads location.hash
  // and re-redirects to /callback?<the same params>.
  if (
    args.mode === 'token' &&
    !url.searchParams.has('access_token') &&
    !url.searchParams.has('error')
  ) {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(FRAGMENT_RELAY_HTML);
    return;
  }

  const result: CallbackResult = {
    code: url.searchParams.get('code') ?? undefined,
    accessToken: url.searchParams.get('access_token') ?? undefined,
    tokenType: url.searchParams.get('token_type') ?? undefined,
    expiresIn: url.searchParams.has('expires_in')
      ? Number(url.searchParams.get('expires_in'))
      : undefined,
    scope: url.searchParams.get('scope') ?? undefined,
    state: url.searchParams.get('state') ?? undefined,
    error: url.searchParams.get('error') ?? undefined,
    errorDescription: url.searchParams.get('error_description') ?? undefined,
    port: args.port,
    redirectUri: `http://localhost:${args.port}${callbackPath}`,
  };

  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(result.error ? renderErrorPage(result.error, result.errorDescription) : SUCCESS_HTML);

  finish(result);
}

/** Tiny self-closing success page. Same UX as v1's Tauri server. */
const SUCCESS_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Sign-in complete</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
           background: #0f0e17; color: #fffffe; display: grid; place-items: center; height: 100vh; margin: 0; }
    .card { text-align: center; max-width: 24rem; padding: 2rem; border-radius: 8px;
            background: #232036; box-shadow: 0 4px 12px rgba(0,0,0,0.3); }
    h1 { font-size: 1.25rem; margin: 0 0 0.5rem; color: #a786df; }
    p { font-size: 0.875rem; margin: 0; color: #b4b3c9; }
  </style>
</head>
<body>
  <div class="card">
    <h1>You can close this tab.</h1>
    <p>Sign-in complete. APICircle Studio captured the credentials and stored them in the request.</p>
  </div>
  <script>setTimeout(() => window.close(), 2000);</script>
</body>
</html>`;

function renderErrorPage(error: string, description?: string): string {
  const safeError = error.replace(/[<>&"]/g, (c) => `&#${c.charCodeAt(0)};`);
  const safeDesc = (description ?? '').replace(/[<>&"]/g, (c) => `&#${c.charCodeAt(0)};`);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Sign-in failed</title>
<style>body{font-family:sans-serif;background:#0f0e17;color:#fffffe;display:grid;place-items:center;height:100vh;margin:0}
.card{text-align:center;max-width:30rem;padding:2rem;border-radius:8px;background:#232036}
h1{color:#ff6b6b;margin:0 0 0.5rem}p{color:#b4b3c9;font-size:0.875rem}code{background:#0f0e17;padding:2px 6px;border-radius:3px}</style>
</head><body><div class="card"><h1>Sign-in failed</h1><p>The IdP returned <code>${safeError}</code>.</p>
${safeDesc ? `<p>${safeDesc}</p>` : ''}<p>Close this tab and check the auth panel for details.</p></div></body></html>`;
}

/**
 * Implicit-grant fragment relay. The browser strips `#...` before
 * sending the URL to our callback server, so we serve this stub page
 * and let it re-redirect with the fragment values promoted to query
 * params. v1's Rust server used the same pattern; we mirror it byte-for-
 * byte where possible so existing IdP configs work without re-registration.
 */
const FRAGMENT_RELAY_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Completing sign-in…</title></head>
<body>
<script>
(function () {
  var hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : '';
  var search = window.location.search.startsWith('?') ? window.location.search.slice(1) : '';
  var combined = [search, hash].filter(Boolean).join('&');
  window.location.replace(window.location.pathname + '?' + combined);
})();
</script>
<noscript>JavaScript is required to complete sign-in. Please enable it and retry.</noscript>
</body></html>`;

/**
 * Open the IdP authorize URL in the user's default browser. Thin
 * wrapper so the bridge can be unit-tested without bringing Electron
 * into the test runtime — tests inject a fake `openExternal`. The
 * default path lazy-imports `electron.shell`, which keeps this module
 * loadable from `vitest` (which has no electron runtime).
 */
export async function openInBrowser(
  url: string,
  openExternal?: (url: string) => Promise<void>,
): Promise<void> {
  if (openExternal) {
    await openExternal(url);
    return;
  }
  // Lazy import — Electron isn't loadable from a non-electron Node
  // (e.g. the vitest runtime). At call-time we know we're in main.
  const electron = (await import('electron')) as {
    shell: { openExternal: (url: string) => Promise<void> };
  };
  await electron.shell.openExternal(url);
}
