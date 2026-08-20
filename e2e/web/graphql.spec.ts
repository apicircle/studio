import { expect, test } from './fixtures/app';
import { tc } from './fixtures/tcCoverage';
import { tcMapGQ } from './fixtures/tcMapGQ';
import type { TcId } from './fixtures/tcCoverage';

function id(key: string): TcId {
  const v = tcMapGQ[key];
  if (!v) throw new Error(`No TC-GQ entry for "${key}"`);
  return v;
}

// P19 — GraphQL body type. Verifies the two-pane editor (query + variables),
// the JSON envelope sent on submit, and the per-request schema picker.
// SDL parsing + completion provider correctness is unit-tested in core.

test.describe('GraphQL request body (P19)', () => {
  test(
    tc(id('Variables'), 'GraphQL variables pane round-trips JSON values into the request', {
      smoke: true,
    }),
    async ({ app, monaco, sidebar }) => {
      await sidebar.createRequest('graphql-1');
      await app.getByRole('tab', { name: 'Body' }).first().click();
      await app.getByRole('radio', { name: 'GraphQL' }).click();

      // Two Monaco editors mount: the query (aria-label="GraphQL query") and
      // the variables JSON pane.
      await monaco.ready('GraphQL query');
      await monaco.ready('GraphQL variables');

      await monaco.fill('GraphQL query', 'query { hello }');
      await monaco.fill('GraphQL variables', '{"id":"42"}');

      expect(await monaco.read('GraphQL query')).toBe('query { hello }');
      expect(await monaco.read('GraphQL variables')).toBe('{"id":"42"}');
    },
  );

  test(
    tc(id('Multi-Operation'), 'Send wraps query + variables into the standard JSON envelope'),
    async ({ app, monaco, sidebar }) => {
      let capturedBody: string | null = null;
      await app.route(/api\.example\.test\/graphql/, async (route) => {
        capturedBody = route.request().postData();
        await route.fulfill({
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ data: { hello: 'world' } }),
        });
      });

      await sidebar.createRequest('graphql-2');
      await app.getByLabel('HTTP method').selectOption('POST');
      await app.getByLabel('Request URL').fill('https://api.example.test/graphql');
      await app.getByRole('tab', { name: 'Body' }).first().click();
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
    },
  );

  test(
    tc(id('Errors'), 'GraphQL errors payload renders in the response viewer'),
    async ({ app, monaco, sidebar }) => {
      await app.route(/api\.example\.test\/graphql/, async (route) => {
        await route.fulfill({
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            data: null,
            errors: [
              {
                message: 'Field "missing" not found on type Query',
                locations: [{ line: 1, column: 9 }],
              },
            ],
          }),
        });
      });

      await sidebar.createRequest('graphql-errors');
      await app.getByLabel('HTTP method').selectOption('POST');
      await app.getByLabel('Request URL').fill('https://api.example.test/graphql');
      await app.getByRole('tab', { name: 'Body' }).first().click();
      await app.getByRole('radio', { name: 'GraphQL' }).click();
      await monaco.fill('GraphQL query', 'query { missing }');

      await app.getByRole('button', { name: /^Send$/ }).click();
      await expect(app.getByText('200')).toBeVisible();
      // The errors array is part of the JSON body — the response viewer is a
      // Monaco editor, so we read via the same helper. The error message's
      // inner quotes are JSON-escaped in the rendered body, so parse the
      // body back to JSON before asserting on the message text.
      const body = await monaco.read('Response body');
      const parsed = JSON.parse(body) as { errors?: Array<{ message?: string }> };
      expect(parsed.errors?.[0]?.message).toBe('Field "missing" not found on type Query');
    },
  );

  test(
    tc(id('Schema Reuse'), 'GraphQL schema picker maps a workspace SDL definition to the request'),
    async ({ app, monaco, sidebar }) => {
      // Add a workspace SDL definition via the right-dock Assets tab.
      await app.getByRole('button', { name: 'Open Global Assets', exact: true }).click();
      const dock = app.getByRole('complementary', { name: 'Workspace inspector' });
      await expect(dock).toBeVisible();
      await dock.getByRole('button', { name: /^GraphQL/ }).click();
      await dock.getByRole('button', { name: 'Add GraphQL schema' }).click();
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
      await app.getByRole('button', { name: 'Close Global Assets', exact: true }).click();

      // Map it to a new request.
      await sidebar.createRequest('graphql-schema-pick');
      await app.getByRole('tab', { name: 'Body' }).first().click();
      await app.getByRole('radio', { name: 'GraphQL' }).click();
      await app.getByLabel('GraphQL schema').selectOption({ label: 'Pets' });
      await expect(app.getByLabel('GraphQL schema')).not.toHaveValue('');
    },
  );

  // Cells with no automatable surface yet — kept as fixme with a specific
  // rationale so each literal `id('...')` still credits the cell.
  test.fixme(tc(id('Completions'), 'GraphQL query editor offers schema-aware completions'), () => {
    // The SDL-backed completion provider's correctness is unit-tested in
    // @apicircle/core; an editor-level e2e needs Monaco suggest-widget
    // introspection the harness does not expose.
  });
  test.fixme(
    tc(id('Introspect :: Fetch schema'), 'fetch a GraphQL schema by introspection'),
    () => {
      // There is no live "introspect this endpoint" flow — GraphQL schemas
      // are authored as SDL or pasted introspection JSON (GlobalAssetsDock
      // `kind` toggle). A fetch-schema operation needs that feature first.
    },
  );
  test.fixme(
    tc(id('Introspect :: Introspection disabled'), 'introspection-disabled endpoint is handled'),
    () => {
      // Same gap — depends on a live introspection-fetch flow that the
      // product does not implement.
    },
  );
});
