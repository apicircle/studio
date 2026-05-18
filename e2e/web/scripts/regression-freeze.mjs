// C14 regression freeze runner. Runs the default e2e project N times
// back-to-back. Failures are captured in a flake table per run; any
// test that fails in run N but passes in run N+1 is flagged so the
// engineer can root-cause via Playwright's HTML report (kept under
// playwright-report/<run-N>).
//
// Usage:
//   pnpm --filter @apicircle/web regression-freeze [N=5]
//
// The script is platform-agnostic — uses `playwright` via spawnSync
// rather than shell loops.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const N = Number(process.argv[2] ?? 5);
const reportDir = join('playwright-report');
const archiveDir = join('regression-freeze-reports');
if (!existsSync(archiveDir)) mkdirSync(archiveDir, { recursive: true });

const flakeTable = [];
let firstFailureRun = -1;

for (let i = 1; i <= N; i++) {
  console.log(`\n=== Regression freeze run ${i}/${N} ===\n`);
  if (existsSync(reportDir)) rmSync(reportDir, { recursive: true, force: true });
  const result = spawnSync('playwright', ['test', '--project=chromium', '--reporter=list,html'], {
    stdio: 'inherit',
    shell: true,
  });
  const status = result.status ?? 1;
  if (existsSync(reportDir)) {
    const dest = join(archiveDir, `run-${i}`);
    if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
    renameSync(reportDir, dest);
  }
  if (status !== 0) {
    flakeTable.push({ run: i, status });
    if (firstFailureRun === -1) firstFailureRun = i;
  }
}

console.log('\n=== Regression freeze summary ===');
console.log(`Runs: ${N}`);
console.log(`Failures: ${flakeTable.length}`);
if (flakeTable.length === 0) {
  console.log('All green across all runs. ✅');
  process.exit(0);
}
console.log('Failed runs:', flakeTable);
console.log('Inspect per-run HTML reports under regression-freeze-reports/run-<n>/');
process.exit(1);
