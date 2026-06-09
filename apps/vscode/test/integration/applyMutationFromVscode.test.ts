// =============================================================================
// applyMutationFromVscode integration test.
//
// Verifies that the `GitWorkspaceProvider` correctly serializes concurrent
// writes via `proper-lockfile`. Two independent providers pointing at the
// same `.apicircle/workspace.json` apply different patches simultaneously —
// the lock must guarantee:
//
//   1. Both writes succeed (no rejected promises)
//   2. The final disk state contains BOTH patches (no lost update)
//   3. The on-disk JSON is well-formed (no torn write)
//
// This catches regressions in:
//   • The advisory-lock acquisition in GitWorkspaceProvider.apply
//   • The atomic writeJsonAtomic helper (tmp file + rename pattern)
//   • The read-modify-write cycle being properly bracketed by the lock
//
// Without this test, a concurrent-write regression — e.g. CLI + extension
// editing the same workspace, or a watcher refresh firing mid-write —
// would silently corrupt user data in production.
// =============================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { generateId } from '@apicircle/shared';
import type { Request as ApiRequest } from '@apicircle/shared';
import { GitWorkspaceProvider } from '../../src/host/gitWorkspaceProvider';

function emptySynced(workspaceId: string) {
  return {
    schemaVersion: 1,
    workspaceId,
    collections: {
      tree: { id: 'root', type: 'root', children: [] },
      requests: {},
      folders: {},
    },
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
  };
}

function emptyLocal(workspaceId: string) {
  return {
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
      fontId: 'system-mono',
      fontSizePercent: 100,
    },
    settings: { validateOnSend: true, monacoConsumesWheel: false },
    snapshots: { entries: [], maxBytes: 50 * 1024 * 1024 },
  };
}

function fakeRequest(id: string, name: string): ApiRequest {
  return {
    id,
    name,
    folderId: null,
    method: 'GET',
    url: 'https://api.example.com/x',
    headers: [],
    query: [],
    body: { type: 'none', content: '' },
    auth: { type: 'none' },
    contextVars: [],
    extractions: [],
    assertions: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('applyMutationFromVscode (concurrent write serialization)', () => {
  let tmp: string;
  let syncedDir: string;
  let localDirA: string;
  let localDirB: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'concurrent-mutation-'));
    syncedDir = path.join(tmp, 'repo', '.apicircle');
    localDirA = path.join(tmp, 'localA');
    localDirB = path.join(tmp, 'localB');
    fs.mkdirSync(syncedDir, { recursive: true });
    fs.mkdirSync(localDirA, { recursive: true });
    fs.mkdirSync(localDirB, { recursive: true });
    fs.writeFileSync(
      path.join(syncedDir, 'workspace.json'),
      JSON.stringify(emptySynced('concurrent-test')),
    );
    fs.writeFileSync(
      path.join(localDirA, 'workspace.local.json'),
      JSON.stringify(emptyLocal('concurrent-test')),
    );
    fs.writeFileSync(
      path.join(localDirB, 'workspace.local.json'),
      JSON.stringify(emptyLocal('concurrent-test')),
    );
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('two concurrent request.create patches both land — no lost update', async () => {
    const providerA = new GitWorkspaceProvider({ syncedDir, localDir: localDirA });
    const providerB = new GitWorkspaceProvider({ syncedDir, localDir: localDirB });

    const idA = generateId();
    const idB = generateId();

    // Kick off both writes at once
    const [resultA, resultB] = await Promise.all([
      providerA.apply({ kind: 'request.create', request: fakeRequest(idA, 'From A') }),
      providerB.apply({ kind: 'request.create', request: fakeRequest(idB, 'From B') }),
    ]);

    expect(resultA.changedIds).toContain(idA);
    expect(resultB.changedIds).toContain(idB);

    // Re-read disk — both requests should be present
    const finalRaw = fs.readFileSync(path.join(syncedDir, 'workspace.json'), 'utf-8');
    const final = JSON.parse(finalRaw) as { collections: { requests: Record<string, unknown> } };
    expect(final.collections.requests[idA]).toBeDefined();
    expect(final.collections.requests[idB]).toBeDefined();
  });

  it('10 concurrent writes from a single provider all land', async () => {
    const provider = new GitWorkspaceProvider({ syncedDir, localDir: localDirA });
    const ids = Array.from({ length: 10 }, () => generateId());

    await Promise.all(
      ids.map((id, i) =>
        provider.apply({ kind: 'request.create', request: fakeRequest(id, `R${i}`) }),
      ),
    );

    const final = JSON.parse(fs.readFileSync(path.join(syncedDir, 'workspace.json'), 'utf-8')) as {
      collections: { requests: Record<string, unknown> };
    };
    for (const id of ids) {
      expect(final.collections.requests[id]).toBeDefined();
    }
    expect(Object.keys(final.collections.requests)).toHaveLength(10);
  });

  it('concurrent updates to the same request preserve last-write semantics', async () => {
    const providerA = new GitWorkspaceProvider({ syncedDir, localDir: localDirA });
    const providerB = new GitWorkspaceProvider({ syncedDir, localDir: localDirB });

    const reqId = generateId();
    await providerA.apply({ kind: 'request.create', request: fakeRequest(reqId, 'Original') });

    // Race two updates with different names
    await Promise.all([
      providerA.apply({ kind: 'request.update', id: reqId, patch: { name: 'Updated by A' } }),
      providerB.apply({ kind: 'request.update', id: reqId, patch: { name: 'Updated by B' } }),
    ]);

    // The lock guarantees serialization — one of the two names persists,
    // and the file is well-formed JSON either way.
    const final = JSON.parse(fs.readFileSync(path.join(syncedDir, 'workspace.json'), 'utf-8')) as {
      collections: { requests: Record<string, { name: string }> };
    };
    const winner = final.collections.requests[reqId].name;
    expect(['Updated by A', 'Updated by B']).toContain(winner);
  });

  it('on-disk JSON is always well-formed under contention', async () => {
    // Realistic load: 4 providers × 2 writes each = 8 concurrent writes.
    // The test verifies the file stays well-formed; a higher-contention
    // version would just stress the retry budget without adding signal.
    const providers = Array.from(
      { length: 4 },
      (_, i) =>
        new GitWorkspaceProvider({
          syncedDir,
          localDir: path.join(tmp, `local${i}`),
        }),
    );
    for (let i = 0; i < providers.length; i++) {
      fs.mkdirSync(path.join(tmp, `local${i}`), { recursive: true });
      fs.writeFileSync(
        path.join(tmp, `local${i}`, 'workspace.local.json'),
        JSON.stringify(emptyLocal('concurrent-test')),
      );
    }

    const promises: Array<Promise<unknown>> = [];
    for (const provider of providers) {
      for (let j = 0; j < 2; j++) {
        promises.push(
          provider.apply({
            kind: 'request.create',
            request: fakeRequest(generateId(), `Provider write ${j}`),
          }),
        );
      }
    }
    await Promise.all(promises);

    const raw = fs.readFileSync(path.join(syncedDir, 'workspace.json'), 'utf-8');
    expect(() => JSON.parse(raw)).not.toThrow();
    const final = JSON.parse(raw) as { collections: { requests: Record<string, unknown> } };
    expect(Object.keys(final.collections.requests)).toHaveLength(8);
  }, 30_000);
});
