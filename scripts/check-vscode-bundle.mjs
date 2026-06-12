#!/usr/bin/env node
// scripts/check-vscode-bundle.mjs
//
// Bundle-size budget gate for the VS Code extension. Run via CI and locally:
//
//   node scripts/check-vscode-bundle.mjs
//
// Exits non-zero when `apps/vscode/dist/extension.js` exceeds the hard ceiling.
// Prints a warning (still exit 0) when the file crosses the soft threshold.
// Also exits non-zero with a CORRUPT-BUILD message when the bundle is below
// the sanity floor — catches the 0-byte / partial-write case where the build
// silently succeeded but produced nothing useful.
//
// Thresholds are imported from scripts/vscode-bundle-budget.mjs — that's the
// single source of truth shared with apps/vscode/test/integration/bundleSize.test.ts.
//
// Bump the ceiling deliberately when a phase introduces a load-bearing
// dependency (visual editor, auth signing libs, etc.). Don't bump it to
// silence a regression — investigate the regression first.

import { statSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SOFT_BUDGET_BYTES,
  HARD_BUDGET_BYTES,
  MIN_BUNDLE_BYTES,
  formatBytes,
} from './vscode-bundle-budget.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '..');

// P12-3 redo — extension is ESM now; tsup emits `.mjs` (Node treats it as
// ESM regardless of `"type"` so the test suite can stay default-CJS).
const BUNDLE_PATH = resolve(repoRoot, 'apps/vscode/dist/extension.mjs');

function main() {
  if (!existsSync(BUNDLE_PATH)) {
    console.error(
      `[check-vscode-bundle] ${BUNDLE_PATH} does not exist. Run \`pnpm --filter apicircle-vscode build\` first.`,
    );
    process.exit(2);
  }

  const stats = statSync(BUNDLE_PATH);
  const bytes = stats.size;

  console.log(`extension.js size: ${formatBytes(bytes)}`);
  console.log(`  min sanity:      ${formatBytes(MIN_BUNDLE_BYTES)}`);
  console.log(`  soft budget:     ${formatBytes(SOFT_BUDGET_BYTES)}`);
  console.log(`  hard budget:     ${formatBytes(HARD_BUDGET_BYTES)}`);

  if (bytes < MIN_BUNDLE_BYTES) {
    console.error(
      `::error::extension.js is ${formatBytes(bytes)} — below the ${formatBytes(MIN_BUNDLE_BYTES)} sanity floor. ` +
        `The build likely produced a corrupt or partial output. Re-run \`pnpm --filter apicircle-vscode build\`.`,
    );
    process.exit(1);
  }

  if (bytes > HARD_BUDGET_BYTES) {
    const overshoot = bytes - HARD_BUDGET_BYTES;
    console.error(
      `::error::extension.js exceeds the ${formatBytes(HARD_BUDGET_BYTES)} hard budget by ${formatBytes(overshoot)}. ` +
        `Investigate the regression before bumping the budget.`,
    );
    process.exit(1);
  }

  if (bytes > SOFT_BUDGET_BYTES) {
    const overshoot = bytes - SOFT_BUDGET_BYTES;
    console.warn(
      `::warning::extension.js exceeds the ${formatBytes(SOFT_BUDGET_BYTES)} soft budget by ${formatBytes(overshoot)}. ` +
        `Consider tree-shaking or lazy-loading before the next phase.`,
    );
    process.exit(0);
  }

  const headroom = HARD_BUDGET_BYTES - bytes;
  console.log(`OK — ${formatBytes(headroom)} headroom under the hard budget.`);
  process.exit(0);
}

main();
