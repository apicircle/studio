#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

// =============================================================================
// Builds standalone CLI binaries with @yao-pkg/pkg. Invoked by the release
// workflow's `build-binaries` matrix job, once per OS/arch.
//
// Usage:  node scripts/release/buildBinaries.mjs --target=linux-x64
//
// Targets: linux-x64, macos-x64, macos-arm64, win-x64. Output lands in
// `dist/cli-<target>(.exe)` at the repo root so the workflow's artifact
// upload can pick them up uniformly.
// =============================================================================

const repoRoot = resolve(new URL('../..', import.meta.url).pathname);
const args = Object.fromEntries(
  process.argv.slice(2).flatMap((arg) => {
    const m = /^--([^=]+)=(.*)$/.exec(arg);
    return m ? [[m[1], m[2]]] : [];
  }),
);

const target = args.target;
if (!target) {
  console.error('Missing --target (linux-x64 | macos-x64 | macos-arm64 | win-x64)');
  process.exit(2);
}

const pkgTarget = `node20-${target}`;
const outDir = join(repoRoot, 'dist');
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, target.startsWith('win') ? `cli-${target}.exe` : `cli-${target}`);

const cliEntry = join(repoRoot, 'packages/cli/dist/index.cjs');
if (!existsSync(cliEntry)) {
  console.error(
    `CLI build artifact missing at ${cliEntry}. Run \`pnpm --filter @apicircle/cli build\` first.`,
  );
  process.exit(2);
}

const result = spawnSync(
  'pnpm',
  ['dlx', '@yao-pkg/pkg', '--target', pkgTarget, '--output', outFile, cliEntry],
  { stdio: 'inherit', cwd: repoRoot, shell: true },
);
if (result.status !== 0) {
  console.error(`pkg failed for target ${pkgTarget}`);
  process.exit(result.status ?? 1);
}

const stat = statSync(outFile);
console.log(`Built ${outFile} (${(stat.size / 1024 / 1024).toFixed(2)} MB)`);
