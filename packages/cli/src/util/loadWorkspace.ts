import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import { loadFromFile, saveToFile } from '@apicircle/core/workspace/file-backed';
import type { WorkspaceState } from '@apicircle/core';
import { FONT_SIZE_PERCENT_DEFAULT, generateId } from '@apicircle/shared';

// =============================================================================
// loadWorkspace — small wrapper around `@apicircle/core`'s file-backed
// helpers that auto-creates an empty workspace on first run so users don't
// have to seed a workspace.json by hand before invoking commands.
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
      collections: {
        tree: { id: generateId(), type: 'root', children: [] },
        requests: {},
        folders: {},
      },
      environments: { items: {}, activeName: null, priorityOrder: [] },
      linkedWorkspaces: {},
      linkedOverrides: { requests: {}, environmentVars: {} },
      releases: { self: null, perLink: {} },
      globalAssets: { schemas: {}, graphql: {}, files: {} },
      mockServers: {},
      meta: { createdAt: now, updatedAt: now, appVersion: '1.0.0' },
    },
    local: {
      schemaVersion: 1,
      workspaceId,
      executionPlans: {},
      history: { requestRuns: [], planRuns: [] },
      secretIndex: { entries: {} },
      sessions: { github: { workspace: null, links: {} } },
      connectedRepo: null,
      workingBranch: null,
      seededWorkspaceSha: null,
      retiredBranch: null,
      sync: { lastPulledSnapshot: null, lastPulledSha: null, lastPulledAt: null, dirtyKeys: [] },
      linkedCollections: {},
      attachmentCache: {},
      globalContext: {},
      mockRuntime: { active: {} },
      ui: {
        activeRequestId: null,
        sidebarExpandedSections: [],
        themeId: 'one-dark-pro',
        fontId: 'system-sans',
        fontSizePercent: FONT_SIZE_PERCENT_DEFAULT,
      },
      settings: { validateOnSend: true, monacoConsumesWheel: false },
      snapshots: { entries: [], maxBytes: 50 * 1024 * 1024 },
    },
  };
  await saveToFile(resolved, fresh);
  return fresh;
}
