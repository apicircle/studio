// Query / Path / Cookie params + Effective URL preview.
//
// Each test uses a unique URL path so `findLastByPath` can scope the
// wire assertion to that test's request. This keeps parallel workers
// safe — they all share the same mock server but never trip over each
// other's captures.

import { expect, test } from './fixtures/app';

test.describe('Query params', () => {
  test('CRUD: add → edit → delete → disable', async ({ app, e2eMock, sidebar }) => {
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
  });

  test('encoding: percent-encodes spaces and reserved characters', async ({
    app,
    e2eMock,
    sidebar,
  }) => {
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
  });

  test('variable substitution: `{{NAME}}` resolves at send time', async ({
    app,
    e2eMock,
    sidebar,
  }) => {
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
  });

  test('collisions: two rows with the same key — last wins on the wire', async ({
    app,
    e2eMock,
    sidebar,
  }) => {
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
  });
});

test.describe('Path params', () => {
  test(':name syntax — substitutes values at send time', async ({ app, e2eMock, sidebar }) => {
    await sidebar.createRequest('p-colon');
    await app.getByLabel('Request URL').fill(e2eMock.url('/anything/p-colon-:userId'));
    await app.getByRole('tab', { name: /^path/i }).click();
    await app.getByLabel('Path param userId value').fill('u-42');
    await app.getByRole('button', { name: /^Send$/ }).click();
    await expect(app.getByText('200').first()).toBeVisible();
    const wire = await e2eMock.findLastByPath((p) => p === '/anything/p-colon-u-42');
    expect(wire.path).toBe('/anything/p-colon-u-42');
  });

  test('{name} syntax — substitutes values at send time', async ({ app, e2eMock, sidebar }) => {
    await sidebar.createRequest('p-curly');
    await app.getByLabel('Request URL').fill(e2eMock.url('/anything/p-curly-{userId}'));
    await app.getByRole('tab', { name: /^path/i }).click();
    await app.getByLabel('Path param userId value').fill('u-99');
    await app.getByRole('button', { name: /^Send$/ }).click();
    await expect(app.getByText('200').first()).toBeVisible();
    const wire = await e2eMock.findLastByPath((p) => p === '/anything/p-curly-u-99');
    expect(wire.path).toBe('/anything/p-curly-u-99');
  });

  test('encoding: percent-encodes `/` in path values', async ({ app, e2eMock, sidebar }) => {
    await sidebar.createRequest('p-encoding');
    await app.getByLabel('Request URL').fill(e2eMock.url('/anything/p-encoding-{name}'));
    await app.getByRole('tab', { name: /^path/i }).click();
    await app.getByLabel('Path param name value').fill('a/b c');
    await app.getByRole('button', { name: /^Send$/ }).click();
    await expect(app.getByText('200').first()).toBeVisible();
    const wire = await e2eMock.findLastByPath((p) => p.startsWith('/anything/p-encoding-'));
    expect(wire.path).toBe('/anything/p-encoding-a%2Fb%20c');
  });

  test('missing param falls back to empty string (no runtime error)', async ({
    app,
    e2eMock,
    sidebar,
  }) => {
    await sidebar.createRequest('p-missing');
    await app.getByLabel('Request URL').fill(e2eMock.url('/anything/p-missing-{userId}-end'));
    await app.getByRole('button', { name: /^Send$/ }).click();
    await expect(app.getByText('200').first()).toBeVisible();
    const wire = await e2eMock.findLastByPath((p) => p === '/anything/p-missing--end');
    expect(wire.path).toBe('/anything/p-missing--end');
  });
});

test.describe('Cookie params', () => {
  // Web limitation: the Fetch spec marks `Cookie` as a forbidden header
  // name; browsers strip it from cross-origin requests. Cookie-row
  // composition is verified instead via the request preview ("Cookie:
  // session=abc; theme=dark" shown above the Send button) and via the
  // unit test in packages/core/src/request/buildRequest.test.ts that
  // exercises composeCookieHeader directly.
  test('composition: rows compose into one Cookie header in the request preview', async ({
    app,
    e2eMock,
    sidebar,
  }) => {
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
  });

  test('disabled rows are omitted from the composed Cookie header', async ({
    app,
    e2eMock,
    sidebar,
  }) => {
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
  });
});

test.describe('Effective URL preview', () => {
  test('shows the resolved URL with path + query + variables substituted', async ({
    app,
    e2eMock,
    sidebar,
  }) => {
    await sidebar.createRequest('preview-url');
    await app.getByLabel('Request URL').fill(`${e2eMock.url('/anything/preview-:id')}?q=1`);
    await app.getByRole('tab', { name: /^path/i }).click();
    await app.getByLabel('Path param id value').fill('XYZ');
    await expect(app.getByText('EFFECTIVE URL')).toBeVisible();
    await expect(
      app.getByText(`${e2eMock.baseUrl}/anything/preview-XYZ?q=1`, { exact: false }),
    ).toBeVisible();
  });
});
