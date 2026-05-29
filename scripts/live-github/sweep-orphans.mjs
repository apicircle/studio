#!/usr/bin/env node
// Live-GitHub orphan sweep.
//
// Lists bot-owned repos prefixed with `apicircle-e2e-` and deletes the
// ones older than the cutoff. Runs at the start of every pipeline tick
// so a previous run that failed teardown can't leave repos lingering
// forever. Idempotent — safe to run from local-dev too.
//
// Required env:
//   APICIRCLE_E2E_BOT_OWNER  the bot account login
//   APICIRCLE_E2E_GITHUB_PAT the bot's PAT (repo + delete_repo)
// Optional:
//   APICIRCLE_E2E_SWEEP_PREFIX     default "apicircle-e2e-"
//   APICIRCLE_E2E_SWEEP_MAX_AGE_MS default 12h (43_200_000)
//
// Exits 0 on success. Exits 1 on auth or list failure (so the pipeline
// fails fast, before provisioning, with a clear error).

import process from 'node:process';

const owner = process.env.APICIRCLE_E2E_BOT_OWNER?.trim();
const token = process.env.APICIRCLE_E2E_GITHUB_PAT?.trim();
const prefix = process.env.APICIRCLE_E2E_SWEEP_PREFIX?.trim() || 'apicircle-e2e-';
const maxAgeMs = Number(process.env.APICIRCLE_E2E_SWEEP_MAX_AGE_MS ?? 12 * 60 * 60 * 1000);

if (!owner) {
  console.error('sweep-orphans: APICIRCLE_E2E_BOT_OWNER is required.');
  process.exit(1);
}
if (!token) {
  console.error('sweep-orphans: APICIRCLE_E2E_GITHUB_PAT is required.');
  process.exit(1);
}

function ghHeaders() {
  return {
    Authorization: `token ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

const deleted = [];
const skipped = [];
let page = 1;
const cutoff = Date.now() - maxAgeMs;

while (true) {
  const res = await fetch(
    `https://api.github.com/users/${owner}/repos?per_page=100&page=${page}&sort=created&direction=desc`,
    { headers: ghHeaders() },
  );
  if (!res.ok) {
    console.error(`sweep-orphans: list repos failed (${res.status})`);
    process.exit(1);
  }
  const repos = await res.json();
  if (!Array.isArray(repos) || repos.length === 0) break;
  for (const r of repos) {
    if (!r.name.startsWith(prefix)) continue;
    const created = new Date(r.created_at).getTime();
    if (created > cutoff) {
      skipped.push(`${owner}/${r.name} (created ${r.created_at}, under cutoff)`);
      continue;
    }
    const del = await fetch(`https://api.github.com/repos/${owner}/${r.name}`, {
      method: 'DELETE',
      headers: ghHeaders(),
    });
    if (del.ok || del.status === 404) {
      deleted.push(`${owner}/${r.name}`);
    } else {
      console.error(`sweep-orphans: DELETE ${owner}/${r.name} failed (${del.status})`);
    }
  }
  if (repos.length < 100) break;
  page += 1;
}

console.log(`sweep-orphans: deleted ${deleted.length}, skipped (too young) ${skipped.length}.`);
for (const d of deleted) console.log(`  - ${d}`);
