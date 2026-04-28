import { expect, test } from './fixtures/app';

// P19 — GraphQL body type. Verifies the two-pane editor (query + variables),
// the JSON envelope sent on submit, and the per-request schema picker.
// SDL parsing + completion provider correctness is unit-tested in core.

test.describe('GraphQL request body (P19)', () => {
  test('selecting GraphQL splits the body into query + variables panes', async ({
    app,
    monaco,
  }) => {
    await app.getByLabel('New request').click();
    await app.getByRole('button', { name: 'Body' }).first().click();
    await app.getByRole('radio', { name: 'GraphQL' }).click();

    // Two Monaco editors mount: the query (aria-label="GraphQL query") and
    // the variables JSON pane.
    await monaco.ready('GraphQL query');
    await monaco.ready('GraphQL variables');

    await monaco.fill('GraphQL query', 'query { hello }');
    await monaco.fill('GraphQL variables', '{"id":"42"}');

    expect(await monaco.read('GraphQL query')).toBe('query { hello }');
    expect(await monaco.read('GraphQL variables')).toBe('{"id":"42"}');
  });

  test('Send wraps query + variables into the standard JSON envelope', async ({ app, monaco }) => {
    let capturedBody: string | null = null;
    await app.route(/api\.example\.test\/graphql/, async (route) => {
      capturedBody = route.request().postData();
      await route.fulfill({
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ data: { hello: 'world' } }),
      });
    });

    await app.getByLabel('New request').click();
    await app.getByLabel('HTTP method').selectOption('POST');
    await app.getByLabel('Request URL').fill('https://api.example.test/graphql');
    await app.getByRole('button', { name: 'Body' }).first().click();
    await app.getByRole('radio', { name: 'GraphQL' }).click();
    await monaco.fill('GraphQL query', 'query Q($id: ID!) { user(id: $id) { name } }');
    await monaco.fill('GraphQL variables', '{"id":"42"}');

    await app.getByRole('button', { name: /^Send$/ }).click();
    await expect(app.getByText('200')).toBeVisible();

    expect(capturedBody).not.toBeNull();
    expect(JSON.parse(capturedBody as unknown as string)).toEqual({
      query: 'query Q($id: ID!) { user(id: $id) { name } }',
      variables: { id: '42' },
    });
  });

  test('GraphQL schema picker maps a workspace SDL definition to the request', async ({
    app,
    monaco,
  }) => {
    // Add a workspace SDL definition.
    await app.getByRole('button', { name: /Open Global Assets library/ }).click();
    await app.getByRole('button', { name: /^GraphQL/ }).click();
    await app.getByRole('button', { name: 'Add GraphQL schema' }).click();
    await monaco.ready('GraphQL schema body');
    await app.getByLabel('GraphQL schema name').fill('Pets');
    await monaco.fill(
      'GraphQL schema body',
      `type Query {
        pet(id: ID!): Pet
      }
      type Pet {
        id: ID!
        name: String
      }`,
    );
    await app.keyboard.press('Escape');

    // Map it to a new request.
    await app.getByLabel('New request').click();
    await app.getByRole('button', { name: 'Body' }).first().click();
    await app.getByRole('radio', { name: 'GraphQL' }).click();
    await app.getByLabel('GraphQL schema').selectOption({ label: 'Pets' });
    await expect(app.getByLabel('GraphQL schema')).not.toHaveValue('');
  });
});
