// Actions and reasons — the remaining Studio items of the October 2026 UX pass
// (STU-UX-1/5/8/11/14/15/16/17/18 in API Circle Lens's
// docs/planning/ux-enhancements-2026-10.md):
//
//   - a response body can be copied, saved to a file, and shown as received;
//   - a request or a folder moves to another folder from its row menu;
//   - a disabled button says why, on hover and on keyboard focus;
//   - environments say "used when sending", not "priority layer";
//   - the branch card has one solid main action, Push and Pull, and no
//     storage jargon;
//   - a long plan keeps its Run controls in view;
//   - sentence text is at least 12px, and the solid button reads at AA.
//
// The primitives (Button `solid` / `disabledReason`, DisabledReason,
// SectionHeading) and the per-theme `on-accent` tokens are unit-tested in
// packages/ui-components and apps/web.

import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/app';

/** The parts of the app's store (exposed on the dev server) these tests drive. */
interface Store {
  getState: () => {
    addRequest: (parent: string | null, name?: string) => string;
    addPlan: (name?: string) => string;
    addPlanStep: (planId: string, requestId: string) => void;
    addEnvironment: (name: string) => void;
    local: Record<string, unknown> & { sync: Record<string, unknown> };
  };
  setState: (partial: Record<string, unknown>) => void;
}

async function openPanel(app: Page, name: string): Promise<void> {
  await app.getByRole('button', { name: new RegExp(`^${name}$`) }).click();
}

test.describe('A response body: Copy, Save, Raw', () => {
  const BODY = '{"id":7,"tags":["a","b"]}';

  test('copies the body as shown, says "Copied", and Raw shows it as received', async ({
    app,
    context,
    mockApi,
    monaco,
    sidebar,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await mockApi.text('https://api.example.test/v1/users', BODY, {
      contentType: 'application/json',
    });
    await sidebar.createRequest('body tools');
    await app.getByLabel('Request URL').fill('https://api.example.test/v1/users');
    await app.getByRole('button', { name: /^Send$/ }).click();
    await expect(app.getByText(/^200\b/).first()).toBeVisible();

    const tools = app.getByRole('group', { name: 'Response body actions' });
    await expect(tools).toBeVisible();
    // Formatted by default.
    await monaco.ready('Response body');
    expect(await monaco.read('Response body')).toBe(JSON.stringify(JSON.parse(BODY), null, 2));

    await tools.getByRole('button', { name: 'Copy' }).click();
    await expect(tools.getByRole('button', { name: 'Copied' })).toBeVisible();
    // The system clipboard may hand back Windows line endings.
    const copied = await app.evaluate(() => navigator.clipboard.readText());
    expect(copied.replace(/\r\n/g, '\n')).toBe(JSON.stringify(JSON.parse(BODY), null, 2));
    await expect(tools.getByRole('button', { name: 'Copy' })).toBeVisible({ timeout: 4000 });

    const raw = tools.getByRole('button', { name: 'Raw' });
    await raw.click();
    await expect(raw).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => monaco.read('Response body')).toBe(BODY);
  });

  test('saves the body as received, named after the URL', async ({ app, mockApi, sidebar }) => {
    await mockApi.text('https://api.example.test/v1/users', BODY, {
      contentType: 'application/json',
    });
    await sidebar.createRequest('save body');
    await app.getByLabel('Request URL').fill('https://api.example.test/v1/users');
    await app.getByRole('button', { name: /^Send$/ }).click();
    await expect(app.getByText(/^200\b/).first()).toBeVisible();

    const [download] = await Promise.all([
      app.waitForEvent('download'),
      app
        .getByRole('group', { name: 'Response body actions' })
        .getByRole('button', { name: 'Save' })
        .click(),
    ]);
    expect(download.suggestedFilename()).toBe('users.json');
    expect(readFileSync(await download.path(), 'utf8')).toBe(BODY);
  });
});

test.describe('Move to…', () => {
  test('moves a request into a folder, and a folder back to the top level', async ({
    app,
    sidebar,
  }) => {
    await sidebar.createFolder('Users');
    await sidebar.createRequest('List users');
    await app.getByRole('button', { name: 'Request actions for List users' }).click();
    await app.getByRole('menuitem', { name: 'Move to…' }).click();
    const dialog = app.getByRole('dialog', { name: 'Move “List users”' });
    await expect(dialog).toBeVisible();
    // Where it is now is listed but cannot be picked, with the reason on its row.
    const top = dialog.getByRole('button', { name: /^Top level/ });
    await expect(top).toBeDisabled();
    await expect(top).toContainText('The request is here now.');
    await noAxeViolations(app);

    await dialog.getByRole('button', { name: 'Users' }).click();
    await expect(dialog).toBeHidden();
    await expect(app.getByText('Moved “List users” to “Users”')).toBeVisible();
    const tree = app.getByRole('tree', { name: 'Requests' });
    // The folder it went into is open, so the request is still in sight.
    await expect(tree.getByRole('button', { name: 'Collapse Users' })).toBeVisible();
    const folderRow = tree.getByRole('treeitem').filter({ hasText: 'Users' });
    await expect(folderRow.getByRole('group').getByText('List users')).toBeVisible();

    await app.getByRole('button', { name: 'Folder actions for Users' }).click();
    await app.getByRole('menuitem', { name: 'Move to…' }).click();
    const folderDialog = app.getByRole('dialog', { name: 'Move “Users”' });
    await expect(folderDialog.getByRole('button', { name: /^Users/ })).toContainText(
      'A folder can’t go inside itself.',
    );
    await folderDialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(folderDialog).toBeHidden();
  });
});

test.describe('A disabled button says why', () => {
  test('on hover and on keyboard focus', async ({ app }) => {
    await openPanel(app, 'Execution');
    await app.getByRole('button', { name: 'Create plan' }).click();
    const run = app.getByRole('button', { name: 'Run', exact: true });
    await expect(run).toBeDisabled();
    await expect(run).toHaveAccessibleDescription('Add a step first.');
    // The wrapper takes the pointer and the tab stop a disabled button cannot.
    await run.locator('..').hover();
    // Shown means opaque: closed tooltips stay in the DOM (and stay "visible"
    // to Playwright) at opacity 0, so the one this button names is read.
    const runTip = app.locator(`[id="${await run.getAttribute('aria-describedby')}"]`);
    await expect(runTip).toHaveText('Add a step first.');
    await expect(runTip).toHaveClass(/opacity-100/);
    // And with the pointer gone, from the keyboard: focus reaches the wrapper.
    await app.mouse.move(0, 0);
    await expect(runTip).toHaveClass(/opacity-0/);
    await run.locator('..').focus();
    await expect(runTip).toHaveClass(/opacity-100/);
  });
});

test.describe('Environments: used when sending', () => {
  test('says which environments a send uses, in plain words', async ({ app }) => {
    await openPanel(app, 'Environments');
    await app.getByRole('button', { name: 'Create your first environment' }).click();
    const name = app.getByLabel('Environment name').first();
    await name.fill('dev');
    await name.press('Enter');
    const use = app.getByRole('checkbox', { name: 'Use dev when sending' });
    await expect(use).toBeChecked();
    await expect(app.getByText('Used when sending · 1 of 1')).toBeVisible();
    await use.uncheck();
    await expect(app.getByText('Not used when sending')).toBeVisible();
    await expect(app.getByText(/global (priority )?layer/i)).toHaveCount(0);
    // Sentence text is at least 12px, before the user's text-size setting
    // (which scales the root): 0.75rem of whatever the root is.
    const footer = app.getByText(/^Tick an environment to use it when sending/);
    const [size, root] = await footer.evaluate((el) => [
      parseFloat(getComputedStyle(el).fontSize),
      parseFloat(getComputedStyle(document.documentElement).fontSize),
    ]);
    expect(size / root).toBeCloseTo(0.75, 5);
  });
});

test.describe('The working-branch card', () => {
  async function seedBranch(app: Page, lastPushedSha: string | null): Promise<void> {
    await app.evaluate((pushed) => {
      const store = (window as unknown as { __apicircleStore: Store }).__apicircleStore;
      const local = store.getState().local;
      store.setState({
        local: {
          ...local,
          sync: { ...local.sync, lastPulledAt: null },
          sessions: {
            github: {
              workspace: {
                accountLogin: 'me',
                tokenSecretId: 'sec',
                grantedScopes: ['repo'],
                addedAt: 't',
                lastVerifiedAt: 't',
                canCreatePullRequests: true,
              },
              links: {},
            },
          },
          connectedRepo: {
            fullName: 'me/api',
            owner: 'me',
            name: 'api',
            defaultBranch: 'main',
            visibility: 'public',
            isPrivate: false,
            pushable: true,
            connectedAt: 't',
          },
          workingBranch: {
            name: 'apicircle/ux',
            baseBranch: 'main',
            repoFullName: 'me/api',
            repoOwner: 'me',
            repoName: 'api',
            headSha: 'abc1234def',
            createdAt: new Date().toISOString(),
            lastPushedSha: pushed,
            diffSummary: null,
            openPrUrl: null,
          },
        },
      });
    }, lastPushedSha);
  }

  test('one solid main action, Push and Pull, and why Create PR waits', async ({ app }) => {
    await openPanel(app, 'Workspace');
    await seedBranch(app, null);
    await app.evaluate(() =>
      (window as unknown as { __apicircleStore: Store }).__apicircleStore
        .getState()
        .addEnvironment('Staging'),
    );
    const push = app.getByRole('button', { name: 'Push to save' });
    await expect(push).toHaveClass(/\bbg-accent\b/);
    await expect(app.getByRole('button', { name: 'Pull', exact: true })).toBeVisible();
    await expect(app.getByRole('button', { name: 'Refresh', exact: true })).toHaveCount(0);
    const pr = app.getByRole('button', { name: 'Create PR' });
    await expect(pr).toBeDisabled();
    await expect(pr).toHaveAccessibleDescription('Push to save before opening a pull request.');
    await expect(pr).not.toHaveClass(/\bbg-accent\b/);
    // No storage jargon in what the card says.
    const card = app.locator('.rounded-sm.border.border-border.bg-card.p-3').filter({
      hasText: 'apicircle/ux',
    });
    await expect(card).not.toContainText(/IndexedDB|\bIDB\b|blob/);
    const sync = app.getByRole('button', { name: 'Sync attachments' });
    expect(await sync.getAttribute('title')).not.toMatch(/IDB|blob/);
  });

  test('Create PR is the main action once the branch is pushed and clean', async ({ app }) => {
    await openPanel(app, 'Workspace');
    await seedBranch(app, 'abc1234def');
    await expect(app.getByRole('button', { name: 'Create PR' })).toHaveClass(/\bbg-accent\b/);
    await expect(app.getByRole('button', { name: 'Push to save' })).not.toHaveClass(
      /\bbg-accent\b/,
    );
  });
});

test.describe('A long plan', () => {
  test('keeps its Run controls in view while it scrolls', async ({ app }) => {
    await app.evaluate(() => {
      const store = (window as unknown as { __apicircleStore: Store }).__apicircleStore;
      const planId = store.getState().addPlan('Long plan');
      for (let i = 0; i < 30; i += 1) {
        const requestId = store.getState().addRequest(null, `Step ${i + 1}`);
        store.getState().addPlanStep(planId, requestId);
      }
    });
    await openPanel(app, 'Execution');
    const bar = app.getByTestId('plan-run-bar');
    const scroller = bar.locator('xpath=ancestor::div[contains(@class,"overflow-y-auto")][1]');
    const view = await scroller.boundingBox();
    const box = await bar.boundingBox();
    expect(view && box).toBeTruthy();
    // Pinned to the foot of the panel, not 30 rows further down.
    expect(Math.abs(box!.y + box!.height - (view!.y + view!.height))).toBeLessThan(2);
    await expect(bar.getByRole('button', { name: 'Run', exact: true })).toBeInViewport();
    // At the end of the plan it settles back into place above the details.
    await scroller.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await expect(bar.getByRole('button', { name: 'Run', exact: true })).toBeInViewport();
  });
});

test.describe('The solid main button', () => {
  test('reads at AA on the default theme', async ({ app, sidebar }) => {
    await sidebar.createRequest('contrast');
    // Solid: a fill of the accent itself, labelled in the theme's on-accent colour.
    const send = app.locator('[data-tour="send-request"]');
    await expect(send).toHaveClass(/\bbg-accent\b/);
    await expect(send).toHaveClass(/\btext-on-accent\b/);
    const results = await new AxeBuilder({ page: app })
      .include('[data-tour="send-request"]')
      .withRules(['color-contrast'])
      .analyze();
    expect(results.violations).toEqual([]);
    expect(results.passes.map((p) => p.id)).toContain('color-contrast');
  });
});

async function noAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .disableRules(['region', 'color-contrast'])
    .analyze();
  expect(results.violations).toEqual([]);
}
