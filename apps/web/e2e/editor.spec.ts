import { expect, test } from './fixtures/app';

// Plan §10.2 "Editor" suite — golden path #1.
// Create folder → create request → switch method → edit URL → params /
// headers / body tabs (body-type radio updates Content-Type) → Send →
// status badge / body / headers / assertions render. Delete request →
// tree empties.

test.describe('Editor golden path', () => {
  test('create → edit → send → assertions → delete', async ({ app, mockApi }) => {
    // 1. Land on the Editor (default panel).
    await expect(app.getByRole('button', { name: /^Editor$/, exact: false })).toHaveAttribute(
      'aria-current',
      'page',
    );

    // 2. Create a request via the sidebar toolbar.
    await app.getByLabel('New request').click();

    // The new request is auto-selected and the editor surface is up.
    await expect(app.getByLabel('Request name')).toHaveValue('New request');
    await expect(app.getByLabel('HTTP method')).toHaveValue('GET');
    await expect(app.getByLabel('Request URL')).toHaveValue('https://httpbin.org/anything');

    // 3. Rename the request.
    await app.getByLabel('Request name').fill('Get example');
    await expect(app.getByLabel('Request name')).toHaveValue('Get example');

    // 4. Switch method.
    await app.getByLabel('HTTP method').selectOption('POST');
    await expect(app.getByLabel('HTTP method')).toHaveValue('POST');

    // 5. Set URL to a route we'll mock and add a body.
    await app.getByLabel('Request URL').fill('https://api.example.test/users');

    // 6. Body tab → JSON. Content-Type header should be auto-set.
    await app.getByRole('button', { name: 'Body' }).first().click();
    await app.getByRole('radio', { name: 'JSON' }).click();
    await app.getByLabel('Request body').fill('{"name":"alice"}');

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
    await expect(app.getByText(/"name": "alice"/)).toBeVisible();

    // Switch to response Headers tab. The editor's tab is "Headers (1)"
    // (the auto-set Content-Type takes the count to 1); the response
    // viewer's tab is exactly "Headers".
    await app.getByRole('button', { name: 'Headers', exact: true }).click();
    await expect(app.getByText('content-type')).toBeVisible();

    // 10. Delete the request — tree empties to the empty-state hint.
    await app.getByLabel('Delete Get example').click();
    await expect(app.getByText(/No requests yet/i)).toBeVisible();
  });
});
