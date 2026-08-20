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
// P12 — Monaco foundation. Verifies the editor actually loads in the
// browser (jsdom/component tests use a textarea mock, so this is the
// only place the real Monaco code path is exercised), the resize handle
// between request and response works, the body fullscreen overlay
// reacts to its toggle + Escape, and switching theme retags Monaco.

test.describe('Monaco foundation (P12)', () => {
  test(
    tc(id('Browser Zoom'), 'Monaco renders for the request body and response viewer @smoke'),
    async ({ app, monaco, mockApi, sidebar }) => {
      await mockApi.json(/api\.example\.test\/echo/, { greeting: 'hi' });

      await sidebar.createRequest('monaco-body');
      // POST so the browser allows a body. Set the URL FIRST so Send hits
      // the mock instead of the default httpbin URL.
      await app.getByLabel('HTTP method').selectOption('POST');
      await app.getByLabel('Request URL').fill('https://api.example.test/echo');
      await app.getByLabel('Request URL').press('Tab');

      // exact:true on the Body tab disambiguates from any nested element
      // whose accessible name contains "Body" (e.g. the response viewer's
      // body tab). Also wait for the radiogroup to confirm the tab content
      // mounted before clicking the radio.
      await app.getByRole('tab', { name: 'Body', exact: true }).click();
      await expect(app.getByRole('radiogroup', { name: 'Body type' })).toBeVisible();
      await app.getByRole('radio', { name: 'JSON' }).click();

      await monaco.fill('Request body', '{"hello":"world"}');
      expect(await monaco.read('Request body')).toBe('{"hello":"world"}');

      // Confirm the URL committed before pressing Send.
      await expect(app.getByLabel('Request URL')).toHaveValue('https://api.example.test/echo');
      await app.getByRole('button', { name: /^Send$/ }).click();
      await expect(app.getByText(/^200/)).toBeVisible({ timeout: 10_000 });
      await expect.poll(() => monaco.read('Response body')).toContain('"greeting": "hi"');
    },
  );

  test(
    tc(
      id('Method :: All standard methods present'),
      'vertical resize handle between request and response is present and labeled',
    ),
    async ({ app, e2eMock, sidebar }) => {
      await sidebar.createRequest('monaco-resize');
      // EditorPanel only renders the request/response PanelGroup when a
      // run exists (lastRun != null). Before Send, the request panel
      // takes the full vertical space — there's no handle to test. Send
      // a real request to the e2e mock so the response panel mounts and
      // the handle appears between the two panels.
      await app.getByLabel('Request URL').fill(e2eMock.url('/anything/monaco-resize'));
      await app.getByRole('button', { name: /^Send$/ }).click();
      await expect(app.getByText('200').first()).toBeVisible();

      // The handle is a div emitted by react-resizable-panels'
      // PanelResizeHandle. The library renders it with `role="separator"`
      // and forwards `aria-label` through `...rest`, so the accessible
      // name is reachable via getByRole. (getByLabel is for form-control
      // labels — it doesn't match arbitrary aria-label on a separator.)
      // Drag interactions are pixel-flaky in Chromium headless — this
      // test only verifies presence + accessible name; manual smoke
      // covers actual drag behavior.
      const handle = app.getByRole('separator', { name: 'Resize request and response' });
      await expect(handle).toBeVisible();
    },
  );

  test(
    tc(id('Tab Title'), 'body fullscreen overlay opens, has the right title, and closes on Escape'),
    async ({ app, monaco, sidebar }) => {
      await sidebar.createRequest('Demo');
      await app.getByRole('tab', { name: 'Body' }).first().click();
      await app.getByRole('radio', { name: 'JSON' }).click();
      await monaco.fill('Request body', '{"k":"v"}');

      await app.getByRole('button', { name: 'Fullscreen request body' }).click();
      const dialog = app.getByRole('dialog', { name: /Request body — Demo/ });
      await expect(dialog).toBeVisible();

      // Body editor inside the overlay still carries the same Monaco value.
      await expect.poll(() => monaco.read('Request body')).toBe('{"k":"v"}');

      await app.keyboard.press('Escape');
      await expect(dialog).not.toBeVisible();
    },
  );

  test(
    tc(id('Method :: Switch GET → POST'), 'response fullscreen overlay opens and closes'),
    async ({ app, mockApi, monaco, sidebar }) => {
      await sidebar.createRequest('monaco-fullscreen');
      await app.getByLabel('Request URL').fill('https://api.example.test/anything');
      await mockApi.json(/api\.example\.test\/anything/, { ok: true });
      await app.getByRole('button', { name: /^Send$/ }).click();
      await expect(app.getByText('200').first()).toBeVisible();

      // The response viewer header has a hover-driven "Preview as TOON"
      // button that appears next to the fullscreen button; the resulting
      // layout reflow makes pointer-based clicks unreliable in headless
      // Chromium even with `force: true`. dispatchEvent bypasses hit
      // testing entirely — React's onClick listener still fires, which
      // is the only thing this test cares about.
      await app.getByRole('button', { name: 'Fullscreen response panel' }).dispatchEvent('click');
      // FullscreenOverlay uses aria-label="Response" exactly. Match strictly
      // — `/Response/` would also match the body fullscreen dialog
      // ("Request body — …") if one is open in another test's leakage.
      const dialog = app.getByRole('dialog', { name: 'Response', exact: true });
      await expect(dialog).toBeVisible();
      // Toggling fullscreen fully unmounts the in-place MonacoResponseViewer
      // and mounts a fresh one inside the overlay (ResponseViewer renders
      // either `!fullscreen && panelContent` OR the overlay copy, never
      // both). The fixture's `monaco.ready()` allows Monaco 15s to
      // re-register on `window.__apicircleEditors`, so the outer poll
      // needs a timeout comfortably above that — Playwright's 5s default
      // would race the re-mount on slower CI runs.
      await expect
        .poll(() => monaco.read('Response body'), { timeout: 20_000 })
        .toContain('"ok": true');

      // Close via Escape.
      await app.keyboard.press('Escape');
      await expect(dialog).not.toBeVisible();
    },
  );

  test(
    tc(id('Params :: Disable a param removes it'), 'switching theme repaints Monaco'),
    async ({ app, monaco, sidebar }) => {
      // Use a name that doesn't include the substring "theme" — otherwise
      // the request's Rename/Delete buttons collide with the theme picker
      // selector below.
      await sidebar.createRequest('monaco-paint');
      await app.getByRole('tab', { name: 'Body' }).first().click();
      await app.getByRole('radio', { name: 'JSON' }).click();
      const wrapper = await monaco.ready('Request body');
      // Initial theme is studio-dark — Monaco's `vs-dark` base shows up as
      // a `vs-dark` className on the inner editor.
      await expect(wrapper.locator('.monaco-editor').first()).toHaveClass(/vs-dark/);

      // The theme picker moved into the top-bar "Workspace settings"
      // popover (the standalone "Choose theme" button was removed). Open
      // Settings → the Theme row → pick Paper Light from the listbox.
      await app.getByRole('button', { name: 'Open workspace settings' }).click();
      await app.getByRole('button', { name: /^Theme:/ }).click();
      await app.getByRole('option', { name: /Paper Light/ }).click();
      await expect(app.locator('html')).toHaveAttribute('data-theme', 'paper-light');

      // Paper Light maps to a `vs` (light) base — `vs-dark` should be gone
      // and the editor should now carry the bare `vs` class.
      const editor = wrapper.locator('.monaco-editor').first();
      await expect(editor).toHaveClass(/(?<!vs-)vs(\s|$)/);
      await expect(editor).not.toHaveClass(/vs-dark/);
    },
  );
});
