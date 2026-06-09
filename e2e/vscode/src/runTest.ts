import { runTests } from '@vscode/test-electron';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// =============================================================================
// E2E runner — downloads VS Code (cached after first run), installs the
// APICircle extension into a fresh user-data dir, and runs the Mocha suite
// in `src/test/`.
//
// The downloaded VS Code lives under `.vscode-test/` and is cached across
// runs. CI uses `--reuse-vscode` to skip the download.
// =============================================================================

async function main(): Promise<void> {
  try {
    // Path to the compiled extension entry point — apps/vscode/dist/extension.js.
    const extensionDevelopmentPath = path.resolve(__dirname, '../../../apps/vscode');

    // Path to the compiled test loader (Mocha entry).
    const extensionTestsPath = path.resolve(__dirname, './test/index.js');

    // Use a deterministic, temp-isolated user-data dir per run so previous
    // state never contaminates the test (no leftover MRU lists, snapshots,
    // installed-extension lists, etc).
    const userDataDir = path.resolve(__dirname, '../.vscode-test/user-data');

    // The opened workspace folder during the test. We seed a canonical
    // `.apicircle/` layout in test-fixtures/empty-workspace/ so the extension
    // sees a real workspace at activation.
    const workspaceFolder = path.resolve(__dirname, '../../test-fixtures/empty-workspace');

    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [
        workspaceFolder,
        '--user-data-dir',
        userDataDir,
        '--disable-extensions', // Disable all OTHER extensions for hermeticity
      ],
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('E2E test run failed:', err);
    process.exit(1);
  }
}

void main();
