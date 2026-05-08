import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import { loadFromFile, saveToFile } from '@apicircle/core/workspace/file-backed';
import type { WorkspaceState } from '@apicircle/core';
import { generateId } from '@apicircle/shared';

// =============================================================================
// loadWorkspace — small wrapper around `@apicircle/core`'s file-backed
// helpers that auto-creates an empty workspace on first run so users don't
// have to seed a workspace.synced.json by hand before invoking commands.
// =============================================================================

export async function ensureWorkspace(dir: string): Promise<WorkspaceState> {
  const resolved = path.resolve(dir);
  await fs.mkdir(resolved, { recursive: true });
  const existing = await loadFromFile(resolved, { allowMissing: true });
  if (existing) return existing;

  const now = new Date().toISOString();
  const workspaceId = generateId();
  const fresh: WorkspaceState = {
    synced: {
      schemaVersion: 1,
      workspaceId,
      workspaceName: 'Untitled workspace',
      collections: {
        tree: { id: generateId(), type: 'root', children: [] },
        requests: {},
        folders: {},
      },
      environments: { items: {}, activeName: null, priorityOrder: [] },
      linkedWorkspaces: {},
      linkedOverrides: { requests: {}, environmentVars: {} },
      releases: { self: null, perLink: {} },
      globalAssets: { schemas: {}, graphql: {} },
      mockServers: {},
      meta: { createdAt: now, updatedAt: now, appVersion: '0.1.0' },
    },
    local: {
      schemaVersion: 1,
      workspaceId,
      executionPlans: {},
      history: { requestRuns: [], planRuns: [] },
      secretIndex: { entries: {} },
      sessions: { github: null },
      connectedRepo: null,
      workingBranch: null,
      sync: { lastPulledSnapshot: null, lastPulledSha: null, lastPulledAt: null, dirtyKeys: [] },
      linkedCollections: {},
      globalContext: {},
      mockRuntime: { active: {} },
      ui: { activeRequestId: null, sidebarExpandedSections: [], themeId: 'studio-dark' },
    },
  };
  await saveToFile(resolved, fresh);
  return fresh;
}
