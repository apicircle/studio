// Headers — full sweep against the localhost mock server.
//
// Layers:
//   1. Behavioral: CRUD, disable, autocomplete (key + value), reserved
//      badges, auto-fed override, body-driven Content-Type, case merge.
//   2. Per-dictionary-entry wire sweep: every non-app entry in
//      HTTP_HEADERS_MAP is set in the editor and asserted on the wire
//      via the mock server's introspection endpoint.
//
// Each test routes its request to a unique /anything/<test-id> path so
// findLastByPath scopes the assertion to its own wire record. This keeps
// parallel-worker safety without serializing the file.

import { expect, test } from './fixtures/app';
import { HTTP_HEADERS_MAP } from '@apicircle/core';

const WEB_FORBIDDEN_HEADERS = new Set<string>([
  'Accept-Charset',
  'Accept-Encoding',
  'Connection',
  'Content-Length',
  'Cookie',
  'Date',
  'DNT',
  'Host',
  'Keep-Alive',
  'Origin',
  'Referer',
  'TE',
  'Trailer',
  'Transfer-Encoding',
  'Upgrade',
  'User-Agent',
  'Via',
  'Proxy-Authorization',
]);

function isWebForbidden(name: string): boolean {
  return WEB_FORBIDDEN_HEADERS.has(name) || /^Sec-/.test(name) || /^Proxy-/.test(name);
}

test.describe('Headers — behavioral sweep', () => {
  test('add / edit / delete / disable / duplicate', async ({ app, e2eMock, sidebar }) => {
    const path = '/anything/hdr-crud';
    await sidebar.createRequest('hdr-crud');
    await app.getByLabel('Request URL').fill(e2eMock.url(path));
    await app
      .getByRole('button', { name: /^Headers/ })
      .first()
      .click();

    // Add 6 rows: 1 to add, 1 to edit, 1 to delete, 1 to disable, 2 dup.
    for (let i = 1; i <= 6; i++) {
      await app.getByRole('button', { name: 'Add row' }).click();
    }
    await app.getByLabel('Headers key 1').fill('X-Test-Add');
    await app.getByLabel('Headers value 1').fill('first');
    await app.getByLabel('Headers key 2').fill('X-Test-Edit');
    await app.getByLabel('Headers value 2').fill('initial');
    await app.getByLabel('Headers key 3').fill('X-Test-Delete');
    await app.getByLabel('Headers value 3').fill('gone');
    await app.getByLabel('Headers key 4').fill('X-Test-Disable');
    await app.getByLabel('Headers value 4').fill('hidden');
    await app.getByLabel('Headers key 5').fill('X-Test-Dup');
    await app.getByLabel('Headers value 5').fill('one');
    await app.getByLabel('Headers key 6').fill('X-Test-Dup');
    await app.getByLabel('Headers value 6').fill('two');

    await app.getByLabel('Headers value 2').fill('edited');
    await app.getByLabel('Delete Headers row 3').click();
    await app.getByLabel('Enable header 3').uncheck();

    await app.getByRole('button', { name: /^Send$/ }).click();
    await expect(app.getByText('200').first()).toBeVisible();
    const wire = await e2eMock.findLastByPath((p) => p === path);
    expect(wire.headers['x-test-add']).toBe('first');
    expect(wire.headers['x-test-edit']).toBe('edited');
    expect(wire.headers['x-test-delete']).toBeUndefined();
    expect(wire.headers['x-test-disable']).toBeUndefined();
    expect(wire.headers['x-test-dup']).toBe('two');
  });

  test('key autocomplete — empty input shows full sorted list', async ({ app, sidebar }) => {
    await sidebar.createRequest('hdr-autocomplete-empty');
    await app
      .getByRole('button', { name: /^Headers/ })
      .first()
      .click();
    await app.getByRole('button', { name: 'Add row' }).click();
    await app.getByLabel('Headers key 1').click();
    const listbox = app.getByRole('listbox', { name: 'Header suggestions' });
    await expect(listbox).toBeVisible();
    const count = await listbox.getByRole('option').count();
    expect(count).toBeGreaterThanOrEqual(80);
  });

  test('key autocomplete — `Cont` prefix surfaces 8 Content-* entries', async ({
    app,
    sidebar,
  }) => {
    await sidebar.createRequest('hdr-autocomplete-prefix');
    await app
      .getByRole('button', { name: /^Headers/ })
      .first()
      .click();
    await app.getByRole('button', { name: 'Add row' }).click();
    await app.getByLabel('Headers key 1').fill('Cont');
    const listbox = app.getByRole('listbox', { name: 'Header suggestions' });
    await expect(listbox).toBeVisible();
    await expect(listbox.getByRole('option')).toHaveCount(8);
  });

  test('value recommendations open on focus, filter by substring, hide on `{{`', async ({
    app,
    sidebar,
  }) => {
    await sidebar.createRequest('hdr-value-rec');
    await app
      .getByRole('button', { name: /^Headers/ })
      .first()
      .click();
    await app.getByRole('button', { name: 'Add row' }).click();
    await app.getByLabel('Headers key 1').fill('Accept-Encoding');
    await app.keyboard.press('Escape');

    const valueInput = app.getByLabel('Headers value 1');
    await valueInput.click();
    const valueListbox = app.getByRole('listbox', { name: /Common values for header 1/ });
    await expect(valueListbox).toBeVisible();

    await valueInput.fill('gzip');
    await expect(valueListbox.locator('button', { hasText: /^gzip$/ })).toBeVisible();
    await expect(valueListbox.locator('button', { hasText: 'gzip, deflate, br' })).toBeVisible();

    await valueInput.fill('{{');
    await expect(valueListbox).not.toBeVisible();
  });

  test('reserved=app entries do NOT appear in suggestions', async ({ app, sidebar }) => {
    await sidebar.createRequest('hdr-reserved-app');
    await app
      .getByRole('button', { name: /^Headers/ })
      .first()
      .click();
    await app.getByRole('button', { name: 'Add row' }).click();
    await app.getByLabel('Headers key 1').fill('X-Client');
    const listbox = app.getByRole('listbox', { name: 'Header suggestions' });
    await expect(listbox).not.toBeVisible();
  });

  test('reserved=browser entries show the browser badge in suggestions', async ({
    app,
    sidebar,
  }) => {
    await sidebar.createRequest('hdr-reserved-browser');
    await app
      .getByRole('button', { name: /^Headers/ })
      .first()
      .click();
    await app.getByRole('button', { name: 'Add row' }).click();
    await app.getByLabel('Headers key 1').fill('Content-Length');
    const listbox = app.getByRole('listbox', { name: 'Header suggestions' });
    await expect(listbox).toBeVisible();
    const option = listbox.getByRole('option', { name: /Content-Length/ });
    await expect(option).toContainText('browser');
  });

  test('auto-fed headers (X-Client-* / X-Trace-Span-Id / traceparent) reach the wire', async ({
    app,
    e2eMock,
    sidebar,
  }) => {
    const path = '/anything/hdr-auto-fed';
    await sidebar.createRequest('hdr-auto-fed');
    await app.getByLabel('Request URL').fill(e2eMock.url(path));
    await app.getByRole('button', { name: /^Send$/ }).click();
    await expect(app.getByText('200').first()).toBeVisible();
    const wire = await e2eMock.findLastByPath((p) => p === path);
    expect(wire.headers['x-client-name']).toBe('APICircle Studio');
    expect(wire.headers['x-client-platform']).toBe('web');
    expect(wire.headers['x-client-version']).toMatch(/^\d+\.\d+\.\d+$/);
    expect(wire.headers['x-trace-span-id']).toMatch(/^[0-9a-f]{16}$/);
    expect(wire.headers['traceparent']).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
  });

  test('user override of an auto-fed header (case-insensitive) wins on the wire', async ({
    app,
    e2eMock,
    sidebar,
  }) => {
    const path = '/anything/hdr-auto-override';
    await sidebar.createRequest('hdr-auto-override');
    await app.getByLabel('Request URL').fill(e2eMock.url(path));
    await app
      .getByRole('button', { name: /^Headers/ })
      .first()
      .click();
    await app.getByRole('button', { name: 'Add row' }).click();
    await app.getByLabel('Headers key 1').fill('x-client-version');
    await app.keyboard.press('Escape');
    await app.getByLabel('Headers value 1').fill('99.99.99-test');
    await app.getByRole('button', { name: /^Send$/ }).click();
    await expect(app.getByText('200').first()).toBeVisible();
    const wire = await e2eMock.findLastByPath((p) => p === path);
    expect(wire.headers['x-client-version']).toBe('99.99.99-test');
  });

  test('per-send regeneration: X-Trace-Span-Id and traceparent differ across two sends', async ({
    app,
    e2eMock,
    sidebar,
  }) => {
    const path = '/anything/hdr-trace-regen';
    await sidebar.createRequest('hdr-trace-regen');
    await app.getByLabel('Request URL').fill(e2eMock.url(path));
    await app.getByRole('button', { name: /^Send$/ }).click();
    await expect(app.getByText('200').first()).toBeVisible();
    const first = await e2eMock.findLastByPath((p) => p === path);
    const firstSpan = first.headers['x-trace-span-id'];
    // Click Send again — same path, so we look for an entry where the
    // span id is DIFFERENT than the first.
    await app.getByRole('button', { name: /^Send$/ }).click();
    await expect(app.getByText('200').first()).toBeVisible();
    const deadline = Date.now() + 3000;
    let secondSpan: string | undefined;
    while (Date.now() < deadline) {
      const r = await fetch(`${e2eMock.baseUrl}/__inspect/last?n=50`);
      const body = (await r.json()) as {
        entries: Array<{ path: string; headers: Record<string, string> }>;
      };
      const match = body.entries.find(
        (e) => e.path === path && e.headers['x-trace-span-id'] !== firstSpan,
      );
      if (match) {
        secondSpan = match.headers['x-trace-span-id'];
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(secondSpan).toBeDefined();
    expect(secondSpan).not.toBe(firstSpan);
  });

  test('case-insensitive merge: lowercase content-type lands as one header on wire', async ({
    app,
    e2eMock,
    sidebar,
  }) => {
    const path = '/anything/hdr-ct-merge';
    await sidebar.createRequest('hdr-ct-merge');
    await app.getByLabel('Request URL').fill(e2eMock.url(path));
    await app.getByLabel('HTTP method').selectOption('POST');
    await app
      .getByRole('button', { name: /^Headers/ })
      .first()
      .click();
    await app.getByRole('button', { name: 'Add row' }).click();
    await app.getByLabel('Headers key 1').fill('content-type');
    await app.keyboard.press('Escape');
    await app.getByLabel('Headers value 1').fill('text/csv');
    await app.getByRole('button', { name: /^Send$/ }).click();
    await expect(app.getByText('200').first()).toBeVisible();
    const wire = await e2eMock.findLastByPath((p) => p === path);
    expect(wire.headers['content-type']).toBe('text/csv');
  });

  test('empty-key rows are omitted from the wire', async ({ app, e2eMock, sidebar }) => {
    const path = '/anything/hdr-empty-key';
    await sidebar.createRequest('hdr-empty-key');
    await app.getByLabel('Request URL').fill(e2eMock.url(path));
    await app
      .getByRole('button', { name: /^Headers/ })
      .first()
      .click();
    await app.getByRole('button', { name: 'Add row' }).click();
    await app.getByLabel('Headers value 1').fill('orphan-value-zzz');
    await app.getByRole('button', { name: /^Send$/ }).click();
    await expect(app.getByText('200').first()).toBeVisible();
    const wire = await e2eMock.findLastByPath((p) => p === path);
    expect(Object.values(wire.headers)).not.toContain('orphan-value-zzz');
  });
});

test.describe('Headers — per-dictionary-entry wire sweep', () => {
  const SKIP_NAMES = new Set<string>([
    'Sec-Fetch-Dest',
    'Sec-Fetch-Mode',
    'Sec-Fetch-Site',
    'Sec-Fetch-User',
  ]);

  const pickedNames =
    process.env.FULL_HEADER_SWEEP === '1'
      ? HTTP_HEADERS_MAP.filter((e) => e.reserved !== 'app' && !SKIP_NAMES.has(e.name)).map(
          (e) => e.name,
        )
      : [
          'Accept',
          'Accept-Language',
          'Authorization',
          'Cache-Control',
          'Content-Type',
          'If-Match',
          'X-API-Key',
          'X-Forwarded-For',
          'X-Request-ID',
          'baggage',
          'tracestate',
          'Cookie',
          'Host',
          'User-Agent',
        ];

  for (const name of pickedNames) {
    const entry = HTTP_HEADERS_MAP.find((e) => e.name === name)!;
    const value = entry.values[0] ?? `e2e-${name.toLowerCase()}-value`;
    const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '-');

    test(`"${name}" — set in editor → wire matches browser policy`, async ({
      app,
      e2eMock,
      sidebar,
    }) => {
      const path = `/anything/hdr-sweep-${slug}`;
      await sidebar.createRequest(`hdr-sweep-${slug}`);
      await app.getByLabel('Request URL').fill(e2eMock.url(path));
      await app
        .getByRole('button', { name: /^Headers/ })
        .first()
        .click();
      await app.getByRole('button', { name: 'Add row' }).click();
      await app.getByLabel('Headers key 1').fill(name);
      await app.keyboard.press('Escape');
      await app.getByLabel('Headers value 1').fill(value);
      await app.keyboard.press('Escape');
      await app.getByRole('button', { name: /^Send$/ }).click();
      await expect(app.getByText('200').first()).toBeVisible();
      const wire = await e2eMock.findLastByPath((p) => p === path);
      const got = wire.headers[name.toLowerCase()];
      const expected = value.trim();
      if (isWebForbidden(name)) {
        if (got !== undefined) expect(got).not.toBe(expected);
      } else {
        expect(got?.trim()).toBe(expected);
      }
    });
  }
});
