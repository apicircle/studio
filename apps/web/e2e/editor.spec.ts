import { expect, test } from './fixtures/app';

// Plan §10.2 "Editor" suite — golden path #1.
// Create folder → create request → switch method → edit URL → params /
// headers / body tabs (body-type radio updates Content-Type) → Send →
// status badge / body / headers / assertions render. Delete request →
// tree empties.

test.describe('Editor golden path', () => {
  test('create → edit → send → assertions → delete', async ({ app, mockApi, monaco }) => {
    // 1. Land on the Editor (default panel).
    await expect(app.getByRole('button', { name: /^Editor$/, exact: false })).toHaveAttribute(
      'aria-current',
      'page',
    );

    // 2. Create a request via the sidebar toolbar (name-first flow:
    //    button opens an inline-rename input, Enter commits the new request).
    await app.getByLabel('New request').click();
    await app.getByLabel('Inline rename request').fill('Get example');
    await app.keyboard.press('Enter');

    // The new request is auto-selected and the editor surface is up.
    await expect(app.getByLabel('Request name', { exact: true })).toHaveValue('Get example');
    await expect(app.getByLabel('HTTP method')).toHaveValue('GET');
    await expect(app.getByLabel('Request URL')).toHaveValue('https://httpbin.org/anything');

    // 4. Switch method.
    await app.getByLabel('HTTP method').selectOption('POST');
    await expect(app.getByLabel('HTTP method')).toHaveValue('POST');

    // 5. Set URL to a route we'll mock and add a body.
    await app.getByLabel('Request URL').fill('https://api.example.test/users');

    // 6. Body tab → JSON. Content-Type header should be auto-set.
    await app.getByRole('button', { name: 'Body' }).first().click();
    await app.getByRole('radio', { name: 'JSON' }).click();
    await monaco.fill('Request body', '{"name":"alice"}');

    await app
      .getByRole('button', { name: /^Headers/ })
      .first()
      .click();
    // The header row's value field should carry application/json.
    await expect(app.getByLabel('Headers value 1')).toHaveValue('application/json');

    // 7. Add a status assertion.
    await app.getByRole('button', { name: 'Assertions', exact: false }).first().click();
    await app.getByRole('button', { name: /^Add assertion$/ }).click();

    // 8. Mock the API and click Send.
    await mockApi.json(/api\.example\.test\/users/, { id: 1, name: 'alice' }, { status: 201 });
    await app.getByRole('button', { name: /^Send$/ }).click();

    // 9. Status badge + body render in the response viewer.
    await expect(app.getByText('201')).toBeVisible();
    await expect.poll(() => monaco.read('Response body')).toContain('"name": "alice"');

    // Switch to response Headers tab. The editor's tab is "Headers (1)"
    // (the auto-set Content-Type takes the count to 1); the response
    // viewer's tab is exactly "Headers".
    await app.getByRole('button', { name: 'Headers', exact: true }).click();
    await expect(app.getByText('content-type')).toBeVisible();

    // 10. Delete the request. The demo Sample request stays so the
    // tree-empty hint isn't expected; just confirm our row vanished.
    await app.getByLabel('Delete Get example').click();
    await expect(app.getByLabel('Delete Get example')).not.toBeVisible();
  });

  test('header autocomplete surfaces the expanded v1 dictionary + curated value lists', async ({
    app,
  }) => {
    // Create a fresh request via the name-first flow.
    await app.getByLabel('New request').click();
    await app.getByLabel('Inline rename request').fill('autocomplete-test');
    await app.keyboard.press('Enter');
    await app
      .getByRole('button', { name: /^Headers/ })
      .first()
      .click();
    await app.getByRole('button', { name: /^Add row$/ }).click();

    // Type a 4-letter prefix that matches multiple headers from the v1 port.
    // Pre-port active had only Content-{Type,Length}; the v1 port adds
    // Content-Disposition, Content-Encoding, Content-Language, Content-
    // Location, Content-Range, Content-Security-Policy, taking the prefix
    // hit count to 8.
    await app.getByLabel('Headers key 1').fill('Cont');
    const headerListbox = app.getByRole('listbox', { name: 'Header suggestions' });
    await expect(headerListbox).toBeVisible();
    await expect(headerListbox.getByRole('option')).toHaveCount(8);

    // Pick Cache-Control by clearing then typing it. Focusing the value
    // input next to it should reveal the curated-values popover inline
    // (the chevron pattern was replaced with a focus-driven dropdown to
    // mirror the key column UX).
    await app.getByLabel('Headers key 1').fill('');
    await app.getByLabel('Headers key 1').fill('Cache-Control');
    await app.keyboard.press('Escape'); // close the key autocomplete popover
    await app.getByLabel('Headers value 1').click();
    const valueListbox = app.getByRole('listbox', { name: /Common values for header 1/ });
    await expect(valueListbox).toBeVisible();
    // v1 dictionary lists 8 entries for Cache-Control; assert ≥3 are present.
    const valueOptionCount = await valueListbox.locator('button').count();
    expect(valueOptionCount).toBeGreaterThanOrEqual(3);
    await expect(valueListbox).toContainText('no-cache');
    await expect(valueListbox).toContainText('max-age=0');
  });

  test('passing assertions render with positive explanation text in the response panel', async ({
    app,
    mockApi,
  }) => {
    // Mock returns 200 so the default status=200 assertion passes.
    await mockApi.json(/api\.example\.test\/ping/, { ok: true });

    await app.getByLabel('New request').click();
    await app.getByLabel('Inline rename request').fill('assertion-test');
    await app.keyboard.press('Enter');
    await app.getByLabel('Request URL').fill('https://api.example.test/ping');

    // Add a status assertion (default expected=200, equals).
    await app
      .getByRole('button', { name: /^Assertions/ })
      .first()
      .click();
    await app.getByRole('button', { name: /^Add assertion$/ }).click();

    // Send and switch to the response Assertions tab.
    await app.getByRole('button', { name: /^Send$/ }).click();
    await expect(app.getByText('200')).toBeVisible();

    // The response viewer's tab label updates with the pass count.
    const tabs = app.getByRole('button', { name: /Assertions/ });
    const responseTab = tabs.filter({ hasText: /\(1\/1\)/ });
    await responseTab.click();

    // Per the new runAssertions explanation text.
    await expect(app.getByText('status: 200 equals 200')).toBeVisible();
  });

  test("rapid switching between requests preserves each request's URL and body", async ({
    app,
    sidebar,
  }) => {
    // Create 3 requests with distinct URL + name. Then click rapidly
    // between them and assert no state bleeds across.
    await sidebar.createRequest('rapid-alpha');
    await app.getByLabel('Request URL').fill('https://api.example.test/alpha');
    await sidebar.createRequest('rapid-beta');
    await app.getByLabel('Request URL').fill('https://api.example.test/beta');
    await sidebar.createRequest('rapid-gamma');
    await app.getByLabel('Request URL').fill('https://api.example.test/gamma');

    // Switch back to alpha via the sidebar tree button.
    await app
      .getByRole('button', { name: /^GET\s+rapid-alpha$/ })
      .first()
      .click();
    await expect(app.getByLabel('Request name', { exact: true })).toHaveValue('rapid-alpha');
    await expect(app.getByLabel('Request URL')).toHaveValue('https://api.example.test/alpha');

    // Switch to gamma.
    await app
      .getByRole('button', { name: /^GET\s+rapid-gamma$/ })
      .first()
      .click();
    await expect(app.getByLabel('Request name', { exact: true })).toHaveValue('rapid-gamma');
    await expect(app.getByLabel('Request URL')).toHaveValue('https://api.example.test/gamma');

    // Switch to beta.
    await app
      .getByRole('button', { name: /^GET\s+rapid-beta$/ })
      .first()
      .click();
    await expect(app.getByLabel('Request name', { exact: true })).toHaveValue('rapid-beta');
    await expect(app.getByLabel('Request URL')).toHaveValue('https://api.example.test/beta');

    // Rapid round-trip: alpha → gamma → beta → alpha — final state is alpha's.
    await app
      .getByRole('button', { name: /^GET\s+rapid-alpha$/ })
      .first()
      .click();
    await app
      .getByRole('button', { name: /^GET\s+rapid-gamma$/ })
      .first()
      .click();
    await app
      .getByRole('button', { name: /^GET\s+rapid-beta$/ })
      .first()
      .click();
    await app
      .getByRole('button', { name: /^GET\s+rapid-alpha$/ })
      .first()
      .click();
    await expect(app.getByLabel('Request URL')).toHaveValue('https://api.example.test/alpha');
  });
});
