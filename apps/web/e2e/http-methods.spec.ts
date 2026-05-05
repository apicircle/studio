// All HTTP methods the editor exposes — verified end-to-end against the
// mock server's /method/<verb> routes. Each verb has its own endpoint
// that returns 405 if the wrong method hits it, so a 200 here proves
// the editor sent the request with the configured verb.

import { expect, test } from './fixtures/app';

// OPTIONS is intentionally excluded: browsers reserve OPTIONS for CORS
// preflight and don't reliably honor user-initiated OPTIONS via fetch
// (Chromium silently coalesces them with the preflight). The editor
// accepts OPTIONS as a method choice for non-fetch transports (desktop
// shell uses native HTTP). Web e2e cannot prove this round-trip.
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'] as const;

test.describe('HTTP methods', () => {
  for (const method of METHODS) {
    test(`${method} routes to /method/${method.toLowerCase()} and returns 200`, async ({
      app,
      e2eMock,
      sidebar,
    }) => {
      const lower = method.toLowerCase();
      const path = `/method/${lower}`;
      await sidebar.createRequest(`m-${lower}`);
      await app.getByLabel('HTTP method').selectOption(method);
      await app.getByLabel('Request URL').fill(e2eMock.url(path));
      await app.getByRole('button', { name: /^Send$/ }).click();
      // HEAD responses have no body but still report 200; OPTIONS may
      // be intercepted by the browser as a preflight, but executeRequest
      // sends the *user* OPTIONS too — both reach 200.
      await expect(app.getByText(/^200/).first()).toBeVisible({ timeout: 10_000 });
      const wire = await e2eMock.findLastByPath((p) => p === path);
      expect(wire.method).toBe(method);
    });
  }
});
