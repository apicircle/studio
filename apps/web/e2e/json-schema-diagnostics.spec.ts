// JSON Schema diagnostics — when the user picks a schema for the JSON
// body editor, Monaco's JSON language service surfaces validation
// errors as gutter markers. Invalid JSON → markers appear; valid JSON
// → markers clear.

import { expect, test } from './fixtures/app';

interface MonacoMarker {
  severity: number;
  message: string;
  startLineNumber: number;
}

async function readMarkers(
  app: import('@playwright/test').Page,
  ariaLabel: string,
): Promise<MonacoMarker[]> {
  return app.evaluate((label) => {
    const w = window as unknown as {
      __apicircleEditors?: Map<
        string,
        { getModel: () => { uri: { toString: () => string } } | null }
      >;
      monaco?: {
        editor: {
          getModelMarkers: (filter: { resource: unknown }) => MonacoMarker[];
        };
      };
    };
    const editor = w.__apicircleEditors?.get(label);
    const model = editor?.getModel();
    if (!model || !w.monaco) return [];
    return w.monaco.editor.getModelMarkers({ resource: model.uri });
  }, ariaLabel);
}

test('invalid JSON against the picked schema → Monaco surfaces diagnostics', async ({
  app,
  monaco,
}) => {
  // 1. Seed a JSON Schema via Global Assets.
  await app.getByRole('button', { name: /Open Global Assets library/ }).click();
  await app.getByRole('button', { name: 'Add JSON Schema' }).click();
  await monaco.ready('Schema body');
  await app.getByLabel('Schema name').fill('UserSchemaDiag');
  await monaco.fill(
    'Schema body',
    JSON.stringify({
      type: 'object',
      required: ['id'],
      properties: { id: { type: 'integer' } },
      additionalProperties: false,
    }),
  );
  await app.keyboard.press('Escape');

  // 2. Create a request, switch body to JSON, pick the schema.
  await app.getByLabel('New request', { exact: true }).first().click();
  await app.getByLabel('Inline rename request').fill('schema-diag');
  await app.keyboard.press('Enter');
  await app.getByRole('button', { name: 'Body', exact: true }).click();
  await expect(app.getByRole('radiogroup', { name: 'Body type' })).toBeVisible();
  await app.getByRole('radio', { name: 'JSON' }).click();
  await app.getByLabel('JSON schema').selectOption({ label: 'UserSchemaDiag' });

  // 3. Type invalid JSON — `id` is a string, schema requires integer.
  await monaco.fill('Request body', '{"id":"not-a-number"}');
  await expect
    .poll(() => readMarkers(app, 'Request body').then((m) => m.length), { timeout: 10_000 })
    .toBeGreaterThan(0);

  // 4. Replace with valid JSON — markers clear.
  await monaco.fill('Request body', '{"id":42}');
  await expect
    .poll(() => readMarkers(app, 'Request body').then((m) => m.length), { timeout: 10_000 })
    .toBe(0);
});
