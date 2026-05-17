// Cross-platform launcher for the full header sweep. Sets the env vars
// the parameterized specs read at import time (FULL_HEADER_SWEEP /
// FULL_VALUE_SWEEP) and invokes Playwright with the full-sweep project.
//
// Why a Node script instead of inline shell? Windows + POSIX env-var
// syntax differ; using `process.env.FOO = ...` here keeps the script
// platform-agnostic without pulling in cross-env.

import { spawnSync } from 'node:child_process';

const env = {
  ...process.env,
  FULL_HEADER_SWEEP: '1',
  FULL_VALUE_SWEEP: '1',
};

const result = spawnSync('playwright', ['test', '--project=chromium-full-sweep'], {
  env,
  stdio: 'inherit',
  shell: true,
});

process.exit(result.status ?? 1);
