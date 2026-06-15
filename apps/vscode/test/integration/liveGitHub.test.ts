import { describe, it, expect } from 'vitest';
import { GitHubClient } from '@apicircle/git';
import {
  fetchRemoteWorkspaceJson,
  parseLinkedWorkspaceJson,
  ledgerFromProbe,
} from '@apicircle/core';

// =============================================================================
// Live GitHub integration smoke test.
//
// Gated: this suite only runs when these env vars are set
//
//   APICIRCLE_LIVE_GH_TOKEN   — a GitHub PAT with at least `repo:read` scope.
//   APICIRCLE_LIVE_GH_REPO    — owner/name of a repo containing
//                                `.apicircle/registry.json` (public or
//                                accessible to the token).
//   APICIRCLE_LIVE_GH_BRANCH  — optional, defaults to `main`.
//
// When not set, every test below is `skip`'d — CI stays green without
// credentials. Run locally with:
//
//   APICIRCLE_LIVE_GH_TOKEN=ghp_... \
//   APICIRCLE_LIVE_GH_REPO=apicircle/example \
//   pnpm --filter apicircle-vscode test -- --run liveGitHub
//
// The test never writes to the remote repo — it only reads contents + tag
// metadata, so it's safe to point at a real workspace repo.
// =============================================================================

const token = process.env.APICIRCLE_LIVE_GH_TOKEN ?? '';
const repo = process.env.APICIRCLE_LIVE_GH_REPO ?? '';
const branch = process.env.APICIRCLE_LIVE_GH_BRANCH ?? 'main';
const enabled = Boolean(token && repo && repo.includes('/'));

describe.skipIf(!enabled)('live GitHub integration (read-only)', () => {
  const [owner, name] = repo.split('/', 2);
  const client = new GitHubClient();

  it('fetches a real .apicircle/registry.json + workspace-<id>/workspace.json and parses it into a probe', async () => {
    const result = await fetchRemoteWorkspaceJson(async (p) => {
      const f = await client.getContents(token, owner, name, p, branch);
      return f?.content ?? null;
    });
    expect('error' in result).toBe(false);
    if ('error' in result) return;
    const probe = parseLinkedWorkspaceJson(result.content);
    expect(probe.collections).toBeDefined();
    const ledger = ledgerFromProbe(probe);
    expect(Array.isArray(ledger.versions)).toBe(true);
  }, 30000);

  it('reads the repo metadata (default branch + visibility)', async () => {
    const meta = await client.getRepo(token, owner, name);
    expect(meta.fullName.toLowerCase()).toBe(repo.toLowerCase());
    expect(typeof meta.defaultBranch).toBe('string');
    expect(meta.defaultBranch.length).toBeGreaterThan(0);
  }, 30000);

  it('reads the repo topics (an array, possibly empty)', async () => {
    const topics = await client.listRepoTopics(token, owner, name);
    expect(Array.isArray(topics)).toBe(true);
  }, 30000);
});
