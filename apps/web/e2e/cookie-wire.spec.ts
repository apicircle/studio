// Cycle 12 — Cookie wire-level via the Vite same-origin proxy.
//
// Browser fetch SILENTLY STRIPS the `Cookie` header when set as a
// custom header on the request. Even on same-origin requests this is
// blocked at the User-Agent layer per the Fetch spec (Cookie is a
// User-Agent-managed header). So you can NOT test "user typed Cookie:
// foo=bar in the headers tab → mock receives Cookie" through fetch.
//
// What you CAN test:
//   1. Server emits Set-Cookie on a same-origin response.
//   2. Browser stores the cookie scoped to that origin.
//   3. Subsequent same-origin request auto-includes it (default fetch
//      `credentials: 'same-origin'` semantics).
//
// That's what this spec exercises — it proves the same-origin proxy
// path works end-to-end for cookie state. The api-key auth's
// `addTo: 'cookie'` writes the Cookie header on the request payload;
// the browser then strips it (silently). This is the documented
// browser-mode limitation in our auth docs and isn't worth testing
// via wire here — it'd just lock in current Chromium behavior.

import { expect, test } from './fixtures/app';

test.describe('Cookie on wire — same-origin proxy (C12)', () => {
  test('Set-Cookie response on same-origin request → browser auto-includes cookie on next request', async ({
    app,
    e2eMock,
    sidebar,
  }) => {
    // Step 1: hit /_mock/cookies/set/sid/c12-token (same-origin via
    // Vite proxy). The mock emits Set-Cookie: sid=c12-token. The browser
    // stores the cookie under the localhost:5174 origin.
    await sidebar.createRequest('c12-set-cookie');
    await app.getByLabel('Request URL').fill(e2eMock.sameOriginUrl('/cookies/set/sid/c12-token'));
    await app.getByRole('button', { name: /^Send$/ }).click();
    await expect(app.getByText('200').first()).toBeVisible();

    // Step 2: hit /_mock/anything/c12-cookie-followup (same-origin).
    // No explicit Cookie header — fetch auto-includes it because
    // localhost:5174 has the sid cookie stored.
    await sidebar.createRequest('c12-cookie-followup');
    await app
      .getByLabel('Request URL')
      .fill(e2eMock.sameOriginUrl('/anything/c12-cookie-followup'));
    await app.getByRole('button', { name: /^Send$/ }).click();
    await expect(app.getByText('200').first()).toBeVisible();

    // Wire — the followup request carried the cookie auto-included by
    // the browser. This proves the same-origin proxy works end-to-end
    // for cookie state across requests.
    const hit = await e2eMock.findLastByPath((p) => p === '/anything/c12-cookie-followup');
    expect(hit.cookies.sid).toBe('c12-token');
  });
});
