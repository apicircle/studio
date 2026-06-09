// =============================================================================
// Bundle-size regression test (Phase 7 gate item).
//
// Guards the VS Code extension bundle against silent size regressions. Three
// tiers (mirrored by scripts/check-vscode-bundle.mjs and the CI step in
// .github/workflows/vscode.yml):
//
//   - Sanity floor : 500_000   bytes (~0.48 MB) — fails on corrupt-empty builds
//   - Soft warn    : 1_800_000 bytes (~1.72 MB) — console.warn, test still passes
//   - Hard fail    : 2_097_152 bytes (2.00 MB)  — test fails the suite
//
// All three thresholds come from scripts/vscode-bundle-budget.mjs — the
// single source of truth shared with the CI script. Bumping one but not the
// other is the bug we don't want to ship.
//
// Why the budget matters:
//   - The VS Code Marketplace caps published .vsix at ~50 MB but slow first
//     activation is the actual UX risk. Every MB of bundle is ~50–150ms of
//     load + parse on cold start.
//   - Phase 7 trimmed ~454 KB by adding "sideEffects": false to the
//     @apicircle/* packages, enabling esbuild tree-shaking via tsup's
//     `noExternal`.
//   - Future load-bearing additions (visual editor, additional auth signing
//     libs) WILL push toward 1.8 MB. Cross the soft threshold deliberately;
//     don't bump the budget to silence a regression.
//
// Run the build before running this test:
//   pnpm --filter @apicircle/vscode build
// then:
//   pnpm --filter @apicircle/vscode test
//
// The test skips itself (with a console.warn) when dist/extension.js is
// absent — useful for fresh checkouts that haven't built yet. CI ALWAYS
// builds before testing so the skip path never triggers in CI.
// =============================================================================

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SOFT_BUDGET_BYTES,
  HARD_BUDGET_BYTES,
  MIN_BUNDLE_BYTES,
  formatBytes,
} from '../../../../scripts/vscode-bundle-budget.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// P12-3 redo — ESM extension; entry filename is `extension.mjs`.
const BUNDLE_PATH = path.resolve(__dirname, '../../dist/extension.mjs');

describe('vscode extension bundle size', () => {
  // `it.skipIf` keeps the test in the report when the bundle doesn't exist —
  // makes the "build first" hint visible rather than silently passing.
  const bundleExists = fs.existsSync(BUNDLE_PATH);

  it.skipIf(!bundleExists)('stays under the 2.0 MB hard budget', () => {
    if (!bundleExists) return;
    const stats = fs.statSync(BUNDLE_PATH);
    if (stats.size > HARD_BUDGET_BYTES) {
      const overshoot = stats.size - HARD_BUDGET_BYTES;
      throw new Error(
        `extension.js is ${formatBytes(stats.size)} — exceeds 2.0 MB hard budget by ${formatBytes(overshoot)}. ` +
          `Investigate the regression before bumping the budget.`,
      );
    }
    expect(stats.size).toBeLessThanOrEqual(HARD_BUDGET_BYTES);
  });

  it.skipIf(!bundleExists)('stays above the 500 KB sanity floor (corrupt-build guard)', () => {
    if (!bundleExists) return;
    const stats = fs.statSync(BUNDLE_PATH);
    if (stats.size < MIN_BUNDLE_BYTES) {
      throw new Error(
        `extension.js is ${formatBytes(stats.size)} — below the ${formatBytes(MIN_BUNDLE_BYTES)} sanity floor. ` +
          `The build likely produced a corrupt or partial output. Re-run \`pnpm --filter @apicircle/vscode build\`.`,
      );
    }
    expect(stats.size).toBeGreaterThanOrEqual(MIN_BUNDLE_BYTES);
  });

  it.skipIf(!bundleExists)('emits a console warning when over the 1.8 MB soft budget', () => {
    if (!bundleExists) return;
    const stats = fs.statSync(BUNDLE_PATH);
    if (stats.size > SOFT_BUDGET_BYTES && stats.size <= HARD_BUDGET_BYTES) {
      const overshoot = stats.size - SOFT_BUDGET_BYTES;
      // Surface the warning so PR reviewers see it in test output. We don't
      // fail the suite here — the hard gate above does that.
      console.warn(
        `[bundle-size] extension.js is ${formatBytes(stats.size)} — over the 1.8 MB soft budget by ${formatBytes(overshoot)}.`,
      );
    }
    // No assertion — the test exists to surface the warning when applicable.
    expect(stats.size).toBeGreaterThan(0);
  });

  it.skipIf(bundleExists)('skip-rationale: build the extension first', () => {
    console.warn(
      `[bundle-size] ${BUNDLE_PATH} not found. Run \`pnpm --filter @apicircle/vscode build\` before this test.`,
    );
  });
});
