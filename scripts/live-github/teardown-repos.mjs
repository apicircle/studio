#!/usr/bin/env node
// Live-GitHub repo teardown.
//
// Deletes the two pipeline-provisioned repos. Runs unconditionally in
// the workflow (`if: always()`) so a failed test run doesn't leak the
// ephemeral repos. Idempotent — 404 is fine. Refuses to delete a repo
// whose owner doesn't match APICIRCLE_E2E_BOT_OWNER (typo guard).
//
// Required env:
//   APICIRCLE_E2E_BOT_OWNER             bot account login
//   APICIRCLE_E2E_GITHUB_PAT            bot PAT (needs delete_repo scope)
//   APICIRCLE_E2E_PIPELINE_PRIVATE_REPO  set by provision-repos.mjs
//   APICIRCLE_E2E_PIPELINE_PUBLIC_REPO   set by provision-repos.mjs

import process from 'node:process';

const owner = process.env.APICIRCLE_E2E_BOT_OWNER?.trim();
const token = process.env.APICIRCLE_E2E_GITHUB_PAT?.trim();
const slugs = [
  process.env.APICIRCLE_E2E_PIPELINE_PRIVATE_REPO,
  process.env.APICIRCLE_E2E_PIPELINE_PUBLIC_REPO,
]
  .filter(Boolean)
  .map((s) => s.trim());

if (!owner) {
  console.error('teardown-repos: APICIRCLE_E2E_BOT_OWNER is required.');
  process.exit(1);
}
if (!token) {
  console.error('teardown-repos: APICIRCLE_E2E_GITHUB_PAT is required.');
  process.exit(1);
}
if (slugs.length === 0) {
  console.log('teardown-repos: no APICIRCLE_E2E_PIPELINE_*_REPO set — nothing to delete.');
  process.exit(0);
}

function ghHeaders() {
  return {
    Authorization: `token ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

let failures = 0;
for (const slug of slugs) {
  const [slugOwner, name] = slug.split('/');
  if (slugOwner !== owner) {
    console.error(`teardown-repos: REFUSED — repo ${slug} not owned by bot ${owner}.`);
    failures += 1;
    continue;
  }
  const res = await fetch(`https://api.github.com/repos/${slugOwner}/${name}`, {
    method: 'DELETE',
    headers: ghHeaders(),
  });
  if (res.ok || res.status === 404) {
    console.log(`teardown-repos: deleted ${slug}${res.status === 404 ? ' (already gone)' : ''}.`);
  } else {
    const text = await res.text().catch(() => '<no-body>');
    console.error(`teardown-repos: DELETE ${slug} failed (${res.status}): ${text}`);
    failures += 1;
  }
}

if (failures > 0) {
  console.error(`teardown-repos: ${failures} failure(s); orphan sweep will catch them on the next run.`);
  // Don't fail the workflow on teardown errors — the run might still
  // have valid results to report, and orphan sweep will clean up.
  process.exit(0);
}
