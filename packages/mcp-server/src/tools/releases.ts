import { z } from 'zod';
import { buildReleaseEntry, sortVersionsDesc } from '@apicircle/core';
import type { AnyToolDef } from './types';

// =============================================================================
// Release-ledger tools. Definitions live in `synced.releases.self` (push to
// git) — the versions that linked consumers pin to. Every write routes through
// `ctx.workspace.apply` so the same `applyMutation` reducers the UI / CLI /
// VS Code use stay the single source of truth.
//
// `release.publish` is the only async-shaped one: the SHA-256
// `workspaceSnapshot` is computed by `buildReleaseEntry` against the current
// synced doc, then the resulting entry is handed to the (pure, sync)
// `release.publish` patch. Tagging the release on GitHub + managing
// marketplace topics are deliberately NOT here — those are network operations
// that belong to the desktop / VS Code Git surfaces.
// =============================================================================

export const releaseListTool: AnyToolDef = {
  name: 'release.list',
  description:
    "List this workspace's published releases (newest first) with their notes, snapshot fingerprint, and deprecated / withdrawn flags. Returns the current version too.",
  inputSchema: z.object({}),
  async handler(_input, ctx) {
    const state = await ctx.workspace.read();
    const ledger = state.synced.releases.self;
    if (!ledger) {
      return { currentVersion: null, count: 0, versions: [] };
    }
    const order = sortVersionsDesc(ledger.versions.map((v) => v.version));
    const byVersion = new Map(ledger.versions.map((v) => [v.version, v]));
    const versions = order
      .map((v) => byVersion.get(v))
      .filter((v): v is NonNullable<typeof v> => v !== undefined)
      .map((v) => ({
        version: v.version,
        publishedAt: v.publishedAt,
        notes: v.notes,
        workspaceSnapshot: v.workspaceSnapshot,
        deprecated: v.deprecated,
        yanked: v.yanked,
        ...(v.sha ? { sha: v.sha } : {}),
        ...(v.tagName ? { tagName: v.tagName } : {}),
      }));
    return { currentVersion: ledger.currentVersion, count: versions.length, versions };
  },
};

export const releasePublishTool: AnyToolDef = {
  name: 'release.publish',
  description:
    'Publish a new release of this workspace. Appends a semver version + markdown notes to the ledger and bumps currentVersion. The release is fingerprinted with a SHA-256 of the workspace at publish time. Rejects invalid semver or a duplicate version. Does NOT create a Git tag or GitHub Release.',
  inputSchema: z.object({
    version: z.string().min(1).describe('Semantic version, e.g. "1.2.0".'),
    notes: z.string().default('').describe('Markdown release notes.'),
    sha: z.string().optional().describe('Optional source commit SHA for bookkeeping.'),
    tagName: z.string().optional().describe('Optional git tag name for bookkeeping.'),
  }),
  async handler(input, ctx) {
    const state = await ctx.workspace.read();
    let entry;
    try {
      entry = await buildReleaseEntry(state.synced, {
        version: input.version,
        notes: input.notes,
        sha: input.sha,
        tagName: input.tagName,
      });
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'release.publish failed' };
    }
    try {
      const out = await ctx.workspace.apply({ kind: 'release.publish', entry });
      const after = (await ctx.workspace.read()).synced.releases.self;
      return {
        ok: true,
        version: entry.version,
        currentVersion: after?.currentVersion ?? entry.version,
        workspaceSnapshot: entry.workspaceSnapshot,
        changedIds: out.changedIds,
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'release.publish failed' };
    }
  },
};

export const releaseDeprecateTool: AnyToolDef = {
  name: 'release.deprecate',
  description:
    'Mark a published version as deprecated (soft signal). Consumers see a warning but the version stays installable. Errors if the version is unknown or no ledger exists.',
  inputSchema: z.object({ version: z.string().min(1) }),
  async handler(input, ctx) {
    try {
      const out = await ctx.workspace.apply({ kind: 'release.deprecate', version: input.version });
      return { ok: true, version: input.version, changedIds: out.changedIds };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'release.deprecate failed' };
    }
  },
};

export const releaseYankTool: AnyToolDef = {
  name: 'release.yank',
  description:
    'Withdraw (yank) a published version (hard signal). Consumers are warned the version is broken / unsafe and told to move to a different one. The entry stays in the ledger. Errors if the version is unknown or no ledger exists.',
  inputSchema: z.object({ version: z.string().min(1) }),
  async handler(input, ctx) {
    try {
      const out = await ctx.workspace.apply({ kind: 'release.yank', version: input.version });
      return { ok: true, version: input.version, changedIds: out.changedIds };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'release.yank failed' };
    }
  },
};
