// Cycle 9 — Plan-scoped env priority. The workspace has one global
// priority order in the Environments sidebar; each plan can override it
// via `plan.envPriorityOrder`. When the override is non-empty, runPlan
// passes it to resolveRequest as `overrides.envPriorityOrder`, and the
// resolver consults the plan's order instead of the workspace's.
//
// These tests exercise both halves: a plan WITHOUT an override inherits
// the workspace order, and a plan WITH an override flips the resolution
// without touching workspace state.

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
test.describe('Plan-scoped env priority — C9', () => {
  test(
    tc(
      id('Plan Run :: Run sequentially'),
      'plan-level priority order overrides workspace order on run',
    ),
    async ({ app, e2eMock, sidebar }) => {
      // 1. Two envs sharing a key. Workspace priority adds them in
      //    creation order [dev, prod] — dev wins by default.
      await app.getByRole('button', { name: /^Environments$/ }).click();
      await createEnv(app, 'dev');
      await addVar(app, 'BACKEND', 'dev-backend');
      await createEnv(app, 'prod');
      await addVar(app, 'BACKEND', 'prod-backend');

      // 2. Build a request that uses {{BACKEND}} in the URL.
      await app.getByRole('button', { name: /^Editor$/ }).click();
      await sidebar.createRequest('plan-scoped');
      const path = '/anything/plan-scoped';
      await app.getByLabel('Request URL').fill(`${e2eMock.url(path)}?env={{BACKEND}}`);

      // 3. Send directly first → workspace order wins, dev's value echoes.
      await app.getByRole('button', { name: /^Send$/ }).click();
      await expect(app.getByText('200').first()).toBeVisible();
      const directHit = await e2eMock.findLastByPath((p) => p === path);
      expect(directHit.query.env).toBe('dev-backend');

      // 4. Build a plan with this request as a step. Don't override
      //    priority yet → plan run also resolves to dev's value.
      await app.getByRole('button', { name: /^Execution$/ }).click();
      await app.getByRole('button', { name: 'Create plan' }).first().click();
      await app.getByLabel('Plan name').fill('PriorityPlan');
      await app.getByRole('button', { name: 'Add step' }).first().click();
      await app.getByRole('checkbox', { name: 'Select plan-scoped' }).click();
      await app.getByRole('button', { name: 'Add step' }).last().click();

      await app.getByRole('button', { name: 'Run', exact: true }).click();
      await expect(app.getByText(/1\/1 requests succeeded/)).toBeVisible({ timeout: 10_000 });
      const noOverrideHit = await e2eMock.findLastByPath((p) => p === path);
      expect(noOverrideHit.query.env).toBe('dev-backend');

      // 5. Add prod to plan-level priority order. The PlanEnvPriorityEditor
      //    renders unprioritized envs as plain "<name>" buttons (with a
      //    leading + icon, not text) at the bottom of the section; the
      //    accessible name is just the env name. Scope the lookup to the
      //    Plan-level env priority section so it doesn't collide with the
      //    sidebar plan rows.
      const prioritySection = app.locator('section', {
        has: app.getByRole('heading', { name: 'Plan-level env priority' }),
      });
      await prioritySection.getByRole('button', { name: 'prod', exact: true }).click();
      // After clicking, prod is in the override list. Run again.
      await app.getByRole('button', { name: 'Run', exact: true }).click();
      // Expect verdict refresh — poll for prod's value on the wire.
      await expect
        .poll(
          async () => {
            const hit = await e2eMock.findLastByPath((p) => p === path);
            return hit.query.env;
          },
          { timeout: 10_000 },
        )
        .toBe('prod-backend');
    },
  );

  test(
    tc(id('Plan Reorder'), 'PlanEnvPriorityEditor reorder buttons persist via setPlanEnvPriority'),
    async ({ app }) => {
      // Seed three envs and create a plan in one go via the store, then
      // verify the up/down buttons reorder the plan-scoped priority.
      await app.evaluate(() => {
        const w = window as unknown as {
          __apicircleStore?: {
            getState: () => {
              addEnvironment: (n: string) => void;
              addPlan: () => string;
              setPlanEnvPriority: (id: string, order: string[]) => void;
              renamePlan: (id: string, name: string) => void;
              local?: { executionPlans: Record<string, { id: string }> };
            };
          };
        };
        const s = w.__apicircleStore!.getState();
        s.addEnvironment('alpha');
        s.addEnvironment('beta');
        s.addEnvironment('gamma');
        const planId = s.addPlan();
        s.renamePlan(planId, 'ReorderPlan');
        // Seed all three in alpha→beta→gamma order.
        s.setPlanEnvPriority(planId, ['alpha', 'beta', 'gamma']);
      });

      await app.getByRole('button', { name: /^Execution$/ }).click();
      // Plan is selected as latest; the editor renders "1. alpha", "2. beta",
      // "3. gamma" rows. Move beta up → order becomes alpha-beta swap.
      await app.getByRole('button', { name: 'Move beta up' }).click();
      // Now order is beta, alpha, gamma. Move gamma up twice → gamma, beta, alpha.
      await app.getByRole('button', { name: 'Move gamma up' }).click();
      await app.getByRole('button', { name: 'Move gamma up' }).click();

      // Read back from the store.
      const finalOrder = await app.evaluate(() => {
        const w = window as unknown as {
          __apicircleStore?: {
            getState: () => {
              local?: {
                executionPlans: Record<
                  string,
                  { id: string; name: string; envPriorityOrder: string[] }
                >;
              };
            };
          };
        };
        const plans = w.__apicircleStore!.getState().local?.executionPlans ?? {};
        const plan = Object.values(plans).find((p) => p.name === 'ReorderPlan');
        return plan?.envPriorityOrder ?? null;
      });
      expect(finalOrder).toEqual(['gamma', 'beta', 'alpha']);
    },
  );
});

// --- helpers --------------------------------------------------------------

async function createEnv(app: import('@playwright/test').Page, name: string): Promise<void> {
  await app.getByLabel('New environment').click();
  await app.getByLabel('Environment name', { exact: false }).first().fill(name);
  await app.getByLabel('Environment name', { exact: false }).first().press('Enter');
  await expect(app.getByRole('button', { name: `Edit variables in ${name}` })).toBeVisible();
}

async function addVar(
  app: import('@playwright/test').Page,
  key: string,
  value: string,
): Promise<void> {
  await app.getByRole('button', { name: 'Add variable' }).click();
  const keyInputs = app.getByLabel('Variable key');
  const valueInputs = app.getByLabel('Variable value');
  const idx = (await keyInputs.count()) - 1;
  await keyInputs.nth(idx).fill(key);
  await valueInputs.nth(idx).fill(value);
  await valueInputs.nth(idx).blur();
}
