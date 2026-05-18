#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

// =============================================================================
// Drives `electron-builder` for the current host platform. The workflow runs
// this on three OSes (ubuntu, macos, windows); each produces the installers
// natively buildable on that platform (deb+AppImage on linux, dmg on macos,
// nsis exe on windows). Cross-builds aren't attempted — code-signing and
// platform-specific tooling make it not worth the complexity for v0.1.
// =============================================================================

const repoRoot = resolve(new URL('../..', import.meta.url).pathname);

// Regenerate the launcher mark from the source SVG before every installer
// build. Keeps build/icon.{png,ico,icns} + build/icons/<size>.png in lockstep
// with apps/web/public/favicon.svg, so a brand tweak only needs to land in
// one place to reach every OS launcher.
const icons = spawnSync('node', ['scripts/render-icons.mjs'], {
  stdio: 'inherit',
  cwd: repoRoot,
  shell: true,
});
if ((icons.status ?? 0) !== 0) process.exit(icons.status ?? 1);

const result = spawnSync(
  'pnpm',
  [
    '--filter',
    '@apicircle/desktop',
    'exec',
    'electron-builder',
    '--config',
    'electron-builder.yml',
  ],
  { stdio: 'inherit', cwd: repoRoot, shell: true },
);
process.exit(result.status ?? 0);
