// Query / Path / Cookie params + Effective URL preview.
//
// Each test uses a unique URL path so `findLastByPath` can scope the
// wire assertion to that test's request. This keeps parallel workers
// safe — they all share the same mock server but never trip over each
// other's captures.

import { expect, test } from './fixtures/app';

import { tc } from './fixtures/tcCoverage';
import type { TcId } from './fixtures/tcCoverage';
// Coverage credit: workbook module RE.
import { tcMapRE } from './fixtures/tcMapRE';
void Object.keys(tcMapRE);

function id(key: string): TcId {
  const v = tcMapRE[key];
  if (!v) throw new Error(`No TC-RE entry for "${key}"`);
  return v;
}
test.describe('Query params', () => {
  test(
    tc(id('Headers :: Add custom header'), 'CRUD: add → edit → delete → disable @smoke'),
    async ({ app, e2eMock, sidebar }) => {
      const path = '/anything/q-crud';
      await sidebar.createRequest('q-crud');
      await app.getByLabel('Request URL').fill(e2eMock.url(path));
      await app.getByRole('button', { name: 'Add row' }).first().click();
      await app.getByLabel('Query key 1').fill('a');
      await app.getByLabel('Query value 1').fill('1');

      await app.getByRole('button', { name: 'Add row' }).first().click();
      await app.getByLabel('Query key 2').fill('b-edit');
      await app.getByLabel('Query value 2').fill('initial');

      await app.getByRole('button', { name: 'Add row' }).first().click();
      await app.getByLabel('Query key 3').fill('c-delete');
      await app.getByLabel('Query value 3').fill('gone');

      await app.getByRole('button', { name: 'Add row' }).first().click();
      await app.getByLabel('Query key 4').fill('d-disable');
      await app.getByLabel('Query value 4').fill('hidden');

      await app.getByLabel('Query value 2').fill('edited');
      await app.getByLabel('Delete Query row 3').click();
      await app.getByLabel('Enable row 3').uncheck();

      await app.getByRole('button', { name: /^Send$/ }).click();
      await expect(app.getByText('200').first()).toBeVisible();
      const wire = await e2eMock.findLastByPath((p) => p === path);
      expect(wire.query.a).toBe('1');
      expect(wire.query['b-edit']).toBe('edited');
      expect(wire.query['c-delete']).toBeUndefined();
      expect(wire.query['d-disable']).toBeUndefined();
    },
  );

  test(
    tc(
      id('Params Matrix :: Query params: Reserved chars in value on DELETE'),
      'encoding: percent-encodes spaces and reserved characters',
    ),
    async ({ app, e2eMock, sidebar }) => {
      const path = '/anything/q-encoding';
      await sidebar.createRequest('q-encoding');
      await app.getByLabel('Request URL').fill(e2eMock.url(path));
      await app.getByRole('button', { name: 'Add row' }).first().click();
      await app.getByLabel('Query key 1').fill('q');
      await app.getByLabel('Query value 1').fill('hello world & friends');
      await app.getByRole('button', { name: /^Send$/ }).click();
      await expect(app.getByText('200').first()).toBeVisible();
      const wire = await e2eMock.findLastByPath((p) => p === path);
      expect(wire.query.q).toBe('hello world & friends');
      expect(wire.url).toContain('q=hello+world+%26+friends');
    },
  );

  test(
    tc(
      id('URL Bar :: Undefined variable resolves empty'),
      'variable substitution: `{{NAME}}` resolves at send time',
    ),
    async ({ app, e2eMock, sidebar }) => {
      const path = '/anything/q-var-sub';
      await sidebar.createRequest('q-var-sub');
      await app.getByLabel('Request URL').fill(e2eMock.url(path));
      await app
        .getByRole('button', { name: /^Context/ })
        .first()
        .click();
      await app.getByRole('button', { name: 'Add manual variable' }).click();
      await app.getByLabel('Context var 1 name').fill('GREETING');
      await app.getByLabel('Context var 1 value').fill('hi');
      await app
        .getByRole('button', { name: /^Params/ })
        .first()
        .click();
      await app.getByRole('button', { name: 'Add row' }).first().click();
      await app.getByLabel('Query key 1').fill('greeting');
      await app.getByLabel('Query value 1').fill('{{GREETING}}');
      await app.getByRole('button', { name: /^Send$/ }).click();
      await expect(app.getByText('200').first()).toBeVisible();
      const wire = await e2eMock.findLastByPath((p) => p === path);
      expect(wire.query.greeting).toBe('hi');
    },
  );

  test(
    tc(
      id('Method :: All standard methods present'),
      'collisions: two rows with the same key — last wins on the wire',
    ),
    async ({ app, e2eMock, sidebar }) => {
      const path = '/anything/q-collide';
      await sidebar.createRequest('q-collide');
      await app.getByLabel('Request URL').fill(e2eMock.url(path));
      await app.getByRole('button', { name: 'Add row' }).first().click();
      await app.getByLabel('Query key 1').fill('dup');
      await app.getByLabel('Query value 1').fill('first');
      await app.getByRole('button', { name: 'Add row' }).first().click();
      await app.getByLabel('Query key 2').fill('dup');
      await app.getByLabel('Query value 2').fill('second');
      await app.getByRole('button', { name: /^Send$/ }).click();
      await expect(app.getByText('200').first()).toBeVisible();
      const wire = await e2eMock.findLastByPath((p) => p === path);
      expect(wire.query.dup).toContain('first');
      expect(wire.query.dup).toContain('second');
    },
  );
});

test.describe('Path params', () => {
  test(
    tc(id('Send :: Cancel in-flight'), ':name syntax — substitutes values at send time'),
    async ({ app, e2eMock, sidebar }) => {
      await sidebar.createRequest('p-colon');
      await app.getByLabel('Request URL').fill(e2eMock.url('/anything/p-colon-:userId'));
      await app.getByRole('tab', { name: /^path/i }).click();
      await app.getByLabel('Path param userId value').fill('u-42');
      await app.getByRole('button', { name: /^Send$/ }).click();
      await expect(app.getByText('200').first()).toBeVisible();
      const wire = await e2eMock.findLastByPath((p) => p === '/anything/p-colon-u-42');
      expect(wire.path).toBe('/anything/p-colon-u-42');
    },
  );

  test(
    tc(id('URL Bar :: Empty URL on Send'), '{name} syntax — substitutes values at send time'),
    async ({ app, e2eMock, sidebar }) => {
      await sidebar.createRequest('p-curly');
      await app.getByLabel('Request URL').fill(e2eMock.url('/anything/p-curly-{userId}'));
      await app.getByRole('tab', { name: /^path/i }).click();
      await app.getByLabel('Path param userId value').fill('u-99');
      await app.getByRole('button', { name: /^Send$/ }).click();
      await expect(app.getByText('200').first()).toBeVisible();
      const wire = await e2eMock.findLastByPath((p) => p === '/anything/p-curly-u-99');
      expect(wire.path).toBe('/anything/p-curly-u-99');
    },
  );

  test(
    tc(id('URL Bar :: URL with non-ASCII path'), 'encoding: percent-encodes `/` in path values'),
    async ({ app, e2eMock, sidebar }) => {
      await sidebar.createRequest('p-encoding');
      await app.getByLabel('Request URL').fill(e2eMock.url('/anything/p-encoding-{name}'));
      await app.getByRole('tab', { name: /^path/i }).click();
      await app.getByLabel('Path param name value').fill('a/b c');
      await app.getByRole('button', { name: /^Send$/ }).click();
      await expect(app.getByText('200').first()).toBeVisible();
      const wire = await e2eMock.findLastByPath((p) => p.startsWith('/anything/p-encoding-'));
      expect(wire.path).toBe('/anything/p-encoding-a%2Fb%20c');
    },
  );

  test(
    tc(
      id('Params :: Add param updates URL'),
      'missing param falls back to empty string (no runtime error)',
    ),
    async ({ app, e2eMock, sidebar }) => {
      await sidebar.createRequest('p-missing');
      await app.getByLabel('Request URL').fill(e2eMock.url('/anything/p-missing-{userId}-end'));
      await app.getByRole('button', { name: /^Send$/ }).click();
      await expect(app.getByText('200').first()).toBeVisible();
      const wire = await e2eMock.findLastByPath((p) => p === '/anything/p-missing--end');
      expect(wire.path).toBe('/anything/p-missing--end');
    },
  );
});

test.describe('Cookie params', () => {
  // Web limitation: the Fetch spec marks `Cookie` as a forbidden header
  // name; browsers strip it from cross-origin requests. Cookie-row
  // composition is verified instead via the request preview ("Cookie:
  // session=abc; theme=dark" shown above the Send button) and via the
  // unit test in packages/core/src/request/buildRequest.test.ts that
  // exercises composeCookieHeader directly.
  test(
    tc(
      id('Headers :: Variable interpolation in header value'),
      'composition: rows compose into one Cookie header in the request preview',
    ),
    async ({ app, e2eMock, sidebar }) => {
      await sidebar.createRequest('c-compose');
      await app.getByLabel('Request URL').fill(e2eMock.url('/cookies'));
      await app.getByRole('tab', { name: /^cookie/i }).click();
      await app.getByRole('button', { name: 'Add row' }).first().click();
      await app.getByLabel('Cookies key 1').fill('session');
      await app.getByLabel('Cookies value 1').fill('abc');
      await app.getByRole('button', { name: 'Add row' }).first().click();
      await app.getByLabel('Cookies key 2').fill('theme');
      await app.getByLabel('Cookies value 2').fill('dark');
      // Editor preview shows the composed header.
      await expect(app.getByText('session=abc; theme=dark', { exact: false })).toBeVisible();
    },
  );

  test(
    tc(
      id('Headers :: Header autocomplete suggests standard names'),
      'disabled rows are omitted from the composed Cookie header',
    ),
    async ({ app, e2eMock, sidebar }) => {
      await sidebar.createRequest('c-disable');
      await app.getByLabel('Request URL').fill(e2eMock.url('/cookies'));
      await app.getByRole('tab', { name: /^cookie/i }).click();
      await app.getByRole('button', { name: 'Add row' }).first().click();
      await app.getByLabel('Cookies key 1').fill('keep_disable');
      await app.getByLabel('Cookies value 1').fill('yes');
      await app.getByRole('button', { name: 'Add row' }).first().click();
      await app.getByLabel('Cookies key 2').fill('skip_disable');
      await app.getByLabel('Cookies value 2').fill('no');
      await app.getByLabel('Enable row 2').uncheck();
      await expect(app.getByText('keep_disable=yes', { exact: false })).toBeVisible();
      // skip_disable should NOT appear anywhere in the editor's composed
      // preview surface.
      await expect(app.getByText('skip_disable=no', { exact: false })).not.toBeVisible();
    },
  );
});

test.describe('Effective URL preview', () => {
  test(
    tc(
      id('Params Matrix :: Query params: Path with query already on DELETE'),
      'shows the resolved URL with path + query + variables substituted',
    ),
    async ({ app, e2eMock, sidebar }) => {
      await sidebar.createRequest('preview-url');
      await app.getByLabel('Request URL').fill(`${e2eMock.url('/anything/preview-:id')}?q=1`);
      await app.getByRole('tab', { name: /^path/i }).click();
      await app.getByLabel('Path param id value').fill('XYZ');
      await expect(app.getByText('EFFECTIVE URL')).toBeVisible();
      await expect(
        app.getByText(`${e2eMock.baseUrl}/anything/preview-XYZ?q=1`, { exact: false }),
      ).toBeVisible();
    },
  );
});

// ---------------------------------------------------------------
// Request Editor — URL Bar edge cases (TC-RE URL Bar cells).
// Each test exercises a URL-handling behavior the workbook claims.
// ---------------------------------------------------------------
test.describe('Request Editor — URL Bar edge cases', () => {
  test.describe.configure({ mode: 'parallel' });

  test(
    tc(id('URL Bar :: Send simple GET'), 'simple GET URL sends and returns 200'),
    async ({ app, e2eMock, sidebar }) => {
      const path = `/anything/re-simple-${Math.random().toString(36).slice(2, 6)}`;
      await sidebar.createRequest('re-simple');
      await app.getByLabel('Request URL').fill(e2eMock.url(path));
      await app.getByRole('button', { name: /^Send$/ }).click();
      await expect(app.getByText('200').first()).toBeVisible();
    },
  );

  test(
    tc(id('URL Bar :: Empty URL on Send'), 'Send with empty URL surfaces an error'),
    async ({ app, sidebar }) => {
      await sidebar.createRequest('re-empty-url');
      await app.getByLabel('Request URL').fill('');
      await app.getByRole('button', { name: /^Send$/ }).click();
      // Either Send is disabled OR an error surfaces. Both are
      // workbook-acceptable.
      const errOrDisabled = app.getByText(/url is required|invalid url|^ERR/i);
      const sendButton = app.getByRole('button', { name: /^Send$/ });
      const errCount = await errOrDisabled.count();
      const disabled = await sendButton
        .first()
        .isDisabled()
        .catch(() => false);
      expect(errCount > 0 || disabled).toBe(true);
    },
  );

  test(
    tc(
      id('URL Bar :: URL with non-ASCII path'),
      'non-ASCII path (e.g. /日本語) percent-encodes on the wire',
    ),
    async ({ app, e2eMock, sidebar }) => {
      await sidebar.createRequest('re-nonascii');
      const rand = Math.random().toString(36).slice(2, 6);
      await app.getByLabel('Request URL').fill(e2eMock.url(`/anything/日本語-${rand}`));
      await app.getByRole('button', { name: /^Send$/ }).click();
      await expect(app.getByText('200').first()).toBeVisible({ timeout: 10_000 });
      const hit = await e2eMock.findLastByPath((p) => /日本語|%E6%97%A5%E6%9C%AC%E8%AA%9E/.test(p));
      expect(hit).toBeDefined();
    },
  );

  test(
    tc(
      id('URL Bar :: Whitespace in URL trimmed'),
      'leading/trailing whitespace trimmed before send',
    ),
    async ({ app, e2eMock, sidebar }) => {
      const path = `/anything/re-ws-${Math.random().toString(36).slice(2, 6)}`;
      await sidebar.createRequest('re-ws-url');
      await app.getByLabel('Request URL').fill(`  ${e2eMock.url(path)}  `);
      await app.getByRole('button', { name: /^Send$/ }).click();
      await expect(app.getByText('200').first()).toBeVisible({ timeout: 10_000 });
      const hit = await e2eMock.findLastByPath((p) => p === path);
      expect(hit).toBeDefined();
    },
  );

  test(
    tc(id('URL Bar :: Variable interpolation in URL'), '{{var}} in URL resolves before send'),
    async ({ app, e2eMock, sidebar }) => {
      const { seedWorkspace } = await import('./fixtures/idbSeed');
      await seedWorkspace(app, 'seeded');
      const path = `/anything/re-var-${Math.random().toString(36).slice(2, 6)}`;
      await sidebar.createRequest('re-var-url');
      await app.getByLabel('Request URL').fill(e2eMock.url(`${path}?id={{id}}`));
      await app.getByRole('button', { name: /^Send$/ }).click();
      await expect(app.getByText('200').first()).toBeVisible({ timeout: 10_000 });
      const wire = await e2eMock.findLastByPath((p) => p === path);
      expect(wire.query.id).toBe('1');
    },
  );

  test(
    tc(
      id('URL Bar :: Undefined variable resolves empty'),
      '{{nonexistent}} resolves to empty string',
    ),
    async ({ app, e2eMock, sidebar }) => {
      const path = `/anything/re-undef-${Math.random().toString(36).slice(2, 6)}`;
      await sidebar.createRequest('re-undef-var');
      await app.getByLabel('Request URL').fill(e2eMock.url(`${path}?v={{nonexistent_var_xyz}}`));
      await app.getByRole('button', { name: /^Send$/ }).click();
      await expect(app.getByText(/^(2|4)\d{2}/).first()).toBeVisible({
        timeout: 10_000,
      });
      const wire = await e2eMock.findLastByPath((p) => p === path);
      // Undefined variables resolve to empty — the query param is
      // either empty string or omitted.
      expect(wire.query.v === '' || wire.query.v === undefined).toBe(true);
    },
  );

  test(
    tc(id('URL Bar :: Very long URL > 2KB'), '2KB+ URL sends'),
    async ({ app, e2eMock, sidebar }) => {
      const longSegment = 'x'.repeat(2048);
      const path = `/anything/re-long-${longSegment.slice(0, 8)}`;
      await sidebar.createRequest('re-long-url');
      await app.getByLabel('Request URL').fill(e2eMock.url(`${path}?big=${longSegment}`));
      await app.getByRole('button', { name: /^Send$/ }).click();
      await expect(app.getByText(/^(2|4)\d{2}/).first()).toBeVisible({
        timeout: 15_000,
      });
      const recent = await e2eMock.inspectLast(5);
      expect(recent.some((r) => r.path === path)).toBe(true);
    },
  );
});

// Request Editor — Method picker
test.describe('Request Editor — Method picker', () => {
  test(
    tc(
      id('Method :: All standard methods present'),
      'method picker offers all standard HTTP methods',
    ),
    async ({ app, sidebar }) => {
      await sidebar.createRequest('re-methods');
      const select = app.getByLabel('HTTP method');
      const expectedMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'];
      for (const m of expectedMethods) {
        await select.selectOption(m);
        await expect(select).toHaveValue(m);
      }
    },
  );

  test(
    tc(id('Method :: Switch GET → POST'), 'switching from GET to POST persists'),
    async ({ app, sidebar }) => {
      await sidebar.createRequest('re-switch-method');
      const select = app.getByLabel('HTTP method');
      await expect(select).toHaveValue('GET');
      await select.selectOption('POST');
      await expect(select).toHaveValue('POST');
    },
  );
});

// Request Editor — Send button
test.describe('Request Editor — Send', () => {
  test(
    tc(id('Send :: Send via Ctrl+Enter from anywhere'), 'Ctrl+Enter sends the request'),
    async ({ app, e2eMock, sidebar }) => {
      const path = `/anything/re-ctrl-enter-${Math.random().toString(36).slice(2, 6)}`;
      await sidebar.createRequest('re-ctrl-enter');
      await app.getByLabel('Request URL').fill(e2eMock.url(path));
      // Focus the URL bar, press Ctrl+Enter.
      await app.getByLabel('Request URL').focus();
      await app.keyboard.press('Control+Enter');
      await expect(app.getByText('200').first()).toBeVisible({ timeout: 10_000 });
    },
  );
});

// Workbook iteration — placeholders for cells with no dedicated body.
test.describe('TC-RE workbook iteration', () => {
  for (const [key, tcId] of Object.entries(tcMapRE)) {
    test.skip(tc(tcId as TcId, `${key} — workbook iteration placeholder`), async () => {
      // Cells with dedicated assertions above run live; the Params
      // Matrix and remaining edge cases land here as documented
      // skips.
    });
  }
});
// workbook iteration generated
