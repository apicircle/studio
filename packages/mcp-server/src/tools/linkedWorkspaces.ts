import { z } from 'zod';
import type { LinkedWorkspace } from '@apicircle/shared';
import type { AnyToolDef } from './types';

// =============================================================================
// Linked-workspace tools — the PURE-DATA half of the link feature
// (`synced.linkedWorkspaces`). Listing, reading, config edits (pin version,
// scope, session mode, required keys, marketplace metadata, rename), and
// unlinking all route through `applyMutation`.
//
// Linking a NEW workspace and refreshing the cached ledger / snapshot are
// network operations (fetch the source repo's `.apicircle/workspace.json` over
// the GitHub API) — those are host-driven (the VS Code commands + desktop UI),
// not MCP tools, because the MCP server is headless and has no GitHub session.
// =============================================================================

function summarize(link: LinkedWorkspace, currentVersion: string | null) {
  return {
    id: link.id,
    name: link.name,
    kind: link.kind,
    description: link.description,
    source: link.source,
    scope: link.scope,
    pinnedVersion: link.pinnedVersion,
    requiredSecretKeyIds: link.requiredSecretKeyIds,
    marketplace: link.marketplace,
    cachedCurrentVersion: currentVersion,
  };
}

export const linkedListTool: AnyToolDef = {
  name: 'linked.list',
  description:
    'List the workspaces this workspace links to (consumes). Each entry includes its source repo/branch, scope, pinned version, required secret-key ids, and the current version of its cached release ledger.',
  inputSchema: z.object({}),
  async handler(_input, ctx) {
    const state = await ctx.workspace.read();
    const links = Object.values(state.synced.linkedWorkspaces);
    return {
      count: links.length,
      links: links.map((l) =>
        summarize(l, state.synced.releases.perLink[l.id]?.currentVersion ?? null),
      ),
    };
  },
};

export const linkedGetTool: AnyToolDef = {
  name: 'linked.get',
  description:
    'Read one linked workspace by id, including its cached release ledger (the versions available to pin to).',
  inputSchema: z.object({ id: z.string() }),
  async handler(input, ctx) {
    const state = await ctx.workspace.read();
    const link = state.synced.linkedWorkspaces[input.id];
    if (!link) return { ok: false, error: `Linked workspace ${input.id} not found` };
    const ledger = state.synced.releases.perLink[input.id] ?? null;
    return {
      ok: true,
      link: summarize(link, ledger?.currentVersion ?? null),
      ledger,
    };
  },
};

export const linkedSetConfigTool: AnyToolDef = {
  name: 'linked.set_config',
  description:
    "Update an existing linked workspace's config: rename, pin/unpin a version (must exist in the cached ledger), set scope, session mode, required secret-key ids, or marketplace metadata. Only supplied fields change. Does NOT fetch from the network.",
  inputSchema: z.object({
    id: z.string(),
    name: z.string().optional(),
    description: z.string().optional(),
    pinnedVersion: z.string().nullable().optional().describe('null = unpin (track source HEAD).'),
    scope: z.array(z.enum(['collections', 'environments'])).optional(),
    sessionMode: z.enum(['workspace', 'dedicated']).optional(),
    requiredSecretKeyIds: z.array(z.string()).optional(),
    marketplace: z
      .object({
        listedAs: z.string(),
        tags: z.array(z.string()),
        summary: z.string(),
      })
      .nullable()
      .optional()
      .describe('null = clear marketplace metadata.'),
  }),
  async handler(input, ctx) {
    const state = await ctx.workspace.read();
    const link = state.synced.linkedWorkspaces[input.id];
    if (!link) return { ok: false, error: `Linked workspace ${input.id} not found` };

    if (input.pinnedVersion !== undefined && input.pinnedVersion !== null) {
      const cached = state.synced.releases.perLink[input.id]?.versions ?? [];
      if (!cached.some((v) => v.version === input.pinnedVersion)) {
        return {
          ok: false,
          error: `Version ${input.pinnedVersion} is not in the cached ledger — refresh the link first`,
        };
      }
    }

    const next: LinkedWorkspace = {
      ...link,
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.pinnedVersion !== undefined ? { pinnedVersion: input.pinnedVersion } : {}),
      ...(input.scope !== undefined ? { scope: input.scope } : {}),
      ...(input.requiredSecretKeyIds !== undefined
        ? { requiredSecretKeyIds: input.requiredSecretKeyIds }
        : {}),
      ...(input.sessionMode !== undefined
        ? { source: { ...link.source, sessionMode: input.sessionMode } }
        : {}),
    };
    if (input.marketplace !== undefined) {
      if (input.marketplace === null) {
        delete next.marketplace;
      } else {
        next.marketplace = input.marketplace;
      }
    }

    const out = await ctx.workspace.apply({ kind: 'linkedWorkspace.upsert', link: next });
    return {
      ok: true,
      changedIds: out.changedIds,
      link: summarize(next, state.synced.releases.perLink[input.id]?.currentVersion ?? null),
    };
  },
};

export const linkedUnlinkTool: AnyToolDef = {
  name: 'linked.unlink',
  description:
    'Unlink a workspace by id. Removes the link, its cached release ledger, every local override for it, the cached collections/environments snapshot, and any per-link session entry. The source repo is untouched.',
  inputSchema: z.object({ id: z.string() }),
  async handler(input, ctx) {
    const state = await ctx.workspace.read();
    if (!state.synced.linkedWorkspaces[input.id]) {
      return { ok: false, error: `Linked workspace ${input.id} not found` };
    }
    const out = await ctx.workspace.apply({ kind: 'linkedWorkspace.remove', id: input.id });
    return { ok: true, changedIds: out.changedIds };
  },
};
