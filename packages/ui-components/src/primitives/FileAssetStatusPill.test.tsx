import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { act } from 'react';
import type { GlobalFileAsset, WorkspaceLocal, WorkspaceSynced } from '@apicircle/shared';

import { deriveFileAssetState, FileAssetStatusPill } from './FileAssetStatusPill';
import { useWorkspaceStore } from '../store/workspaceStore';

const T = '2026-06-06T00:00:00.000Z';

function ref(branchName: string, blobSha: string) {
  return { branchName, blobSha, commitSha: `commit-${blobSha}`, verifiedAt: T };
}

function asset(overrides: Partial<GlobalFileAsset> = {}): GlobalFileAsset {
  return {
    id: 'a1',
    name: 'asset',
    slotId: 'slot-1',
    filename: 'a.bin',
    size: 4,
    mimeType: 'application/octet-stream',
    sha256: 'sha-1',
    createdAt: T,
    updatedAt: T,
    ...overrides,
  };
}

describe('deriveFileAssetState', () => {
  it('returns "missing" when the asset is absent and nothing is pending', () => {
    expect(deriveFileAssetState(null, false)).toBe('missing');
    expect(deriveFileAssetState(undefined, false)).toBe('missing');
  });

  it('returns "uploading" when bytes are pending and no refs exist', () => {
    expect(deriveFileAssetState(asset(), true)).toBe('uploading');
  });

  it('returns "workingOnly" when only the working ref is set', () => {
    expect(deriveFileAssetState(asset({ workingBranchRef: ref('w', 'b1') }), false)).toBe(
      'workingOnly',
    );
  });

  it('returns "baseOnly" when only the base ref is set', () => {
    expect(deriveFileAssetState(asset({ baseBranchRef: ref('main', 'b1') }), false)).toBe(
      'baseOnly',
    );
  });

  it('returns "merged" when both refs hold the same blob sha', () => {
    expect(
      deriveFileAssetState(
        asset({
          workingBranchRef: ref('w', 'b1'),
          baseBranchRef: ref('main', 'b1'),
        }),
        false,
      ),
    ).toBe('merged');
  });

  it('returns "diverged" when both refs hold different blob shas', () => {
    expect(
      deriveFileAssetState(
        asset({
          workingBranchRef: ref('w', 'b1'),
          baseBranchRef: ref('main', 'b2'),
        }),
        false,
      ),
    ).toBe('diverged');
  });

  it('returns "missing" when both refs are null and nothing is pending', () => {
    expect(
      deriveFileAssetState(asset({ workingBranchRef: null, baseBranchRef: null }), false),
    ).toBe('missing');
  });

  // Regression: when bytes are pending AND a stale workingBranchRef is
  // still set (the `fillGlobalFileAssetBytes` flow on an already-pushed
  // asset), pending bytes take priority so the pill truthfully shows
  // "Uploaded locally" instead of "On working branch."
  it('returns "uploading" when pending bytes coexist with a stale workingBranchRef', () => {
    expect(deriveFileAssetState(asset({ workingBranchRef: ref('w', 'stale-blob') }), true)).toBe(
      'uploading',
    );
  });

  it('returns "uploading" when pending bytes coexist with a stale baseBranchRef', () => {
    expect(deriveFileAssetState(asset({ baseBranchRef: ref('main', 'stale-blob') }), true)).toBe(
      'uploading',
    );
  });
});

function seedStore(synced: WorkspaceSynced, localOverrides: Partial<WorkspaceLocal> = {}): void {
  const local: WorkspaceLocal = {
    schemaVersion: 1,
    workspaceId: synced.workspaceId,
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
    ...localOverrides,
  };
  act(() => {
    useWorkspaceStore.setState({ synced, local });
  });
}

function syncedWithAsset(a: GlobalFileAsset): WorkspaceSynced {
  return {
    schemaVersion: 1,
    workspaceId: 'ws-1',
    collections: { tree: { id: 'r', type: 'root', children: [] }, requests: {}, folders: {} },
    environments: { items: {}, activeName: null, priorityOrder: [] },
    linkedWorkspaces: {},
    linkedOverrides: { requests: {}, environmentVars: {} },
    releases: { self: null, perLink: {} },
    globalAssets: { schemas: {}, graphql: {}, files: { [a.id]: a } },
    mockServers: {},
    meta: { createdAt: T, updatedAt: T, appVersion: '0.1.0' },
  };
}

describe('<FileAssetStatusPill />', () => {
  it('renders nothing when there is no asset and no pending upload', () => {
    seedStore(syncedWithAsset(asset()), {});
    const { container } = render(<FileAssetStatusPill assetId="other-id" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders "On working branch" when workingBranchRef is set', () => {
    const a = asset({ workingBranchRef: ref('apicircle/wb', 'b1') });
    seedStore(syncedWithAsset(a));
    render(<FileAssetStatusPill assetId={a.id} />);
    const pill = screen.getByRole('status');
    expect(pill).toHaveTextContent('On working branch');
    expect(pill.getAttribute('data-asset-state')).toBe('workingOnly');
  });

  it('renders "On main" when baseBranchRef is set', () => {
    const a = asset({ baseBranchRef: ref('main', 'b1') });
    seedStore(syncedWithAsset(a));
    render(<FileAssetStatusPill assetId={a.id} />);
    expect(screen.getByRole('status')).toHaveTextContent('On main');
  });

  it('renders "Uploaded locally" for an asset with pending bytes and no refs', () => {
    const a = asset();
    seedStore(syncedWithAsset(a), {
      pendingFileUploads: {
        [a.id]: {
          slotId: a.slotId,
          filename: a.filename,
          mimeType: a.mimeType,
          sha256: a.sha256!,
          size: a.size,
          queuedAt: T,
        },
      },
    });
    render(<FileAssetStatusPill assetId={a.id} />);
    expect(screen.getByRole('status')).toHaveTextContent('Uploaded locally');
  });

  it('renders "Missing" when refs drop AND no pending upload exists', () => {
    const a = asset({ workingBranchRef: null, baseBranchRef: null });
    seedStore(syncedWithAsset(a));
    render(<FileAssetStatusPill assetId={a.id} />);
    expect(screen.getByRole('status')).toHaveTextContent(/Missing/);
  });

  it('reflects usage in the title tooltip', () => {
    const a = asset({ baseBranchRef: ref('main', 'b1') });
    seedStore(syncedWithAsset(a), {
      assetUsageIndex: { [a.id]: { requests: ['r1', 'r2'], mockEndpoints: [], total: 2 } },
    });
    render(<FileAssetStatusPill assetId={a.id} />);
    expect(screen.getByRole('status').getAttribute('title')).toContain('used in 2 places');
  });
});
