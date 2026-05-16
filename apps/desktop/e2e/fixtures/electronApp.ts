import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { _electron as electron, expect, test as base } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';

// Shared Electron fixtures for the desktop E2E suite. Each test gets a
// freshly-launched Electron main process pointed at a tmp userData dir,
// so window-state / native-keychain / IDB state from one test never
// leaks into the next.
//
// Pre-req: the main bundle must be built (`pnpm --filter @apicircle/desktop
// build:main`). The renderer is loaded from `apps/web/dist/index.html`
// via the relative path baked into main.ts, so the renderer must also
// be built (`pnpm --filter @apicircle/web build`).

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const DESKTOP_MAIN = path.resolve(REPO_ROOT, 'apps/desktop/dist/main/main.js');
const WEB_DIST = path.resolve(REPO_ROOT, 'apps/web/dist');

export interface ElectronFixtures {
  /** The launched Electron application handle. Tests don't normally need
   *  this — use `mainWindow` instead. */
  electronApp: ElectronApplication;
  /** The first BrowserWindow rendered after launch. Treat this like a
   *  Playwright Page — `getByRole`, `getByLabel`, etc. all work. */
  mainWindow: Page;
  /** Per-test temp userData directory. Auto-cleaned on teardown. */
  userDataDir: string;
}

interface LaunchOpts {
  /** Additional env vars to set on the spawned Electron process. */
  env?: Record<string, string>;
  /** Additional argv to pass to the main process. */
  extraArgs?: string[];
  /** Skip waiting for the first BrowserWindow. Useful for tests that
   *  assert the app never opens a window (single-instance second-launch). */
  skipFirstWindow?: boolean;
}

export async function launchElectron(opts: LaunchOpts = {}): Promise<{
  app: ElectronApplication;
  window?: Page;
  userDataDir: string;
}> {
  if (!fs.existsSync(DESKTOP_MAIN)) {
    throw new Error(
      `Electron main bundle not found at ${DESKTOP_MAIN}. ` +
        `Run \`pnpm --filter @apicircle/desktop build\` before the e2e suite.`,
    );
  }
  if (!fs.existsSync(path.join(WEB_DIST, 'index.html'))) {
    throw new Error(
      `Web renderer bundle not found at ${WEB_DIST}. ` +
        `Run \`pnpm --filter @apicircle/web build\` before the e2e suite.`,
    );
  }
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apicircle-e2e-'));
  const app = await electron.launch({
    args: [DESKTOP_MAIN, `--user-data-dir=${userDataDir}`, ...(opts.extraArgs ?? [])],
    env: {
      ...process.env,
      // Skip the auto-updater network probe on launch (the test would
      // otherwise hang on a real network roundtrip).
      APICIRCLE_DISABLE_AUTOUPDATE: '1',
      ...opts.env,
    },
    timeout: 30_000,
  });
  if (opts.skipFirstWindow) {
    return { app, userDataDir };
  }
  const window = await app.firstWindow();
  // Hydration completion sentinel — same wait the web app fixture uses.
  await expect(window.getByText('API Circle Studio', { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  return { app, window, userDataDir };
}

export const test = base.extend<ElectronFixtures>({
  // eslint-disable-next-line no-empty-pattern
  electronApp: async ({}, use) => {
    const { app, userDataDir } = await launchElectron();
    await use(app);
    await app.close().catch(() => {
      // Already closed or crashed. Don't mask the real test failure.
    });
    safeRm(userDataDir);
  },
  mainWindow: async ({ electronApp }, use) => {
    // The launch fixture already waited for firstWindow; reuse it.
    const windows = electronApp.windows();
    const window = windows[0] ?? (await electronApp.firstWindow());
    await use(window);
  },
  userDataDir: async ({ electronApp }, use) => {
    // The launch fixture creates this and the cleanup happens in
    // electronApp's teardown — expose the path to tests that need to
    // inspect on-disk side effects (window-state.json, etc).
    const dir = (await electronApp.evaluate(({ app }) => app.getPath('userData'))) as string;
    await use(dir);
  },
});

export { expect } from '@playwright/test';

function safeRm(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Windows is finicky about deleting tempdirs while the Electron
    // process is still releasing file handles. Worst case the tmpdir
    // sticks around until the next OS cleanup — not worth failing the
    // test over.
  }
}
