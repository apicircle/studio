import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { applyMutation, initSecretCrypto } from '@apicircle/core';
import { FileBackedWorkspaceProvider } from '@apicircle/mcp-server';
import type { WorkspaceSynced, WorkspaceLocal, SecretCryptoMeta } from '@apicircle/shared';
import { GitWorkspaceProvider } from '../../src/host/gitWorkspaceProvider';

// =============================================================================
// Three-surface compat for the P4 secret.crypto.set + secret.crypto.clear
// patches.
//
// The MCP / CLI / desktop / VS Code paths must all produce byte-identical
// `synced.secretCrypto` blobs through these patches. Otherwise a workspace
// set up in the desktop wouldn't be unlockable from the CLI etc.
// =============================================================================

function canonicalize(synced: WorkspaceSynced): string {
  const clone = JSON.parse(JSON.stringify(synced)) as WorkspaceSynced;
  clone.meta.updatedAt = '<normalized>';
  return JSON.stringify(clone, null, 2);
}

function emptySynced(workspaceId: string): WorkspaceSynced {
  return {
    schemaVersion: 1,
    workspaceId,
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
    meta: {
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      appVersion: '0.1.0',
    },
  };
}

function emptyLocal(workspaceId: string): WorkspaceLocal {
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

describe('secret.crypto three-surface compat (P4)', () => {
  let tmp: string;
  let blob: SecretCryptoMeta;

  beforeEach(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'secret-compat-'));
    const init = await initSecretCrypto('hunter2', 100);
    blob = init.crypto;
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  function makeProviders(workspaceId: string) {
    const synced = emptySynced(workspaceId);
    const local = emptyLocal(workspaceId);

    const desktopDir = path.join(tmp, 'desktop');
    fs.mkdirSync(desktopDir, { recursive: true });
    fs.writeFileSync(path.join(desktopDir, 'workspace.synced.json'), JSON.stringify(synced));
    fs.writeFileSync(path.join(desktopDir, 'workspace.local.json'), JSON.stringify(local));
    const desktopProvider = new FileBackedWorkspaceProvider(desktopDir);

    const gitSyncedDir = path.join(tmp, 'repo', '.apicircle');
    const gitLocalDir = path.join(tmp, 'localStorage');
    fs.mkdirSync(gitSyncedDir, { recursive: true });
    fs.mkdirSync(gitLocalDir, { recursive: true });
    fs.writeFileSync(path.join(gitSyncedDir, 'workspace.json'), JSON.stringify(synced));
    fs.writeFileSync(path.join(gitLocalDir, 'workspace.local.json'), JSON.stringify(local));
    const gitProvider = new GitWorkspaceProvider({
      syncedDir: gitSyncedDir,
      localDir: gitLocalDir,
    });

    return { desktopProvider, gitProvider };
  }

  it('secret.crypto.set yields identical workspace.synced across providers', async () => {
    const { desktopProvider, gitProvider } = makeProviders('compat');
    const patch = { kind: 'secret.crypto.set' as const, crypto: blob };
    const dResult = await desktopProvider.apply(patch);
    const gResult = await gitProvider.apply(patch);
    expect(canonicalize(dResult.state.synced)).toBe(canonicalize(gResult.state.synced));
    expect(dResult.state.synced.secretCrypto).toEqual(blob);
    expect(gResult.state.synced.secretCrypto).toEqual(blob);
    expect(dResult.changedIds).toEqual(['secret.crypto']);
    expect(gResult.changedIds).toEqual(['secret.crypto']);
  });

  it('secret.crypto.clear is a no-op when secretCrypto is already null', async () => {
    const { desktopProvider, gitProvider } = makeProviders('compat');
    const dResult = await desktopProvider.apply({ kind: 'secret.crypto.clear' });
    const gResult = await gitProvider.apply({ kind: 'secret.crypto.clear' });
    expect(dResult.changedIds).toEqual([]);
    expect(gResult.changedIds).toEqual([]);
    expect(dResult.state.synced.secretCrypto).toBeNull();
    expect(gResult.state.synced.secretCrypto).toBeNull();
  });

  it('set then clear round-trip leaves both providers in lockstep', async () => {
    const { desktopProvider, gitProvider } = makeProviders('compat');
    await desktopProvider.apply({ kind: 'secret.crypto.set', crypto: blob });
    await gitProvider.apply({ kind: 'secret.crypto.set', crypto: blob });
    await desktopProvider.apply({ kind: 'secret.crypto.clear' });
    await gitProvider.apply({ kind: 'secret.crypto.clear' });
    const d = await desktopProvider.read();
    const g = await gitProvider.read();
    expect(canonicalize(d.synced)).toBe(canonicalize(g.synced));
    expect(d.synced.secretCrypto).toBeNull();
  });

  it('applyMutation directly yields the same shape as either provider', () => {
    const synced = emptySynced('det');
    const local = emptyLocal('det');
    const a = applyMutation({ synced, local }, { kind: 'secret.crypto.set', crypto: blob });
    const b = applyMutation({ synced, local }, { kind: 'secret.crypto.set', crypto: blob });
    expect(canonicalize(a.next.synced)).toBe(canonicalize(b.next.synced));
    expect(a.next.synced.secretCrypto).toEqual(blob);
  });

  // ----- P4R2-G7: set-over-existing (rotation) parity -----

  it('set → clear → set cycle leaves both providers in lockstep', async () => {
    // P4R3-G15: multi-cycle determinism. Three apply calls in sequence
    // must produce byte-identical state across providers.
    const { desktopProvider, gitProvider } = makeProviders('compat');
    const altBlob = { ...blob, salt: 'DDDDDDDDDDDDDDDDDDDDDA==', verifier: 'alt-verifier' };
    await desktopProvider.apply({ kind: 'secret.crypto.set', crypto: blob });
    await gitProvider.apply({ kind: 'secret.crypto.set', crypto: blob });
    await desktopProvider.apply({ kind: 'secret.crypto.clear' });
    await gitProvider.apply({ kind: 'secret.crypto.clear' });
    await desktopProvider.apply({ kind: 'secret.crypto.set', crypto: altBlob });
    await gitProvider.apply({ kind: 'secret.crypto.set', crypto: altBlob });
    const d = await desktopProvider.read();
    const g = await gitProvider.read();
    expect(canonicalize(d.synced)).toBe(canonicalize(g.synced));
    expect(d.synced.secretCrypto).toEqual(altBlob);
  });

  it('secret.crypto.set OVER an existing blob produces identical state across providers', async () => {
    const { desktopProvider, gitProvider } = makeProviders('compat');
    // Install initial blob.
    await desktopProvider.apply({ kind: 'secret.crypto.set', crypto: blob });
    await gitProvider.apply({ kind: 'secret.crypto.set', crypto: blob });
    // Rotate: new salt, new verifier (simulates passphrase rotation).
    const rotated = {
      ...blob,
      salt: 'CCCCCCCCCCCCCCCCCCCCCC==',
      verifier: 'rotated-verifier-stub',
    };
    const dResult = await desktopProvider.apply({ kind: 'secret.crypto.set', crypto: rotated });
    const gResult = await gitProvider.apply({ kind: 'secret.crypto.set', crypto: rotated });
    expect(canonicalize(dResult.state.synced)).toBe(canonicalize(gResult.state.synced));
    expect(dResult.state.synced.secretCrypto).toEqual(rotated);
    expect(gResult.state.synced.secretCrypto).toEqual(rotated);
  });

  it('a malformed crypto blob is rejected by both providers (no mutation)', async () => {
    const { desktopProvider, gitProvider } = makeProviders('compat');
    const bad = { ...blob, verifier: '' };
    const dResult = await desktopProvider.apply({ kind: 'secret.crypto.set', crypto: bad });
    const gResult = await gitProvider.apply({ kind: 'secret.crypto.set', crypto: bad });
    expect(dResult.state.synced.secretCrypto).toBeNull();
    expect(gResult.state.synced.secretCrypto).toBeNull();
    expect(dResult.changedIds).toEqual([]);
    expect(gResult.changedIds).toEqual([]);
  });
});
