import { runTests } from '@vscode/test-electron';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// =============================================================================
// Local-only E2E runner for Windows paths that contain spaces.
//
// `@vscode/test-electron` splits CLI arguments at spaces on Windows, so paths
// like "C:\Local Development\…" break the extension host loader. This script
// creates temporary directory junctions from space-free paths in %TEMP% and
// cleans them up when the run finishes.
//
// Usage:
//   pnpm --filter @apicircle/e2e-vscode test:e2e:local
// =============================================================================

function createJunction(target: string, label: string): { path: string; cleanup: () => void } {
  const junctionDir = path.join(os.tmpdir(), `apicircle-e2e-${label}-${process.pid}`);
  try {
    fs.rmSync(junctionDir, { recursive: true, force: true });
  } catch {
    /* stale cleanup */
  }
  fs.symlinkSync(target, junctionDir, 'junction');
  return {
    path: junctionDir,
    cleanup: () => {
      try {
        fs.rmSync(junctionDir, { force: true });
      } catch {
        /* ignore */
      }
    },
  };
}

function safePath(target: string, label: string): { path: string; cleanup: (() => void) | null } {
  if (process.platform !== 'win32' || !target.includes(' ')) {
    return { path: target, cleanup: null };
  }
  return createJunction(target, label);
}

async function main(): Promise<void> {
  const cleanups: (() => void)[] = [];
  try {
    const rawExtDevPath = path.resolve(__dirname, '../../../apps/vscode');
    const extDev = safePath(rawExtDevPath, 'ext');
    if (extDev.cleanup) cleanups.push(extDev.cleanup);

    const rawTestsPath = path.resolve(__dirname, './test/index.js');
    const testsDir = safePath(path.dirname(rawTestsPath), 'tests');
    if (testsDir.cleanup) cleanups.push(testsDir.cleanup);
    const extensionTestsPath = testsDir.cleanup
      ? path.join(testsDir.path, path.basename(rawTestsPath))
      : rawTestsPath;

    const userDataDir = path.join(os.tmpdir(), 'apicircle-e2e-userdata');
    fs.mkdirSync(userDataDir, { recursive: true });

    const rawWorkspace = path.resolve(__dirname, '../../test-fixtures/empty-workspace');
    const ws = safePath(rawWorkspace, 'ws');
    if (ws.cleanup) cleanups.push(ws.cleanup);

    await runTests({
      extensionDevelopmentPath: extDev.path,
      extensionTestsPath,
      launchArgs: [ws.path, '--user-data-dir', userDataDir, '--disable-extensions'],
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('E2E test run failed:', err);
    process.exit(1);
  } finally {
    for (const fn of cleanups) fn();
  }
}

void main();
