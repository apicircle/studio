import { expect, test } from './fixtures/app';

// P12 — Monaco foundation. Verifies the editor actually loads in the
// browser (jsdom/component tests use a textarea mock, so this is the
// only place the real Monaco code path is exercised), the resize handle
// between request and response works, the body fullscreen overlay
// reacts to its toggle + Escape, and switching theme retags Monaco.

test.describe('Monaco foundation (P12)', () => {
  test('Monaco renders for the request body and response viewer', async ({
    app,
    monaco,
    mockApi,
  }) => {
    await mockApi.json(/api\.example\.test\/echo/, { greeting: 'hi' });

    await app.getByLabel('New request').click();
    // POST so the browser allows a body. Set the URL FIRST so Send hits
    // the mock instead of the default httpbin URL.
    await app.getByLabel('HTTP method').selectOption('POST');
    await app.getByLabel('Request URL').fill('https://api.example.test/echo');
    await app.getByLabel('Request URL').press('Tab');

    await app.getByRole('button', { name: 'Body' }).first().click();
    await app.getByRole('radio', { name: 'JSON' }).click();

    await monaco.fill('Request body', '{"hello":"world"}');
    expect(await monaco.read('Request body')).toBe('{"hello":"world"}');

    // Confirm the URL committed before pressing Send.
    await expect(app.getByLabel('Request URL')).toHaveValue('https://api.example.test/echo');
    await app.getByRole('button', { name: /^Send$/ }).click();
    await expect(app.getByText(/^200/)).toBeVisible({ timeout: 10_000 });
    await expect.poll(() => monaco.read('Response body')).toContain('"greeting": "hi"');
  });

  test('vertical resize handle between request and response works', async ({ app }) => {
    await app.getByLabel('New request').click();

    const handle = app.getByRole('separator', { name: /Resize request and response/i });
    await expect(handle).toBeVisible();

    // Drag the handle up by ~100px and confirm it moved (we don't pin a
    // pixel position, just that the handle itself shifted).
    const before = await handle.boundingBox();
    expect(before).not.toBeNull();
    await handle.dragTo(handle, {
      targetPosition: { x: 0, y: -100 },
      force: true,
    });
    const after = await handle.boundingBox();
    expect(after).not.toBeNull();
    expect(after!.y).toBeLessThan(before!.y);
  });

  test('body fullscreen overlay opens, has the right title, and closes on Escape', async ({
    app,
    monaco,
  }) => {
    await app.getByLabel('New request').click();
    await app.getByLabel('Request name').fill('Demo');
    await app.getByRole('button', { name: 'Body' }).first().click();
    await app.getByRole('radio', { name: 'JSON' }).click();
    await monaco.fill('Request body', '{"k":"v"}');

    await app.getByRole('button', { name: 'Fullscreen request body' }).click();
    const dialog = app.getByRole('dialog', { name: /Request body — Demo/ });
    await expect(dialog).toBeVisible();

    // Body editor inside the overlay still carries the same Monaco value.
    await expect.poll(() => monaco.read('Request body')).toBe('{"k":"v"}');

    await app.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
  });

  test('response fullscreen overlay opens and closes', async ({ app, mockApi, monaco }) => {
    await app.getByLabel('New request').click();
    await app.getByLabel('Request URL').fill('https://api.example.test/anything');
    await mockApi.json(/api\.example\.test\/anything/, { ok: true });
    await app.getByRole('button', { name: /^Send$/ }).click();
    await expect(app.getByText('200')).toBeVisible();

    await app.getByRole('button', { name: 'Fullscreen response body' }).click();
    const dialog = app.getByRole('dialog', { name: 'Response body' });
    await expect(dialog).toBeVisible();
    await expect.poll(() => monaco.read('Response body')).toContain('"ok": true');

    await app.getByRole('button', { name: 'Exit fullscreen' }).click();
    await expect(dialog).not.toBeVisible();
  });

  test('switching theme repaints Monaco', async ({ app, monaco }) => {
    await app.getByLabel('New request').click();
    await app.getByRole('button', { name: 'Body' }).first().click();
    await app.getByRole('radio', { name: 'JSON' }).click();
    const wrapper = await monaco.ready('Request body');
    // Initial theme is studio-dark — Monaco's `vs-dark` base shows up as
    // a `vs-dark` className on the inner editor.
    await expect(wrapper.locator('.monaco-editor').first()).toHaveClass(/vs-dark/);

    await app.getByLabel('Theme').click();
    await app.getByRole('option', { name: /Paper Light/ }).click();
    await expect(app.locator('html')).toHaveAttribute('data-theme', 'paper-light');

    // Paper Light maps to a `vs` (light) base — `vs-dark` should be gone
    // and the editor should now carry the bare `vs` class.
    const editor = wrapper.locator('.monaco-editor').first();
    await expect(editor).toHaveClass(/(?<!vs-)vs(\s|$)/);
    await expect(editor).not.toHaveClass(/vs-dark/);
  });
});
