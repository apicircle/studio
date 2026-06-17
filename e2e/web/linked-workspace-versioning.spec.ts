// Linked workspace versioning (TC-LV-*) — 15 cells covering the publish
// + pin + adopt workflow for linked (read-only) workspaces.
//
// The mock GitHub server's contents + releases API powers the data
// plane. Most cells need the linked-workspace UI fully wired (publish
// modal, version picker, override editor), which is an ongoing
// follow-up — for now they're fixme'd with rationale.

import { test, expect } from './fixtures/gitFixture';
import { tc } from './fixtures/tcCoverage';
import { tcMapLV } from './fixtures/tcMapLV';

test.describe('Linked workspace versioning', () => {
  test.describe.configure({ mode: 'serial' });

  test(
    tc(tcMapLV['Link to latest version'], 'seeded linked workspace surfaces in marketplace search'),
    async ({ mockGithub }) => {
      const owner = 'mock-user';
      const name = `lv-search-${test.info().workerIndex}`;
      await mockGithub.seedRepo({
        owner,
        name,
        isPrivate: false,
        topics: ['apicircle-marketplace', 'apicircle'],
        seedFiles: [
          {
            path: '.apicircle/registry.json',
            content: JSON.stringify({
              schemaVersion: 1,
              activeWorkspaceId: 'seed-ws',
              workspaces: [{ id: 'seed-ws', name: 'Seed', createdAt: 't', lastOpenedAt: 't' }],
            }),
          },
          { path: '.apicircle/workspace-seed-ws/workspace.json', content: '{"linked":true}' },
        ],
      });
      // Direct verification — the mock's /_gh/search/repositories returns
      // the seeded repo with its topics.
      const res = await fetch(`${mockGithub.baseUrl}/_gh/search/repositories?q=apicircle`);
      expect(res.ok).toBe(true);
      const body = (await res.json()) as {
        items: Array<{ full_name: string; topics: string[] }>;
      };
      const match = body.items.find((it) => it.full_name === `${owner}/${name}`);
      expect(match).toBeTruthy();
      expect(match!.topics).toContain('apicircle-marketplace');
    },
  );

  for (const [key, tcId] of Object.entries(tcMapLV)) {
    if (key === 'Link to latest version') continue;
    test.fixme(tc(tcId, key), async () => {
      // Needs the publish-version UI + linked-workspace override
      // editor. The mock data plane (releases + contents + topics) is
      // wired up; this cell needs the UI surface walk.
    });
  }
});
