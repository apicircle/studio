// Opt-in live GitHub credential smoke for `apicircle run`.
//
// Runs an execution plan whose single step calls the real GitHub REST API
// (`GET /user`) authenticated with a personal access token. The token is
// supplied the way a CI pipeline would supply it — as an `APICIRCLE_SECRET_*`
// environment variable that the CLI resolves into the workspace's encrypted
// env var. This exercises the full headless path: secret provisioning →
// variable resolution → bearer auth → real authenticated HTTP → assertions.
//
// The PAT is read ONLY from process env at runtime. Never hard-code a token
// here, in package scripts, or in docs. The workspace written to disk carries
// only a placeholder env var ({{GH_TOKEN}}) — the value never touches disk.
//
// Enable with:
//   APICIRCLE_E2E_LIVE_GITHUB=1
//   APICIRCLE_E2E_GITHUB_PAT=<a GitHub PAT with at least `read:user`>

import * as fs from 'node:fs';
import * as path from 'node:path';
import { test, expect } from '@playwright/test';
import { runCli, makeTmpDir } from './fixtures/cliSpawn';

const ENABLE_ENV = 'APICIRCLE_E2E_LIVE_GITHUB';
const TOKEN_ENV = 'APICIRCLE_E2E_GITHUB_PAT';
const NOW = '2026-05-18T00:00:00.000Z';
const SECRET_ID = 'ghpat';

function liveGithubSkipReason(): string | null {
  if (process.env[ENABLE_ENV] !== '1') {
    return `Set ${ENABLE_ENV}=1 to run the live GitHub CLI plan-run check.`;
  }
  if (!process.env[TOKEN_ENV]?.trim()) {
    return `Set ${TOKEN_ENV} to a GitHub PAT at runtime.`;
  }
  return null;
}

/** A workspace whose plan calls GET https://api.github.com/user with a PAT. */
function liveGithubWorkspace(): Record<string, unknown> {
  const meRequest = {
    id: 'me',
    name: 'GitHub /user',
    folderId: null,
    method: 'GET',
    url: 'https://api.github.com/user',
    headers: [
      { key: 'User-Agent', value: 'apicircle-e2e', enabled: true },
      { key: 'Accept', value: 'application/vnd.github+json', enabled: true },
    ],
    query: [],
    body: { type: 'none', content: '' },
    // {{GH_TOKEN}} resolves from the encrypted env var below, whose plaintext
    // is supplied at runtime via APICIRCLE_SECRET_ghpat.
    auth: { type: 'bearer', token: '{{GH_TOKEN}}' },
    contextVars: [],
    extractions: [],
    assertions: [{ id: 'me-status', kind: 'status', op: 'equals', expected: 200 }],
    createdAt: NOW,
    updatedAt: NOW,
  };
  return {
    schemaVersion: 1,
    workspaceId: 'ws-run-live-github',
    collections: {
      tree: { id: 'root', type: 'root', children: [] },
      requests: { me: meRequest },
      folders: {},
    },
    environments: {
      items: {
        Live: {
          name: 'Live',
          // Encrypted var: `value` is a placeholder — the runner substitutes
          // the plaintext from APICIRCLE_SECRET_ghpat, never the field below.
          variables: [
            { key: 'GH_TOKEN', value: 'enc:placeholder', encrypted: true, secretKeyId: SECRET_ID },
          ],
        },
      },
      activeName: null,
      priorityOrder: [{ kind: 'local', name: 'Live' }],
    },
    linkedWorkspaces: {},
    linkedOverrides: { requests: {}, environmentVars: {} },
    releases: { self: null, perLink: {} },
    globalAssets: { schemas: {}, graphql: {} },
    mockServers: {},
    secretKeys: {
      [SECRET_ID]: { id: SECRET_ID, label: 'GH_TOKEN', salt: 'AAAAAAAAAAAAAAAA', createdAt: NOW },
    },
    executionPlans: {
      'live-plan': {
        id: 'live-plan',
        name: 'GitHub live smoke',
        steps: [{ requestId: 'me' }],
        envPriorityOrder: [],
        createdAt: NOW,
        updatedAt: NOW,
      },
    },
    meta: { createdAt: NOW, updatedAt: NOW, appVersion: '0.1.0' },
  };
}

test.describe('CLI — apicircle run against live GitHub', () => {
  const skipReason = liveGithubSkipReason();
  test.skip(skipReason !== null, skipReason ?? '');

  test('runs a plan that calls the GitHub API with a PAT-backed secret @live-github', async () => {
    const token = process.env[TOKEN_ENV]!.trim();
    const ws = makeTmpDir('cli-run-live-github-');
    fs.writeFileSync(
      path.join(ws, 'workspace.json'),
      JSON.stringify(liveGithubWorkspace(), null, 2),
    );

    const r = await runCli({
      args: ['run', 'live-plan', '-w', ws, '--reporter', 'json', '--no-save'],
      env: { [`APICIRCLE_SECRET_${SECRET_ID}`]: token },
      timeoutMs: 30_000,
    });

    expect(r.exitCode, r.stdout + r.stderr).toBe(0);
    const report = JSON.parse(r.stdout) as {
      passed: boolean;
      steps: Array<{ status: number | null; passed: boolean; missingVariables: string[] }>;
    };
    expect(report.passed).toBe(true);
    expect(report.steps).toHaveLength(1);
    expect(report.steps[0].status).toBe(200);
    // The PAT secret resolved — no {{GH_TOKEN}} left dangling.
    expect(report.steps[0].missingVariables).toEqual([]);
  });
});
