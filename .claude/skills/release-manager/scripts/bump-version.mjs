#!/usr/bin/env node
// Bump every workspace package.json (and the repo root) to a single version.
//
// One release = one version across the whole monorepo. Doing this by hand is a
// footgun: miss apps/desktop and `desktop-release.yml` hard-fails on the
// tag-vs-package mismatch; miss a published package and the npm set goes
// incoherent. This script reads the package globs straight from
// `pnpm-workspace.yaml` so it can never drift from the real workspace layout.
//
// Usage (run from the repo root):
//   node .claude/skills/release-manager/scripts/bump-version.mjs <version>
//   node .claude/skills/release-manager/scripts/bump-version.mjs <version> --dry
//
// After a real run, refresh the lockfile:
//   pnpm install --lockfile-only
//
// Dependency-free (Node fs only) and Windows-safe.

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const dry = args.includes('--dry') || args.includes('--dry-run');
const version = args.find((a) => !a.startsWith('-'));

if (!version) {
  console.error('Usage: node bump-version.mjs <version> [--dry]');
  process.exit(1);
}
// Permissive semver guard — major.minor.patch with an optional -prerelease.
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error(`Refusing to bump: "${version}" is not a semver version (expected e.g. 1.1.6).`);
  process.exit(1);
}

const root = process.cwd();
const wsFile = join(root, 'pnpm-workspace.yaml');
if (!existsSync(wsFile)) {
  console.error('pnpm-workspace.yaml not found — run this from the repo root.');
  process.exit(1);
}

// Tiny, purpose-built parser for the `packages:` list in pnpm-workspace.yaml.
// We only need the `- 'glob'` lines; no need to pull in a YAML dependency.
const patterns = readFileSync(wsFile, 'utf8')
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => l.startsWith('- '))
  .map((l) => l.slice(2).trim().replace(/^['"]|['"]$/g, ''));

// Expand each pattern to concrete directories. We only support the two shapes
// the workspace actually uses: `dir/*` (immediate children) and an exact path.
const dirs = new Set();
for (const pattern of patterns) {
  if (pattern.endsWith('/*')) {
    const base = join(root, pattern.slice(0, -2));
    if (!existsSync(base)) continue;
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (entry.isDirectory()) dirs.add(join(base, entry.name));
    }
  } else {
    dirs.add(join(root, pattern));
  }
}

// The root package.json ships the version the `v*` tag is derived from, so it
// is always part of the bump even though it isn't a workspace member.
const targets = [root, ...[...dirs].sort()];

const changed = [];
const skipped = [];
const missing = [];

for (const dir of targets) {
  const pkgPath = join(dir, 'package.json');
  if (!existsSync(pkgPath)) {
    missing.push(dir);
    continue;
  }
  const raw = readFileSync(pkgPath, 'utf8');
  const pkg = JSON.parse(raw);
  const rel = pkgPath.slice(resolve(root).length + 1) || 'package.json';

  if (!('version' in pkg)) {
    skipped.push(`${rel} (no version field)`);
    continue;
  }
  if (pkg.version === version) {
    skipped.push(`${rel} (already ${version})`);
    continue;
  }

  const from = pkg.version;
  pkg.version = version;
  // Match the repo's 2-space, trailing-newline house style. prettier (via
  // lint-staged) will normalise anything finicky on commit anyway.
  const next = JSON.stringify(pkg, null, 2) + '\n';
  if (!dry) writeFileSync(pkgPath, next);
  changed.push(`${rel}: ${from} -> ${version}`);
}

const tag = dry ? '[dry-run] ' : '';
console.log(
  `${tag}Set version ${version} across ${changed.length + skipped.length} package.json files ` +
    `(${targets.length} workspace locations scanned)\n`,
);
if (changed.length) {
  console.log('Changed:');
  for (const c of changed) console.log(`  ${c}`);
}
if (skipped.length) {
  console.log('\nSkipped:');
  for (const s of skipped) console.log(`  ${s}`);
}
if (missing.length) {
  console.log('\nNo package.json (ignored):');
  for (const m of missing) console.log(`  ${m.slice(resolve(root).length + 1)}`);
}

console.log(
  dry
    ? '\nDry run — nothing written. Re-run without --dry to apply.'
    : '\nDone. Next: pnpm install --lockfile-only, then review with git diff.',
);
