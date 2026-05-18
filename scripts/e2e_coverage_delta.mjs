#!/usr/bin/env node
/**
 * E2E coverage delta — runs in CI on `pull_request` events. Compares the
 * strict-live coverage of the PR head against the most-recent main build
 * and posts a sticky comment to the PR summarising the delta. Fails the
 * build (exit 2) if the delta drops by more than `MAX_REGRESSION_PP`
 * percentage points.
 *
 * Required env (all set by .github/workflows/e2e.yml):
 *   - GITHUB_TOKEN — repo-scoped PAT for the comment API
 *   - PR_NUMBER    — pull-request number
 *   - PR_HEAD_SHA  — head SHA of the PR
 *   - REPO         — owner/name (e.g. apicircle/studio)
 *
 * Inputs:
 *   - docs/qa/results/e2e-coverage.json — PR build's strict report
 *   - Latest successful main workflow run's coverage artifact (looked up
 *     via the workflow runs API). If main has no published report yet
 *     we treat the baseline as 0% and skip the regression gate.
 */

import { readFile } from 'node:fs/promises';

const MAX_REGRESSION_PP = 2.0;

const requiredEnv = ['GITHUB_TOKEN', 'PR_NUMBER', 'PR_HEAD_SHA', 'REPO'];
for (const k of requiredEnv) {
  if (!process.env[k]) {
    console.error(`::error::missing env ${k}`);
    process.exit(1);
  }
}

const { GITHUB_TOKEN, PR_NUMBER, REPO } = process.env;
const [owner, repo] = REPO.split('/');

async function gh(path, init = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'apicircle-e2e-delta',
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status} ${res.statusText}: ${await res.text()}`);
  }
  return res;
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (err) {
    console.error(`could not read ${path}: ${err.message}`);
    return null;
  }
}

/**
 * Fetch the most-recent successful workflow run for the same workflow on
 * `main`, download its `e2e-coverage` artifact, return the JSON. If no
 * such run exists yet (first time the workflow lands on main), return
 * null and skip the gate.
 */
async function fetchMainBaseline() {
  // The workflow file path identifies our workflow uniquely.
  const runs = await gh(
    `/repos/${owner}/${repo}/actions/workflows/e2e.yml/runs` +
      `?branch=main&status=success&per_page=5`,
  );
  const { workflow_runs } = await runs.json();
  if (!Array.isArray(workflow_runs) || workflow_runs.length === 0) {
    console.log('No successful main run yet — treating baseline as 0%.');
    return null;
  }

  for (const run of workflow_runs) {
    const arts = await gh(`/repos/${owner}/${repo}/actions/runs/${run.id}/artifacts`);
    const { artifacts } = await arts.json();
    const cov = artifacts.find((a) => a.name.startsWith('e2e-coverage-'));
    if (!cov) continue;
    const zipRes = await gh(`/repos/${owner}/${repo}/actions/artifacts/${cov.id}/zip`, {
      redirect: 'follow',
    });
    const buf = Buffer.from(await zipRes.arrayBuffer());
    // Decode the zip in memory using DecompressionStream? Node has no
    // built-in zip — but the artifact zip contains the JSON we want.
    // Use a tiny inline reader: shell out to `unzip` (available on
    // ubuntu-latest runners).
    const { execFileSync } = await import('node:child_process');
    const { writeFileSync, mkdtempSync, readFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const path = await import('node:path');
    const dir = mkdtempSync(path.join(tmpdir(), 'cov-'));
    const zipPath = path.join(dir, 'cov.zip');
    writeFileSync(zipPath, buf);
    execFileSync('unzip', ['-q', zipPath, '-d', dir], { stdio: 'ignore' });
    const jsonPath = path.join(dir, 'e2e-coverage.json');
    return JSON.parse(readFileSync(jsonPath, 'utf8'));
  }
  console.log('Main runs have no coverage artifact — skipping gate.');
  return null;
}

function fmtPct(n) {
  return `${n.toFixed(2)}%`;
}
function fmtDelta(d) {
  if (d > 0) return `+${d.toFixed(2)}pp`;
  if (d < 0) return `${d.toFixed(2)}pp`;
  return '±0.00pp';
}

const COMMENT_MARKER = '<!-- apicircle-e2e-coverage-delta -->';

async function upsertComment(body) {
  // Look up existing sticky comment by marker.
  const comments = await gh(`/repos/${owner}/${repo}/issues/${PR_NUMBER}/comments?per_page=100`);
  const list = await comments.json();
  const existing = list.find((c) => c.body && c.body.includes(COMMENT_MARKER));
  const payload = JSON.stringify({ body });
  if (existing) {
    await gh(`/repos/${owner}/${repo}/issues/comments/${existing.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    });
  } else {
    await gh(`/repos/${owner}/${repo}/issues/${PR_NUMBER}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    });
  }
}

async function main() {
  const head = await readJson('docs/qa/results/e2e-coverage.json');
  if (!head) {
    console.error('::error::head coverage JSON missing — was the report step run?');
    process.exit(1);
  }
  const main = await fetchMainBaseline();

  const headPct = head.counts.live_pct;
  const headLive = head.counts.live;
  const headScaffold = head.counts.scaffold_only;
  const headResidue = head.counts.manual_residue;
  const total = head.counts.total;
  const headPassed = head.passed_from_results;

  let mainPct = 0;
  let mainLive = 0;
  if (main) {
    mainPct = main.counts.live_pct;
    mainLive = main.counts.live;
  }
  const deltaPct = headPct - mainPct;
  const deltaLive = headLive - mainLive;

  const body = [
    COMMENT_MARKER,
    '## E2E coverage (strict mode)',
    '',
    '| Metric | This PR | main | Δ |',
    '|---|---:|---:|---:|',
    `| Live coverage | ${fmtPct(headPct)} (${headLive}/${total}) | ${fmtPct(mainPct)} (${mainLive}/${total}) | **${fmtDelta(deltaPct)}** (${deltaLive >= 0 ? '+' : ''}${deltaLive}) |`,
    `| Scaffold-only | ${headScaffold} | — | — |`,
    `| Manual-residue | ${headResidue} | — | — |`,
    headPassed != null ? `| Passing TC-IDs this run | **${headPassed.length}** | — | — |` : '',
    '',
    deltaPct < -MAX_REGRESSION_PP
      ? `> ⚠️  Live coverage regressed by ${(-deltaPct).toFixed(2)}pp — over the ${MAX_REGRESSION_PP}pp floor. Check if a test was deleted or moved to \`test.fixme()\` without justification.`
      : deltaPct > 0
        ? `> ✅  Live coverage improved by ${deltaPct.toFixed(2)}pp.`
        : '> Live coverage unchanged.',
    '',
    'Definitions: live = inline `tc()` / `tcRange()` in non-fixme `test()` calls. Scaffold-only = `test.fixme()` placeholders. Manual-residue = explicitly excluded from automation (see `e2e/web/manual-residue.ts`).',
    '',
    'Full report in the `e2e-coverage-${{ run_id }}` artifact.',
  ]
    .filter(Boolean)
    .join('\n');

  await upsertComment(body);

  if (main && deltaPct < -MAX_REGRESSION_PP) {
    console.error(
      `::error::E2E live coverage regressed ${(-deltaPct).toFixed(2)}pp vs main (floor ${MAX_REGRESSION_PP}pp)`,
    );
    process.exit(2);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
