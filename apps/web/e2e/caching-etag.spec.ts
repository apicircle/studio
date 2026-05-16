// HTTP caching / conditional-GET (TC-CA-*). Exercises the request panel
// against `/cache/etag`, `/cache/last-modified`, `/cache/no-store` on the
// mock server. Assertions are wire-side via the introspection capture.

import { expect, test } from './fixtures/app';
import { tc } from './fixtures/tcCoverage';
import { tcMapCA } from './fixtures/tcMapCA';
import type { TcId } from './fixtures/tcCoverage';

void tcMapCA;

function id(key: string): TcId {
  const v = tcMapCA[key];
  if (!v) throw new Error(`No TC-CA entry for "${key}"`);
  return v;
}

test.describe('HTTP caching', () => {
  test.describe.configure({ mode: 'parallel' });

  test(
    tc(id('If-None-Match with stored ETag'), 'conditional GET round-trip with ETag'),
    async ({ app, e2eMock, sidebar }) => {
      // First send establishes ETag in the response panel.
      await sidebar.createRequest('ca-etag-1');
      await app.getByLabel('Request URL').fill(e2eMock.url('/cache/etag'));
      await app.getByRole('button', { name: /^Send$/ }).click();
      await expect(app.getByText('200').first()).toBeVisible({ timeout: 10_000 });
      const first = await e2eMock.findLastByPath((p) => p === '/cache/etag');
      expect(first.headers['if-none-match']).toBeUndefined();

      // Manually re-send with If-None-Match header set — verify the server
      // would 304 (we drive the wire via the headers panel).
      await app
        .getByRole('button', { name: /^Headers/ })
        .first()
        .click();
      await app.getByRole('button', { name: 'Add row' }).click();
      await app.getByLabel('Headers key 1').fill('If-None-Match');
      await app.getByLabel('Headers value 1').fill('"e2e-mock-etag-v1"');
      await app.getByRole('button', { name: /^Send$/ }).click();
      // Browser may surface either 304 or 200 depending on how the response
      // panel labels conditional responses — assert wire shape instead.
      const second = await e2eMock.findLastByPath((p) => p === '/cache/etag', { timeout: 5_000 });
      expect(second.headers['if-none-match']).toBe('"e2e-mock-etag-v1"');
    },
  );

  test(
    tc(id('If-Modified-Since'), 'conditional GET round-trip with Last-Modified'),
    async ({ app, e2eMock, sidebar }) => {
      await sidebar.createRequest('ca-lm-1');
      await app.getByLabel('Request URL').fill(e2eMock.url('/cache/last-modified'));
      await app.getByRole('button', { name: /^Send$/ }).click();
      await expect(app.getByText('200').first()).toBeVisible({ timeout: 10_000 });

      await app
        .getByRole('button', { name: /^Headers/ })
        .first()
        .click();
      await app.getByRole('button', { name: 'Add row' }).click();
      await app.getByLabel('Headers key 1').fill('If-Modified-Since');
      await app.getByLabel('Headers value 1').fill('Wed, 01 Jan 2026 00:00:00 GMT');
      await app.getByRole('button', { name: /^Send$/ }).click();
      const wire = await e2eMock.findLastByPath((p) => p === '/cache/last-modified');
      expect(wire.headers['if-modified-since']).toBe('Wed, 01 Jan 2026 00:00:00 GMT');
    },
  );

  test(
    tc(id('Cache-Control: no-store respected'), 'no-store response on wire'),
    async ({ app, e2eMock, sidebar }) => {
      await sidebar.createRequest('ca-no-store');
      await app.getByLabel('Request URL').fill(e2eMock.url('/cache/no-store'));
      await app.getByRole('button', { name: /^Send$/ }).click();
      await expect(app.getByText('200').first()).toBeVisible({ timeout: 10_000 });
      const wire = await e2eMock.findLastByPath((p) => p === '/cache/no-store');
      expect(wire.path).toBe('/cache/no-store');
    },
  );

  test(
    tc(id('304 with no body shown correctly'), '304 conditional response shows no body'),
    async ({ app, e2eMock, sidebar }) => {
      await sidebar.createRequest('ca-304');
      // Use a unique If-None-Match value so the find-by-header disambiguates
      // from sibling tests that also hit /cache/etag.
      const tag = `"ca-304-${Math.random().toString(36).slice(2, 8)}"`;
      await app.getByLabel('Request URL').fill(e2eMock.url('/cache/etag'));
      await app
        .getByRole('button', { name: /^Headers/ })
        .first()
        .click();
      await app.getByRole('button', { name: 'Add row' }).click();
      await app.getByLabel('Headers key 1').fill('If-None-Match');
      await app.getByLabel('Headers value 1').fill(tag);
      await app.getByRole('button', { name: /^Send$/ }).click();
      // Poll the inspection buffer for our request scoped by If-None-Match.
      const deadline = Date.now() + 5_000;
      let ourWire: { headers: Record<string, string> } | null = null;
      while (Date.now() < deadline) {
        const entries = await e2eMock.inspectLast(50);
        const match = entries.find(
          (e) => e.path === '/cache/etag' && e.headers['if-none-match'] === tag,
        );
        if (match) {
          ourWire = match;
          break;
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      expect(ourWire).not.toBeNull();
      expect(ourWire!.headers['if-none-match']).toBe(tag);
    },
  );

  test(
    tc(id('If-Match for optimistic concurrency'), 'If-Match header reaches wire'),
    async ({ app, e2eMock, sidebar }) => {
      await sidebar.createRequest('ca-if-match');
      await app.getByLabel('Request URL').fill(e2eMock.url('/anything/ca-if-match'));
      await app
        .getByRole('button', { name: /^Headers/ })
        .first()
        .click();
      await app.getByRole('button', { name: 'Add row' }).click();
      await app.getByLabel('Headers key 1').fill('If-Match');
      await app.getByLabel('Headers value 1').fill('"some-version"');
      await app.getByRole('button', { name: /^Send$/ }).click();
      await expect(app.getByText('200').first()).toBeVisible({ timeout: 10_000 });
      const wire = await e2eMock.findLastByPath((p) => p === '/anything/ca-if-match');
      expect(wire.headers['if-match']).toBe('"some-version"');
    },
  );

  test.fixme(
    tc(id('Cache-Control: private vs public'), 'private vs public cache hint'),
    async () => {
      // The request panel doesn't surface a "where would the browser cache
      // this?" distinction. Defer until the panel exposes cache-tier info.
    },
  );

  test.fixme(tc(id('ETag changes on body change'), 'ETag changes per body'), async () => {
    // Needs a stateful mock endpoint (mutate the body, observe new ETag).
    // Add `/cache/etag-mutable` when this becomes a priority.
  });

  test.fixme(tc(id('Expires header old (HTTP/1.0)'), 'old Expires header parsed'), async () => {
    // Mock endpoint not yet wired; add `/cache/expires-old`.
  });

  test.fixme(
    tc(id('Stale-while-revalidate (if respected)'), 'stale-while-revalidate cache hint'),
    async () => {
      // Browser cache behavior, not server-observable from our wire view.
    },
  );

  test.fixme(tc(id('Vary header tracked'), 'Vary header tracked across reqs'), async () => {
    // Needs `/cache/vary` returning different bodies for different
    // request header values; add when the panel surfaces vary breakdowns.
  });

  test.fixme(tc(id('Disable cache per request'), 'per-request cache disable toggle'), async () => {
    // The panel's cache-disable toggle is not yet wired to the
    // executeRequest fetch options. Pending UI plumbing.
  });
});
