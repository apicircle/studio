import { z } from 'zod';
import type { AnyToolDef } from './types';

// =============================================================================
// workspace.list — surfaces every workspace the server can drive, with cheap
// per-workspace counts so AI clients can disambiguate without follow-up
// reads. Used by prompts like "list every workspace I have" or as a
// disambiguation step before drilling into a specific one.
// =============================================================================

export const workspaceListTool: AnyToolDef = {
  name: 'workspace.list',
  description:
    'List every workspace registered with this server, including which one is currently active. ' +
    'Returns id, display name, last-opened timestamp, and a per-workspace summary (request count, ' +
    'environment count, mock-server count, plan count). Use this BEFORE drilling into a specific ' +
    'workspace via other tools — pass the resulting `id` as `workspaceId` to `workspace.read` ' +
    'or related reads when you want to scope to a non-active workspace.',
  inputSchema: z.object({}),
  async handler(_input, ctx) {
    const summaries = await ctx.workspaces.list();
    return {
      activeWorkspaceId: ctx.workspaces.activeId(),
      workspaceCount: summaries.length,
      workspaces: summaries,
      // Plain-text hint the AI surfaces when telling the user. Cheap to
      // generate here and saves round-trips on disambiguation prompts.
      hint:
        summaries.length === 0
          ? 'No workspaces are registered yet. The user should open the desktop app once or run `apicircle workspaces create <name>` from the terminal.'
          : summaries.length === 1
            ? `Only one workspace ("${summaries[0].name}") is registered — most tools will default to it without a workspaceId.`
            : `Multiple workspaces are registered. Pass the desired \`id\` as \`workspaceId\` to other tools to scope reads/writes to that workspace; the active one ("${
                summaries.find((w) => w.isActive)?.name ?? '(none)'
              }") is used by default.`,
    };
  },
};
