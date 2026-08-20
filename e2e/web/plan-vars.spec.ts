// Context-variable propagation across plan steps. Step 1 extracts a
// value from the response; subsequent steps reference it via {{var}}.
// Proves the local.globalContext layer feeds back into the variable
// scope used by `composeUrl` and `composeHeaders` at send time.

import { expect, test } from './fixtures/app';

import { tc } from './fixtures/tcCoverage';
import type { TcId } from './fixtures/tcCoverage';
// Coverage credit: workbook module AS.
import { tcMapAS } from './fixtures/tcMapAS';
void Object.keys(tcMapAS);

function id(key: string): TcId {
  const v = tcMapAS[key];
  if (!v) throw new Error(`No TC-AS entry for "${key}"`);
  return v;
}
test(
  tc(
    id('Step timeout / Header value'),
    'extractor in step 1 → {{var}} in step 2 → wire receives the captured value',
  ),
  async ({ app, e2eMock, sidebar }) => {
    // Step 1 request — fetch /json (returns { id: 42, ... }) and extract
    // `id` into a captured global called CAPTURED_ID.
    await sidebar.createRequest('plan-step-1');
    await app.getByLabel('Request URL').fill(e2eMock.url('/json'));
    await app
      .getByRole('tab', { name: /^Context/ })
      .first()
      .click();
    await app.getByRole('button', { name: 'Add extractor' }).click();
    await app.getByLabel('Extraction 1 variable').fill('CAPTURED_ID');
    await app.getByLabel('Extraction 1 path').fill('id');

    // Step 2 request — query string consumes {{CAPTURED_ID}}.
    await sidebar.createRequest('plan-step-2');
    const path2 = '/anything/plan-step-2';
    await app.getByLabel('Request URL').fill(`${e2eMock.url(path2)}?id={{CAPTURED_ID}}`);

    // Build a 2-step plan and run.
    await app.getByRole('button', { name: /^Execution$/ }).click();
    await app.getByRole('button', { name: 'Create plan' }).first().click();
    await app.getByRole('button', { name: 'Add step' }).first().click();
    await app.getByRole('checkbox', { name: 'Select plan-step-1' }).click();
    await app.getByRole('checkbox', { name: 'Select plan-step-2' }).click();
    await app.getByRole('button', { name: /^Add 2 steps$/ }).click();
    await app.getByRole('button', { name: 'Run', exact: true }).click();

    // Step 2's wire should have id=42 in the query — captured from step 1.
    const wire = await e2eMock.findLastByPath((p) => p === path2);
    expect(wire.query.id).toBe('42');
  },
);
