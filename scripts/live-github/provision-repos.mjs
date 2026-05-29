#!/usr/bin/env node
// Live-GitHub repo provisioner.
//
// Creates one private + one public empty repo under the bot owner with
// run-scoped unique names. Writes the resulting `owner/name` slugs into
// `$GITHUB_ENV` so downstream pipeline steps + the Playwright suite can
// pick them up via `getPipelineRepoConfig` in `e2e/web/live/_helpers.ts`.
//
// Required env:
//   APICIRCLE_E2E_BOT_OWNER   bot account login
//   APICIRCLE_E2E_GITHUB_PAT  bot PAT (needs `repo` scope; `delete_repo`
//                             is needed only by teardown)
//   GITHUB_ENV                path written by Actions to surface env vars
//                             to subsequent steps; in local-dev we just
//                             echo to stdout.
//   RUN_TAG                   unique suffix; falls back to a millisecond
//                             timestamp for local-dev runs.

import { appendFileSync } from 'node:fs';
import process from 'node:process';

const owner = process.env.APICIRCLE_E2E_BOT_OWNER?.trim();
const token = process.env.APICIRCLE_E2E_GITHUB_PAT?.trim();
const tag = process.env.RUN_TAG?.trim() || String(Date.now());
const ghEnvFile = process.env.GITHUB_ENV;

if (!owner) {
  console.error('provision-repos: APICIRCLE_E2E_BOT_OWNER is required.');
  process.exit(1);
}
if (!token) {
  console.error('provision-repos: APICIRCLE_E2E_GITHUB_PAT is required.');
  process.exit(1);
}

function ghHeaders() {
  return {
    Authorization: `token ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };
}

async function createRepo(name, visibility) {
  const res = await fetch('https://api.github.com/user/repos', {
    method: 'POST',
    headers: ghHeaders(),
    body: JSON.stringify({
      name,
      private: visibility === 'private',
      visibility,
      description: 'APICircle e2e — ephemeral, auto-managed',
      auto_init: false,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '<no-body>');
    throw new Error(`createRepo ${owner}/${name} failed (${res.status}): ${text}`);
  }
  const body = await res.json();
  return `${body.owner.login}/${body.name}`;
}

const privSlug = await createRepo(`apicircle-e2e-private-${tag}`, 'private');
const pubSlug = await createRepo(`apicircle-e2e-public-${tag}`, 'public');

const exports = [
  `APICIRCLE_E2E_PIPELINE_PRIVATE_REPO=${privSlug}`,
  `APICIRCLE_E2E_PIPELINE_PUBLIC_REPO=${pubSlug}`,
  // Local-dev fallbacks consume these too — same slug, different env name.
  `APICIRCLE_E2E_GITHUB_REPO=${privSlug}`,
  `APICIRCLE_E2E_GITHUB_LINK_PUBLIC_REPO=${pubSlug}`,
];

if (ghEnvFile) {
  appendFileSync(ghEnvFile, exports.join('\n') + '\n', 'utf-8');
  console.log(`provision-repos: wrote ${exports.length} env vars to $GITHUB_ENV.`);
} else {
  console.log('provision-repos: GITHUB_ENV unset — printing exports to stdout for local-dev sourcing.');
}
for (const e of exports) console.log(`  ${e}`);
