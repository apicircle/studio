// Live GitHub — release ledger flows on a real repo.
//
// Each test publishes a unique version string (`0.<workerIndex>.<unix-ms>`)
// so re-runs don't collide on `releases.self.versions[].version`.
//
// We assert:
//   * publishRelease writes the version to `synced.releases.self`.
//   * push uploads that ledger and the remote workspace.json reflects it.
//   * deprecateRelease flips `deprecated: true` on the entry — and a
//     subsequent push round-trips the flip to the remote.
//   * yankRelease (the store action behind the UI's "Withdraw") flips
//     `yanked: true` — also round-trips.

import { expect, test } from '../fixtures/app';
import { tc } from '../fixtures/tcCoverage';
import { tcMapLV } from '../fixtures/tcMapLV';
import type { TcId } from '../fixtures/tcCoverage';
import {
  type LiveGithubConfig,
  connectAndBranch,
  deleteBranch,
  disconnect,
  getLiveConfig,
  liveSkipReason,
  makeBranchName,
  seedRepoIfEmpty,
} from './_helpers';

function lv(key: string): TcId {
  const v = tcMapLV[key];
  if (!v) throw new Error(`No TC-LV entry for "${key}"`);
  return v;
}

const createdBranches: string[] = [];

interface FetchedReleases {
  releases?: {
    self?: {
      versions?: Array<{ version: string; deprecated?: boolean; yanked?: boolean }>;
      currentVersion?: string;
    };
  };
}

async function fetchReleases(cfg: LiveGithubConfig, branch: string): Promise<FetchedReleases> {
  const url =
    `https://api.github.com/repos/${cfg.owner}/${cfg.name}/contents/workspace.json` +
    `?ref=${encodeURIComponent(branch)}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `token ${cfg.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!res.ok) throw new Error(`workspace.json fetch failed: ${res.status}`);
  const body = (await res.json()) as { content: string };
  return JSON.parse(Buffer.from(body.content, 'base64').toString('utf-8')) as FetchedReleases;
}

function uniqueVersion(workerIndex: number): string {
  return `0.${workerIndex}.${Date.now() % 1_000_000}`;
}

test.describe('Live GitHub — release publish / deprecate / withdraw @live-github', () => {
  test.describe.configure({ mode: 'serial' });

  const skip = liveSkipReason();
  test.skip(skip !== null, skip ?? '');

  let cfg: LiveGithubConfig;
  test.beforeAll(async () => {
    const c = getLiveConfig();
    if (!c) throw new Error('live config missing after skip checks');
    cfg = c;
    await seedRepoIfEmpty(cfg);
  });

  test.afterAll(async () => {
    for (const branch of createdBranches.splice(0)) {
      await deleteBranch(cfg, branch);
    }
  });

  test(
    tc(lv('Adopt new version'), 'publishRelease → push round-trips to remote workspace.json'),
    async ({ app }) => {
      const branch = makeBranchName(test.info().workerIndex, 'release-publish');
      createdBranches.push(branch);
      await connectAndBranch(app, cfg, branch);
      const version = uniqueVersion(test.info().workerIndex);

      await app.evaluate(
        async ({ v }) => {
          const api = window.__apicircleStore!.getState();
          await api.publishRelease({ version: v, notes: 'e2e publish' });
          await api.pushWorkspace(`e2e publish ${v}`);
        },
        { v: version },
      );
      const ws = await fetchReleases(cfg, branch);
      const entries = ws.releases?.self?.versions ?? [];
      expect(entries.some((e) => e.version === version)).toBe(true);
      expect(ws.releases?.self?.currentVersion).toBe(version);
      await disconnect(app);
    },
  );

  test(
    tc(lv('Adopt new version'), 'deprecateRelease → push round-trips deprecated:true to remote'),
    async ({ app }) => {
      const branch = makeBranchName(test.info().workerIndex, 'release-deprecate');
      createdBranches.push(branch);
      await connectAndBranch(app, cfg, branch);
      const version = uniqueVersion(test.info().workerIndex);

      await app.evaluate(
        async ({ v }) => {
          const api = window.__apicircleStore!.getState();
          await api.publishRelease({ version: v, notes: 'e2e deprecate seed' });
          api.deprecateRelease(v);
          await api.pushWorkspace(`e2e deprecate ${v}`);
        },
        { v: version },
      );
      const ws = await fetchReleases(cfg, branch);
      const entry = (ws.releases?.self?.versions ?? []).find((e) => e.version === version);
      expect(entry, 'deprecated entry must be present').toBeDefined();
      expect(entry?.deprecated).toBe(true);
      await disconnect(app);
    },
  );

  test(
    tc(lv('Adopt new version'), 'yankRelease (Withdraw) → push round-trips yanked:true to remote'),
    async ({ app }) => {
      const branch = makeBranchName(test.info().workerIndex, 'release-withdraw');
      createdBranches.push(branch);
      await connectAndBranch(app, cfg, branch);
      const version = uniqueVersion(test.info().workerIndex);

      await app.evaluate(
        async ({ v }) => {
          const api = window.__apicircleStore!.getState();
          await api.publishRelease({ version: v, notes: 'e2e withdraw seed' });
          api.yankRelease(v);
          await api.pushWorkspace(`e2e withdraw ${v}`);
        },
        { v: version },
      );
      const ws = await fetchReleases(cfg, branch);
      const entry = (ws.releases?.self?.versions ?? []).find((e) => e.version === version);
      expect(entry, 'withdrawn entry must be present').toBeDefined();
      expect(entry?.yanked).toBe(true);
      await disconnect(app);
    },
  );
});
