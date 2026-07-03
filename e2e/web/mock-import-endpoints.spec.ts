// Regression E2E for the spec-import bug: pasting an OpenAPI spec into the
// web "Create mock server" modal must MATERIALIZE the endpoint table (the
// prior behaviour stored `endpoints: []`, so imported specs produced a mock
// with zero endpoints). Drives the real modal UI in a browser and asserts the
// endpoints land in the workspace document, plus the external-`$ref` warning
// surfaces on the web build.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { test, expect } from './fixtures/app';
import { tc } from './fixtures/tcCoverage';
import { tcMapMK } from './fixtures/tcMapMK';
import type { TcId } from './fixtures/tcCoverage';

const here = dirname(fileURLToPath(import.meta.url));
const DEMO_YAML = readFileSync(
  resolve(here, '../../examples/swagger-first/apicircle-demo-openapi.yaml'),
  'utf8',
);

function id(key: string): TcId {
  const v = tcMapMK[key];
  if (!v) throw new Error(`No TC-MK entry for "${key}"`);
  return v;
}

const OPENAPI_YAML = `openapi: 3.0.0
info:
  title: Petstore
  version: 1.0.0
paths:
  /pets:
    get:
      responses:
        '200':
          content:
            application/json:
              example:
                - id: 1
                  name: Fido
  /pets/{id}:
    get:
      responses:
        '200':
          content:
            application/json:
              example:
                id: 1
`;

const OPENAPI_EXTERNAL_REF = JSON.stringify({
  openapi: '3.0.0',
  info: { title: 'Ext', version: '1.0.0' },
  paths: {
    '/pets': {
      get: {
        responses: {
          '200': { content: { 'application/json': { schema: { $ref: './pet.yaml#/Pet' } } } },
        },
      },
    },
  },
});

type StoreBridge = {
  getState: () => {
    synced: { mockServers: Record<string, { name: string; endpoints: unknown[] }> } | null;
  };
};

async function endpointCountFor(
  app: import('@playwright/test').Page,
  name: string,
): Promise<number> {
  return app.evaluate((mockName) => {
    const b = (window as unknown as { __apicircleStore?: StoreBridge }).__apicircleStore;
    const servers = b?.getState().synced?.mockServers ?? {};
    const server = Object.values(servers).find((m) => m.name === mockName);
    return server?.endpoints.length ?? 0;
  }, name);
}

test.describe('Mock spec import materializes endpoints (MK)', () => {
  test(
    tc(id('Spec Import'), 'pasting an OpenAPI YAML spec materializes its endpoints'),
    async ({ app }) => {
      await app.getByRole('button', { name: /^Mocks$/ }).click();
      await app.getByRole('button', { name: /Create your first mock server|New mock/i }).click();

      await app.getByLabel('Mock server name').fill('Petstore import');
      await app.getByRole('button', { name: /Paste spec/i }).click();
      await app.getByLabel('OpenAPI spec format').selectOption('yaml');
      await app.getByLabel('Spec text').fill(OPENAPI_YAML);
      await app.getByRole('button', { name: /Create mock server/i }).click();

      // No warnings for this spec → the modal closes; the two endpoints must
      // be present in the workspace document (the bug produced zero).
      await expect.poll(() => endpointCountFor(app, 'Petstore import'), { timeout: 5000 }).toBe(2);
    },
  );

  test(
    tc(id('Spec Import'), 'external $ref surfaces a web warning but still imports endpoints'),
    async ({ app }) => {
      await app.getByRole('button', { name: /^Mocks$/ }).click();
      await app.getByRole('button', { name: /Create your first mock server|New mock/i }).click();

      await app.getByLabel('Mock server name').fill('External ref import');
      await app.getByRole('button', { name: /Paste spec/i }).click();
      // Default format is JSON — this spec is JSON.
      await app.getByLabel('Spec text').fill(OPENAPI_EXTERNAL_REF);
      await app.getByRole('button', { name: /Create mock server/i }).click();

      // Warnings present → the modal stays open and shows the advisory.
      await expect(app.getByText(/External \$ref not resolved in the web app/i)).toBeVisible({
        timeout: 5000,
      });
      expect(await endpointCountFor(app, 'External ref import')).toBe(1);

      await app.getByRole('button', { name: /^Done$/ }).click();
    },
  );

  test(
    tc(id('Spec Import'), 'imports the demo swagger-first YAML (20 endpoints) end-to-end'),
    async ({ app }, testInfo) => {
      await app.getByRole('button', { name: /^Mocks$/ }).click();
      await app.getByRole('button', { name: /Create your first mock server|New mock/i }).click();

      await app.getByLabel('Mock server name').fill('Demo Workspace API');
      await app.getByRole('button', { name: /Paste spec/i }).click();
      await app.getByLabel('OpenAPI spec format').selectOption('yaml');
      await app.getByLabel('Spec text').fill(DEMO_YAML);
      await app.getByRole('button', { name: /Create mock server/i }).click();

      // Every $ref in the demo is in-document → no warnings → modal closes and
      // all 20 operations are materialized as endpoints.
      await expect
        .poll(() => endpointCountFor(app, 'Demo Workspace API'), { timeout: 8000 })
        .toBe(20);

      // Capture visual proof of the imported mock + its endpoint list.
      const proofPath = process.env.DEMO_IMPORT_SHOT;
      const shot = await app.screenshot({ path: proofPath || undefined });
      await testInfo.attach('demo-import-web', { body: shot, contentType: 'image/png' });
    },
  );
});
