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
