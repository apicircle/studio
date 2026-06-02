import { describe, expect, it } from 'vitest';
import { APICIRCLE_FOLDER_EXPORT_FORMAT, type ApicircleFolderExportV1 } from '@apicircle/core';
import type { Folder, WorkspaceLocal, WorkspaceSynced } from '@apicircle/shared';
import { InMemoryWorkspaceProvider } from '../providers/InMemoryWorkspaceProvider';
import { SingleWorkspaceAdapter } from '../providers/Workspaces';
import { InProcessMockController } from '../providers/InProcessMockController';
import { folderExportJsonTool, folderImportJsonTool } from './folderExchange';

const T0 = '2026-04-27T00:00:00.000Z';

function freshState(overrides?: {
  folders?: Record<string, Folder>;
  requests?: WorkspaceSynced['collections']['requests'];
  globalAssets?: WorkspaceSynced['globalAssets'];
}): { synced: WorkspaceSynced; local: WorkspaceLocal } {
  return {
    synced: {
      schemaVersion: 1,
      workspaceId: 'ws-1',
      collections: {
        tree: {
          id: 'r',
          type: 'root',
          children: Object.keys(overrides?.folders ?? {})
            .filter((id) => (overrides?.folders?.[id]?.parentId ?? null) === null)
            .map((id) => ({ kind: 'folder' as const, id })),
        },
        requests: overrides?.requests ?? {},
        folders: overrides?.folders ?? {},
      },
      environments: { items: {}, activeName: null, priorityOrder: [] },
      linkedWorkspaces: {},
      linkedOverrides: { requests: {}, environmentVars: {} },
      releases: { self: null, perLink: {} },
      globalAssets: overrides?.globalAssets ?? { schemas: {}, graphql: {}, files: {} },
      mockServers: {},
      meta: { createdAt: T0, updatedAt: T0, appVersion: '0.1.0' },
    },
    local: {
      schemaVersion: 1,
      workspaceId: 'ws-1',
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
      globalContext: {},
      mockRuntime: { active: {} },
      ui: {
        activeRequestId: null,
        sidebarExpandedSections: [],
        themeId: 'studio-dark',
        fontId: 'system-mono',
        fontSizePercent: 100,
      },
      settings: { validateOnSend: true, monacoConsumesWheel: false },
      snapshots: { entries: [], maxBytes: 50 * 1024 * 1024 },
    },
  };
}

function makeCtx(state = freshState()) {
  const workspace = new InMemoryWorkspaceProvider(state);
  return {
    workspace,
    workspaces: new SingleWorkspaceAdapter(workspace, 'ws-test'),
    mock: new InProcessMockController(),
  };
}

describe('folderExportJsonTool', () => {
  it('returns an envelope + json + filename + report for a known folder', async () => {
    const ctx = makeCtx(
      freshState({
        folders: { 'f-root': { id: 'f-root', name: 'Auth', parentId: null } },
      }),
    );
    const result = (await folderExportJsonTool.handler({ folderId: 'f-root' }, ctx)) as {
      envelope: ApicircleFolderExportV1;
      json: string;
      filename: string;
      report: { folderName: string };
    };
    expect(result.envelope.format).toBe(APICIRCLE_FOLDER_EXPORT_FORMAT);
    expect(result.envelope.folder.name).toBe('Auth');
    expect(result.json).toContain('"format": "apicircle.folder/v1"');
    expect(result.filename).toBe('auth.apicircle.json');
    expect(result.report.folderName).toBe('Auth');
  });

  it('redacts auth credentials by default', async () => {
    const ctx = makeCtx(
      freshState({
        folders: { 'f-root': { id: 'f-root', name: 'Auth', parentId: null } },
        requests: {
          'r-1': {
            id: 'r-1',
            name: 'POST /login',
            folderId: 'f-root',
            method: 'POST',
            url: 'https://api.example.com/login',
            headers: [],
            query: [],
            body: { type: 'none', content: '' },
            auth: { type: 'bearer', token: 'live-token' },
            contextVars: [],
            extractions: [],
            assertions: [],
            createdAt: T0,
            updatedAt: T0,
          },
        },
      }),
    );
    const result = (await folderExportJsonTool.handler({ folderId: 'f-root' }, ctx)) as {
      json: string;
    };
    expect(result.json).not.toContain('live-token');
    expect(result.json).toContain('"token": ""');
  });

  it('keeps a credential when its id is in includeCredentialIds', async () => {
    const ctx = makeCtx(
      freshState({
        folders: { 'f-root': { id: 'f-root', name: 'Auth', parentId: null } },
        requests: {
          'r-1': {
            id: 'r-1',
            name: 'POST /login',
            folderId: 'f-root',
            method: 'POST',
            url: 'https://api.example.com/login',
            headers: [],
            query: [],
            body: { type: 'none', content: '' },
            auth: { type: 'bearer', token: 'live-token' },
            contextVars: [],
            extractions: [],
            assertions: [],
            createdAt: T0,
            updatedAt: T0,
          },
        },
      }),
    );
    const result = (await folderExportJsonTool.handler(
      {
        folderId: 'f-root',
        includeCredentialIds: ['request:r-1.bearer.token'],
      },
      ctx,
    )) as { json: string };
    expect(result.json).toContain('live-token');
  });

  it('returns folder_not_found when the id does not exist', async () => {
    const ctx = makeCtx();
    const result = (await folderExportJsonTool.handler({ folderId: 'ghost' }, ctx)) as {
      error: string;
    };
    expect(result.error).toBe('folder_not_found');
  });
});

describe('folderImportJsonTool', () => {
  function envelopeWithOneRequest(): ApicircleFolderExportV1 {
    return {
      format: APICIRCLE_FOLDER_EXPORT_FORMAT,
      exportedAt: T0,
      appVersion: '1',
      source: { workspaceId: 'ws', folderId: 'f-root', folderName: 'Imported' },
      folder: {
        name: 'Imported',
        subfolders: [],
        requests: [
          {
            id: 'r-1',
            name: 'POST /login',
            folderId: 'f-root',
            method: 'POST',
            url: 'https://api.example.com/login',
            headers: [],
            query: [],
            body: { type: 'none', content: '' },
            auth: { type: 'none' },
            contextVars: [],
            extractions: [],
            assertions: [],
            createdAt: T0,
            updatedAt: T0,
          },
        ],
      },
      dependencies: { schemas: [], graphql: [], files: [] },
    };
  }

  it('imports an envelope passed as JSON', async () => {
    const ctx = makeCtx();
    const env = envelopeWithOneRequest();
    const result = (await folderImportJsonTool.handler({ json: JSON.stringify(env) }, ctx)) as {
      rootFolderName: string;
      counts: { folders: number; requests: number };
    };
    expect(result.rootFolderName).toBe('Imported');
    expect(result.counts).toEqual({ folders: 1, requests: 1 });
    const state = await ctx.workspace.read();
    const folder = Object.values(state.synced.collections.folders).find(
      (f) => f.name === 'Imported',
    );
    expect(folder).toBeDefined();
  });

  it('imports an envelope passed as an object', async () => {
    const ctx = makeCtx();
    const env = envelopeWithOneRequest();
    const result = (await folderImportJsonTool.handler(
      { envelope: env as unknown as Record<string, unknown> },
      ctx,
    )) as { rootFolderName: string };
    expect(result.rootFolderName).toBe('Imported');
  });

  it('routes to invalid_input when neither json nor envelope is supplied', async () => {
    const ctx = makeCtx();
    const result = (await folderImportJsonTool.handler({}, ctx)) as { error: string };
    expect(result.error).toBe('invalid_input');
  });

  it('routes to invalid_envelope when the JSON is malformed', async () => {
    const ctx = makeCtx();
    const result = (await folderImportJsonTool.handler({ json: '{not-json' }, ctx)) as {
      error: string;
    };
    expect(result.error).toBe('invalid_envelope');
  });

  it('routes to invalid_envelope when the envelope is the wrong shape', async () => {
    const ctx = makeCtx();
    const result = (await folderImportJsonTool.handler({ envelope: { foo: 'bar' } }, ctx)) as {
      error: string;
    };
    expect(result.error).toBe('invalid_envelope');
  });

  it('reports filesRequiringReattachment from the parsed envelope', async () => {
    const env = envelopeWithOneRequest();
    env.dependencies.files = [
      {
        id: 'file-1',
        name: 'avatar',
        slotId: 'slot-x',
        filename: 'avatar.png',
        size: 1,
        mimeType: 'image/png',
        createdAt: T0,
        updatedAt: T0,
      },
    ];
    const ctx = makeCtx();
    const result = (await folderImportJsonTool.handler({ json: JSON.stringify(env) }, ctx)) as {
      filesRequiringReattachment: string[];
    };
    expect(result.filesRequiringReattachment).toHaveLength(1);
  });
});
