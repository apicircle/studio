// =============================================================================
// externalWriteRefresh integration test (gap #14).
//
// Verifies the workflow watcher pattern: an external write (CLI, MCP, git
// pull, or hand-edit) to .apicircle/workspace.json is observable via the
// provider on next read, and the in-extension state is stale until refreshed.
// The actual vscode.workspace.createFileSystemWatcher path is tested via E2E
// (e2e/vscode/1-watcher-after-git-pull.spec.ts) — this integration test
// verifies the provider layer.
// =============================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { GitWorkspaceProvider } from '../../src/host/gitWorkspaceProvider';

function seedEmpty(apicircleDir: string): void {
  fs.mkdirSync(apicircleDir, { recursive: true });
  fs.writeFileSync(
    path.join(apicircleDir, 'workspace.json'),
    JSON.stringify({
      schemaVersion: 1,
      workspaceId: 'ext-write',
      collections: { tree: { id: 'root', type: 'root', children: [] }, requests: {}, folders: {} },
      environments: { items: {}, activeName: null, priorityOrder: [] },
      linkedWorkspaces: {},
      linkedOverrides: { requests: {}, environmentVars: {} },
      releases: { self: null, perLink: {} },
      globalAssets: { schemas: {}, graphql: {}, files: {} },
      mockServers: {},
      executionPlans: {},
      secretKeys: {},
      secretCrypto: null,
      meta: { createdAt: '2026-01-01', updatedAt: '2026-01-01', appVersion: '0.1.0' },
    }),
  );
}

describe('externalWriteRefresh (provider sees external writes)', () => {
  let tmp: string;
  let apicircleDir: string;
  let localDir: string;
  let provider: GitWorkspaceProvider;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-write-'));
    apicircleDir = path.join(tmp, '.apicircle');
    localDir = path.join(tmp, 'local');
    fs.mkdirSync(localDir, { recursive: true });
    seedEmpty(apicircleDir);
    provider = new GitWorkspaceProvider({ syncedDir: apicircleDir, localDir });
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('external write to workspace.json is observable on next read()', async () => {
    const before = await provider.read();
    expect(Object.keys(before.synced.collections.requests)).toHaveLength(0);

    // Simulate a CLI / git pull / external edit writing a new request directly
    const json = JSON.parse(fs.readFileSync(path.join(apicircleDir, 'workspace.json'), 'utf8'));
    json.collections.requests['ext-1'] = {
      id: 'ext-1',
      name: 'External request',
      folderId: null,
      method: 'GET',
      url: 'https://x.com',
      headers: [],
      query: [],
      body: { type: 'none', content: '' },
      auth: { type: 'none' },
      contextVars: [],
      extractions: [],
      assertions: [],
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    };
    fs.writeFileSync(path.join(apicircleDir, 'workspace.json'), JSON.stringify(json));

    const after = await provider.read();
    expect(after.synced.collections.requests['ext-1']).toBeDefined();
    expect(after.synced.collections.requests['ext-1'].name).toBe('External request');
  });

  it('provider apply() after an external write merges with the latest disk state', async () => {
    // External write
    const json = JSON.parse(fs.readFileSync(path.join(apicircleDir, 'workspace.json'), 'utf8'));
    json.collections.requests['ext-1'] = {
      id: 'ext-1',
      name: 'External',
      folderId: null,
      method: 'GET',
      url: 'https://x.com',
      headers: [],
      query: [],
      body: { type: 'none', content: '' },
      auth: { type: 'none' },
      contextVars: [],
      extractions: [],
      assertions: [],
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    };
    fs.writeFileSync(path.join(apicircleDir, 'workspace.json'), JSON.stringify(json));

    // Provider apply (which re-reads under lock) should preserve the external write
    await provider.apply({
      kind: 'request.create',
      request: {
        id: 'ext-2',
        name: 'Internal',
        folderId: null,
        method: 'POST',
        url: 'https://y.com',
        headers: [],
        query: [],
        body: { type: 'none', content: '' },
        auth: { type: 'none' },
        contextVars: [],
        extractions: [],
        assertions: [],
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      },
    });

    const state = await provider.read();
    expect(state.synced.collections.requests['ext-1']).toBeDefined();
    expect(state.synced.collections.requests['ext-2']).toBeDefined();
  });
});
