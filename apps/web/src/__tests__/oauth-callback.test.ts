/**
 * Coverage for `apps/web/public/oauth-callback.html` — the static popup
 * relay that runs inside the OAuth2 popup window when the IdP redirects
 * back to us. The relay has no framework, just inline JS, and was the
 * largest untested surface in the OAuth callback story.
 *
 * Strategy: read the HTML file, extract the inline `<script>` block,
 * set up a jsdom window with controlled `location` + a mock
 * `BroadcastChannel` + a mock `window.opener.postMessage`, then `eval`
 * the script inside the window's context. Because the script is wrapped
 * in an IIFE and reads `window.location` / `BroadcastChannel` /
 * `window.opener` / `document` from globals, eval'ing it against the
 * patched window is a faithful replay of what runs in the real popup.
 *
 * Note: Phase 3c (2026-05-13) removed the `localStorage` fallback — it
 * emitted a `storage` event to every same-origin tab, briefly exposing
 * the access token. The new fallback is `window.opener.postMessage` with
 * `targetOrigin = window.location.origin`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const HTML_PATH = resolve(__dirname, '../../public/oauth-callback.html');

function extractInlineScript(): string {
  const html = readFileSync(HTML_PATH, 'utf8');
  // The relay has exactly one inline <script> block. Anchor on the
  // opening + closing tags so we don't accidentally capture comments.
  const match = /<script>([\s\S]*?)<\/script>/m.exec(html);
  if (!match) throw new Error('no <script> block in oauth-callback.html');
  return match[1]!;
}

interface BroadcastMessage {
  channel: string;
  payload: unknown;
}

interface PostedMessage {
  payload: unknown;
  targetOrigin: string;
}

interface RelayContext {
  posted: BroadcastMessage[];
  openerPosts: PostedMessage[];
  /** Mutable counter — incremented every time the relay calls window.close(). */
  closeCount: { value: number };
}

function setupWindow(
  searchAndHash: { search?: string; hash?: string },
  options: { opener?: 'present' | 'closed' | 'absent' } = {},
): RelayContext {
  const posted: BroadcastMessage[] = [];
  const openerPosts: PostedMessage[] = [];
  const closeCount = { value: 0 };

  // Patch location — jsdom forbids direct mutation, so define our own.
  const url =
    'http://localhost:5174/oauth-callback.html' +
    (searchAndHash.search ?? '') +
    (searchAndHash.hash ?? '');

  delete (window as any).location;

  (window as any).location = new URL(url);
  // The script reads `window.location.search` / `.hash` directly; URL
  // exposes those props. .search starts with '?' when present, .hash
  // starts with '#' — matches the original DOM contract.

  // Mock BroadcastChannel — capture every postMessage so the test can
  // assert the payload that reached the listener.
  class MockBroadcastChannel {
    constructor(public name: string) {}
    postMessage(payload: unknown): void {
      posted.push({ channel: this.name, payload });
    }
    close(): void {
      /* noop */
    }
  }

  (window as any).BroadcastChannel = MockBroadcastChannel;

  // window.opener — the same-origin postMessage fallback target. Three
  // shapes a test might want to exercise:
  //   - 'present' (default): a normal opener with a `postMessage` method.
  //   - 'closed':   opener exists but `.closed === true` (Studio tab was
  //                 closed before sign-in completed).
  //   - 'absent':   `window.opener === null` (user opened the auth page
  //                 in a fresh tab from clipboard instead of via popup).
  const openerMode = options.opener ?? 'present';
  if (openerMode === 'absent') {
    (window as any).opener = null;
  } else {
    (window as any).opener = {
      closed: openerMode === 'closed',
      postMessage: (payload: unknown, targetOrigin: string) => {
        openerPosts.push({ payload, targetOrigin });
      },
    };
  }

  // Stub window.close — script schedules it via setTimeout; tests use
  // fake timers so we can synchronously confirm it was called.

  (window as any).close = () => {
    closeCount.value++;
  };

  return { posted, openerPosts, closeCount };
}

function runRelayScript(): void {
  const script = extractInlineScript();
  // Evaluate inside the jsdom window. `Function('with(window) {…}')` keeps
  // implicit globals routed through the patched window.location etc.
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function(script).call(window);
}

describe('oauth-callback.html relay', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Inject minimal DOM the script touches (#card / #title / #message).
    document.body.innerHTML = `
      <div class="card" id="card">
        <h1 id="title">You can close this tab.</h1>
        <p id="message">Sign-in complete.</p>
      </div>
    `;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('parses ?code=&state= from search and posts to apicircle-oauth-<state>', () => {
    const ctx = setupWindow({ search: '?code=abc-123&state=xyz' });
    runRelayScript();

    expect(ctx.posted).toHaveLength(1);
    expect(ctx.posted[0]!.channel).toBe('apicircle-oauth-xyz');
    expect(ctx.posted[0]!.payload).toMatchObject({
      code: 'abc-123',
      state: 'xyz',
    });
  });

  it('promotes implicit-grant fragment params (#access_token=…) into the payload', () => {
    const ctx = setupWindow({
      hash: '#access_token=tk-implicit&token_type=Bearer&expires_in=3600&state=imp',
    });
    runRelayScript();

    expect(ctx.posted).toHaveLength(1);
    expect(ctx.posted[0]!.channel).toBe('apicircle-oauth-imp');
    expect(ctx.posted[0]!.payload).toMatchObject({
      accessToken: 'tk-implicit',
      tokenType: 'Bearer',
      expiresIn: 3600,
      state: 'imp',
    });
  });

  it('merges search and hash params (search wins on key collision)', () => {
    // Hawkish edge case: if BOTH search and hash carry `state`, the
    // hash's value should be set last (the script does this on purpose
    // so implicit-grant tokens override). Verify the actual contract.
    const ctx = setupWindow({
      search: '?code=from-search',
      hash: '#access_token=from-hash&state=imp',
    });
    runRelayScript();

    const payload = ctx.posted[0]!.payload as Record<string, unknown>;
    expect(payload.code).toBe('from-search');
    expect(payload.accessToken).toBe('from-hash');
    expect(payload.state).toBe('imp');
  });

  it('renders the error UI and posts error/error_description when IdP returns ?error=', () => {
    const ctx = setupWindow({
      search: '?error=access_denied&error_description=user%20cancelled&state=err',
    });
    runRelayScript();

    expect(ctx.posted[0]!.payload).toMatchObject({
      error: 'access_denied',
      errorDescription: 'user cancelled',
      state: 'err',
    });

    // Visible error styling + headline.
    expect(document.getElementById('card')!.className).toBe('err');
    expect(document.getElementById('title')!.textContent).toBe('Sign-in failed');
    expect(document.getElementById('message')!.innerHTML).toContain('access_denied');
  });

  it('also posts to window.opener with targetOrigin = location.origin', () => {
    // Phase 3c (2026-05-13): same-origin postMessage to window.opener is
    // the canonical delivery channel for the popup flow. The relay does
    // it ALONGSIDE BroadcastChannel so a parent that only listens on
    // `message` events still receives the payload. The targetOrigin must
    // be the popup's own origin so the payload cannot land anywhere else.
    const ctx = setupWindow({ search: '?code=both&state=ok' });
    runRelayScript();

    expect(ctx.posted).toHaveLength(1);
    expect(ctx.openerPosts).toHaveLength(1);
    expect(ctx.openerPosts[0]!.targetOrigin).toBe('http://localhost:5174');
    expect(ctx.openerPosts[0]!.payload).toMatchObject({
      code: 'both',
      state: 'ok',
    });
  });

  it('falls back to window.opener.postMessage when BroadcastChannel is unavailable', () => {
    const ctx = setupWindow({ search: '?code=fallback&state=ls' });

    (window as any).BroadcastChannel = function () {
      throw new Error('disabled');
    };
    runRelayScript();

    // Channel path failed…
    expect(ctx.posted).toHaveLength(0);
    // …but the same-origin postMessage path delivered the payload.
    expect(ctx.openerPosts).toHaveLength(1);
    expect(ctx.openerPosts[0]!.targetOrigin).toBe('http://localhost:5174');
    expect(ctx.openerPosts[0]!.payload).toMatchObject({
      code: 'fallback',
      state: 'ls',
    });
  });

  it('does NOT write the access_token to localStorage (regression: storage event leak)', () => {
    // Phase 3c removed the localStorage fallback because `setItem` emits
    // a `storage` event to every same-origin tab — a brief access_token
    // exposure to any tab listening for storage events. Pin that the
    // relay never touches localStorage, even when BroadcastChannel fails.
    const setItem = vi.fn();
    (window as any).localStorage = {
      setItem,
      removeItem: vi.fn(),
      getItem: () => null,
    };
    setupWindow({ hash: '#access_token=tk&state=imp' });
    (window as any).BroadcastChannel = function () {
      throw new Error('disabled');
    };
    runRelayScript();
    expect(setItem).not.toHaveBeenCalled();
  });

  it('renders an error UI when neither BroadcastChannel nor opener is available', () => {
    const ctx = setupWindow({ search: '?code=lost&state=x' }, { opener: 'absent' });
    (window as any).BroadcastChannel = function () {
      throw new Error('disabled');
    };
    runRelayScript();

    expect(ctx.posted).toHaveLength(0);
    expect(ctx.openerPosts).toHaveLength(0);
    // User-visible message: relay surfaces the failure rather than
    // silently dropping the payload.
    expect(document.getElementById('title')!.textContent).toBe('Sign-in incomplete');
    expect(document.getElementById('message')!.textContent).toMatch(/Could not return tokens/i);
  });

  it('skips opener.postMessage when window.opener is closed', () => {
    const ctx = setupWindow({ search: '?code=c&state=s' }, { opener: 'closed' });
    runRelayScript();
    // BroadcastChannel still posts; closed opener is not touched.
    expect(ctx.posted).toHaveLength(1);
    expect(ctx.openerPosts).toHaveLength(0);
  });

  it('schedules window.close after a 250ms tick', () => {
    const ctx = setupWindow({ search: '?code=z&state=s' });
    runRelayScript();

    // Before the tick runs: close() not yet invoked.
    expect(ctx.closeCount.value).toBe(0);
    vi.advanceTimersByTime(250);
    expect(ctx.closeCount.value).toBe(1);
  });

  it('falls back to "no-state" channel when state is missing', () => {
    const ctx = setupWindow({ search: '?code=zz' });
    runRelayScript();
    expect(ctx.posted[0]!.channel).toBe('apicircle-oauth-no-state');
  });

  it('strips HTML metacharacters from the IdP error code before innerHTML insertion', () => {
    setupWindow({ search: '?error=<script>alert(1)</script>&state=x' });
    runRelayScript();
    // The script's regex `/[<>&"]/g` removes angle brackets / ampersands /
    // quotes from the IdP-supplied error code before splicing into
    // innerHTML. The relay wraps the result in a hardcoded `<code>…</code>`
    // tag — extract THAT element's text content and confirm no HTML
    // metacharacters survived from the attacker payload.
    const codeEl = document.querySelector('#message code');
    expect(codeEl).not.toBeNull();
    const injected = codeEl!.textContent ?? '';
    expect(injected).not.toContain('<');
    expect(injected).not.toContain('>');
    expect(injected).not.toContain('"');
    // Defense-in-depth: the message's full HTML should contain exactly
    // ONE pair of <code> tags — proves the attacker didn't sneak a
    // second tag through.
    const html = document.getElementById('message')!.innerHTML;
    expect((html.match(/<code>/g) ?? []).length).toBe(1);
    expect((html.match(/<\/code>/g) ?? []).length).toBe(1);
  });
});
