import { z } from 'zod';
import {
  fetchRemoteWorkspaceJson,
  parseLinkedWorkspaceJson,
  buildLinkedSnapshot,
  ledgerFromProbe,
} from '@apicircle/core';
import { generateId, type LinkedWorkspace } from '@apicircle/shared';
import { GitHubClient, GitHubError } from '@apicircle/git';
import type { AnyToolDef } from './types';

// =============================================================================
// GitHub network tools — the headless counterpart to the VS Code / Desktop
// link + tag + topics surfaces. These reach the GitHub REST API via
// `@apicircle/git` (bundled into the published mcp-server, never a runtime dep)
// and need a token: the `token` arg, else the `GITHUB_TOKEN` env var. Pure
// parse + snapshot come from `@apicircle/core`; the resulting writes route
// through `applyMutation`.
// =============================================================================

function resolveToken(input: string | undefined): string {
  const t = (input ?? process.env.GITHUB_TOKEN ?? '').trim();
  return t;
}

const TOKEN_HELP = 'Pass `token`, or set the GITHUB_TOKEN env var on the MCP process.';

export const linkedLinkTool: AnyToolDef = {
  name: 'linked.link',
  description:
    'Link a workspace by fetching its `.apicircle/` workspace from GitHub (registry.json → workspace-<id>/workspace.json). Caches the release ledger + a collections/environments snapshot. Needs a token for private repos. ' +
    TOKEN_HELP,
  inputSchema: z.object({
    repoFullName: z.string().describe('owner/name of the source workspace repo.'),
    branch: z.string().default('main'),
    pinnedVersion: z
      .string()
      .nullable()
      .optional()
      .describe('null/omitted = source current version.'),
    kind: z.enum(['private', 'public']).default('private'),
    token: z.string().optional(),
  }),
  async handler(input, ctx) {
    const token = resolveToken(input.token);
    const repoFullName = input.repoFullName.trim();
    if (!repoFullName.includes('/')) return { ok: false, error: 'repoFullName must be owner/name' };
    if (input.kind === 'private' && !token)
      return { ok: false, error: `A token is required for private repos. ${TOKEN_HELP}` };
    const [owner, name] = repoFullName.split('/', 2);

    // Reject a duplicate before spending a network round-trip.
    const state = await ctx.workspace.read();
    const dup = Object.values(state.synced.linkedWorkspaces).find(
      (l) => l.source.repoFullName === repoFullName && l.source.branch === input.branch,
    );
    if (dup)
      return { ok: false, error: `Already linked to ${repoFullName}@${input.branch} (${dup.id})` };

    const client = new GitHubClient();
    let result: { workspaceId: string; content: string } | { error: string };
    try {
      result = await fetchRemoteWorkspaceJson(async (p) => {
        const f = await client.getContents(token, owner, name, p, input.branch);
        return f?.content ?? null;
      });
    } catch (e) {
      return {
        ok: false,
        error:
          e instanceof GitHubError ? e.message : e instanceof Error ? e.message : 'fetch failed',
      };
    }
    if ('error' in result)
      return { ok: false, error: `${repoFullName}@${input.branch}: ${result.error}` };

    const probe = parseLinkedWorkspaceJson(result.content);
    const ledger = ledgerFromProbe(probe);
    const link: LinkedWorkspace = {
      id: generateId(),
      kind: input.kind,
      name: repoFullName,
      sourceWorkspaceId: result.workspaceId,
      source: { provider: 'github', repoFullName, branch: input.branch, sessionMode: 'workspace' },
      scope: ['collections', 'environments'],
      pinnedVersion: input.pinnedVersion ?? ledger.currentVersion,
      updatePolicy: 'manual',
      linkedAt: new Date().toISOString(),
      requiredSecretKeyIds: probe.secretKeys ? Object.keys(probe.secretKeys) : [],
    };
    const snapshot = buildLinkedSnapshot(probe, link) ?? undefined;
    const out = await ctx.workspace.apply({
      kind: 'linkedWorkspace.upsert',
      link,
      ledger,
      ...(snapshot ? { snapshot } : {}),
    });
    return { ok: true, id: link.id, pinnedVersion: link.pinnedVersion, changedIds: out.changedIds };
  },
};

export const linkedRefreshTool: AnyToolDef = {
  name: 'linked.refresh',
  description:
    "Re-pull a linked workspace's cached release ledger (+ bootstrap snapshot if missing) from GitHub. " +
    TOKEN_HELP,
  inputSchema: z.object({ id: z.string(), token: z.string().optional() }),
  async handler(input, ctx) {
    const state = await ctx.workspace.read();
    const link = state.synced.linkedWorkspaces[input.id];
    if (!link) return { ok: false, error: `Linked workspace ${input.id} not found` };
    const token = resolveToken(input.token);
    if (link.kind === 'private' && !token)
      return { ok: false, error: `A token is required for private links. ${TOKEN_HELP}` };
    const [owner, name] = link.source.repoFullName.split('/', 2);
    const client = new GitHubClient();
    let result: { workspaceId: string; content: string } | { error: string };
    try {
      result = await fetchRemoteWorkspaceJson(async (p) => {
        const f = await client.getContents(token, owner, name, p, link.source.branch);
        return f?.content ?? null;
      });
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'fetch failed' };
    }
    if ('error' in result)
      return {
        ok: false,
        error: `${link.source.repoFullName}@${link.source.branch}: ${result.error}`,
      };
    const probe = parseLinkedWorkspaceJson(result.content);
    const ledger = ledgerFromProbe(probe);
    const needsSnapshot = !state.local.linkedCollections[input.id];
    const snapshot = needsSnapshot ? (buildLinkedSnapshot(probe, link) ?? undefined) : undefined;
    await ctx.workspace.apply({
      kind: 'linkedWorkspace.upsert',
      link,
      ledger,
      ...(snapshot ? { snapshot } : {}),
    });
    return {
      ok: true,
      currentVersion: ledger.currentVersion,
      versionCount: ledger.versions.length,
    };
  },
};

export const releaseTagTool: AnyToolDef = {
  name: 'release.tag',
  description:
    "Create a `v<version>` Git tag (optionally a GitHub Release) on the workspace's own repo. The version should already exist in the release ledger. " +
    TOKEN_HELP,
  inputSchema: z.object({
    owner: z.string(),
    name: z.string(),
    version: z.string(),
    createGitHubRelease: z.boolean().default(false),
    notes: z.string().optional(),
    overrideExisting: z.boolean().default(false),
    token: z.string().optional(),
  }),
  async handler(input, _ctx) {
    const token = resolveToken(input.token);
    if (!token) return { ok: false, error: `A token is required to tag. ${TOKEN_HELP}` };
    const client = new GitHubClient();
    const tagName = `v${input.version.replace(/^v/, '')}`;
    try {
      const repo = await client.getRepo(token, input.owner, input.name);
      const ref = await client.getRef(token, input.owner, input.name, repo.defaultBranch);
      const existing = await client.getTagSha(token, input.owner, input.name, tagName);
      if (existing !== null) {
        if (!input.overrideExisting) {
          return {
            ok: false,
            error: `Tag ${tagName} already exists at ${existing.slice(0, 7)}. Pass overrideExisting:true to replace.`,
          };
        }
        await client.deleteRef(token, input.owner, input.name, `tags/${tagName}`);
      }
      await client.createTag(token, input.owner, input.name, { tagName, sha: ref.sha });
      let releaseUrl: string | undefined;
      if (input.createGitHubRelease) {
        const release = await client.createRelease(token, input.owner, input.name, {
          tagName,
          releaseName: tagName,
          body: input.notes ?? '',
        });
        releaseUrl = release.htmlUrl;
      }
      return {
        ok: true,
        tagName,
        sha: ref.sha,
        branch: repo.defaultBranch,
        ...(releaseUrl ? { releaseUrl } : {}),
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'tag failed' };
    }
  },
};

export const marketplaceSearchTool: AnyToolDef = {
  name: 'marketplace.search',
  description:
    'Search the API Circle marketplace for public workspaces tagged with `apicircle` on GitHub. ' +
    'Returns up to 30 results sorted by relevance (default), stars, or recent updates. ' +
    'Token is optional — anonymous browsing is supported (lower rate limits); pass a token to lift them. ' +
    TOKEN_HELP,
  inputSchema: z.object({
    query: z
      .string()
      .default('')
      .describe('Search query — matches repo name, description, and topics. Empty = browse all.'),
    sort: z
      .enum(['best-match', 'stars', 'updated'])
      .default('best-match')
      .describe(
        'Sort order: best-match (default relevance), stars (most starred first), updated (recently pushed first).',
      ),
    token: z.string().optional(),
  }),
  async handler(input, _ctx) {
    const token = resolveToken(input.token) || null;
    const client = new GitHubClient();
    try {
      const repos = await client.searchMarketplaceRepos(token, input.query, {
        sort: input.sort === 'best-match' ? undefined : input.sort,
      });
      return { ok: true, count: repos.length, results: repos };
    } catch (e) {
      return {
        ok: false,
        error:
          e instanceof GitHubError ? e.message : e instanceof Error ? e.message : 'search failed',
      };
    }
  },
};

const TOPIC_RE = /^[a-z0-9][a-z0-9-]*$/;

export const repoSetTopicsTool: AnyToolDef = {
  name: 'repo.set_topics',
  description:
    "Replace a repo's topics (the `apicircle` topic is always kept — it drives marketplace discovery). Topics must be lowercase, start with a letter/digit, ≤50 chars, ≤20 total. " +
    TOKEN_HELP,
  inputSchema: z.object({
    owner: z.string(),
    name: z.string(),
    topics: z.array(z.string()),
    token: z.string().optional(),
  }),
  async handler(input, _ctx) {
    const token = resolveToken(input.token);
    if (!token) return { ok: false, error: `A token is required to set topics. ${TOKEN_HELP}` };
    const requested: string[] = input.topics;
    const normalized = Array.from(
      new Set(['apicircle', ...requested.map((t) => t.trim().toLowerCase()).filter(Boolean)]),
    );
    for (const t of normalized) {
      if (!TOPIC_RE.test(t))
        return {
          ok: false,
          error: `Invalid topic "${t}" — lowercase letters/digits/"-", starting with a letter or digit.`,
        };
      if (t.length > 50) return { ok: false, error: `Topic "${t}" exceeds 50 characters.` };
    }
    if (normalized.length > 20) return { ok: false, error: 'GitHub allows at most 20 topics.' };
    const client = new GitHubClient();
    try {
      const saved = await client.setRepoTopics(token, input.owner, input.name, normalized);
      return { ok: true, topics: saved };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'set topics failed' };
    }
  },
};
