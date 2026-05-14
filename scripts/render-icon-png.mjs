// Deprecated: superseded by scripts/render-icons.mjs, which now produces the
// full set (per-size PNGs, multi-resolution .ico, multi-resolution .icns).
// This shim keeps the old entry point working — it forwards to the new
// pipeline so callers that still invoke `node scripts/render-icon-png.mjs`
// regenerate every artifact instead of just the 1024 PNG.

import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(here, 'render-icons.mjs');

console.warn(
  '[render-icon-png] deprecated — forwarding to scripts/render-icons.mjs ' +
    '(emits per-size PNGs + .ico + .icns).',
);

const result = spawnSync(process.execPath, [target], { stdio: 'inherit' });
process.exit(result.status ?? 0);
