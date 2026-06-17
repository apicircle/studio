// =============================================================================
// Bundle-size regression test (Phase 7 gate item; ceilings re-tuned post-1.0
// for peer-extension parity).
//
// Guards the VS Code extension bundle against silent size regressions. Three
// tiers (mirrored by scripts/check-vscode-bundle.mjs and the CI step in
// .github/workflows/vscode.yml):
//
//   - Sanity floor : 500_000   bytes (~0.48 MB) — fails on corrupt-empty builds
//   - Soft warn    : 3_145_728 bytes (3.00 MB)  — console.warn, test still passes
//   - Hard fail    : 5_242_880 bytes (5.00 MB)  — test fails the suite
//
// All three thresholds come from scripts/vscode-bundle-budget.mjs — the
// single source of truth shared with the CI script. Bumping one but not the
// other is the bug we don't want to ship.
//
// Why these thresholds:
//   - The VS Code Marketplace allows .vsix uploads up to ~150 MB. Bundle
//     size is a PROXY for cold-start activation cost (~50-150ms per MB of
//     parse + execute) — but the actual UX gate is
//     `activationPerf.test.ts`, which asserts activate() < 500ms on a
//     100-request workspace and < 1000ms on a 500-request workspace.
//   - Peer extensions: Thunder Client ~5 MB, GitLens ~5-8 MB, ESLint ~6 MB,
//     Copilot ~20 MB. Our product surface (MCP host, Git workspace, mocks,
//     17 auth schemes, vault) puts us in the same league.
//   - Phase 7 trimmed ~454 KB via "sideEffects": false on workspace
//     packages. Future load-bearing additions (visual editor, additional
//     crypto / OAuth deps) absorb into the 5 MB ceiling without a budget
//     renegotiation. Soft warn at 3 MB still flags unexpected gains.
//
// Run the build before running this test:
//   pnpm --filter apicircle-vscode build
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

  it.skipIf(!bundleExists)('stays under the 5.0 MB hard budget', () => {
    if (!bundleExists) return;
    const stats = fs.statSync(BUNDLE_PATH);
    if (stats.size > HARD_BUDGET_BYTES) {
      const overshoot = stats.size - HARD_BUDGET_BYTES;
      throw new Error(
        `extension.js is ${formatBytes(stats.size)} — exceeds the ${formatBytes(HARD_BUDGET_BYTES)} hard budget by ${formatBytes(overshoot)}. ` +
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
          `The build likely produced a corrupt or partial output. Re-run \`pnpm --filter apicircle-vscode build\`.`,
      );
    }
    expect(stats.size).toBeGreaterThanOrEqual(MIN_BUNDLE_BYTES);
  });

  it.skipIf(!bundleExists)('emits a console warning when over the 3.0 MB soft budget', () => {
    if (!bundleExists) return;
    const stats = fs.statSync(BUNDLE_PATH);
    if (stats.size > SOFT_BUDGET_BYTES && stats.size <= HARD_BUDGET_BYTES) {
      const overshoot = stats.size - SOFT_BUDGET_BYTES;
      // Surface the warning so PR reviewers see it in test output. We don't
      // fail the suite here — the hard gate above does that.
      console.warn(
        `[bundle-size] extension.js is ${formatBytes(stats.size)} — over the ${formatBytes(SOFT_BUDGET_BYTES)} soft budget by ${formatBytes(overshoot)}.`,
      );
    }
    // No assertion — the test exists to surface the warning when applicable.
    expect(stats.size).toBeGreaterThan(0);
  });

  it.skipIf(bundleExists)('skip-rationale: build the extension first', () => {
    console.warn(
      `[bundle-size] ${BUNDLE_PATH} not found. Run \`pnpm --filter apicircle-vscode build\` before this test.`,
    );
  });

  // -----------------------------------------------------------------
  // ESM-of-CJS compatibility banner pin.
  //
  // tsup.config.ts injects a `createRequire(import.meta.url)` banner at
  // the top of `extension.mjs` so bundled CJS deps (proper-lockfile,
  // parts of the MCP SDK, etc.) can do `require('path')` / `require('fs')`
  // without hitting esbuild's `Dynamic require of "X" is not supported`
  // shim at activation. Without that banner, the extension dies on the
  // first internal require() call inside a bundled CJS dep — exactly the
  // failure mode this test exists to prevent.
  //
  // We pin the banner by header byte-check rather than parsing it because
  // we want a *literal* failure on accidental deletion, not a lenient
  // "ESM transform looks roughly right" pass.
  // -----------------------------------------------------------------
  it.skipIf(!bundleExists)('starts with the createRequire ESM-of-CJS banner', () => {
    if (!bundleExists) return;
    const head = fs.readFileSync(BUNDLE_PATH, 'utf-8').slice(0, 300);
    expect(
      head,
      'extension.mjs is missing the createRequire banner from tsup.config.ts. ' +
        'Without it, bundled CJS deps (proper-lockfile, MCP SDK) will throw ' +
        '`Dynamic require of "X" is not supported` at activation.',
    ).toContain('createRequire');
    expect(head).toContain('node:module');
    expect(head).toContain('import.meta.url');
  });
});
