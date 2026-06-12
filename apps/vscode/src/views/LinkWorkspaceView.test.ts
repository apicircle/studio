import { describe, it, expect } from 'vitest';
import type { LinkedWorkspace, ReleaseHistory } from '@apicircle/shared';
import type { WorkspaceState } from '@apicircle/core';
import type { VsCodeBridge } from '../host/vscodeBridge';
import { LinkWorkspaceView } from './LinkWorkspaceView';

function bridgeWith(
  releases: ReleaseHistory | null,
  linkedWorkspaces: Record<string, LinkedWorkspace> = {},
  linkedCollections: Record<string, unknown> = {},
  linkedOverrides: {
    requests: Record<string, unknown>;
    environmentVars: Record<string, unknown>;
  } = {
    requests: {},
    environmentVars: {},
  },
): VsCodeBridge {
  const state = {
    synced: { releases: { self: releases, perLink: {} }, linkedWorkspaces, linkedOverrides },
    local: { linkedCollections },
  } as unknown as WorkspaceState;
  return {
    activeWorkspace: () => ({ read: async () => state }),
  } as unknown as VsCodeBridge;
}

function lw(id: string, over: Partial<LinkedWorkspace> = {}): LinkedWorkspace {
  return {
    id,
    kind: 'public',
    name: id,
    source: {
      provider: 'github',
      repoFullName: `org/${id}`,
      branch: 'main',
      sessionMode: 'workspace',
    },
    scope: ['collections', 'environments'],
    pinnedVersion: null,
    updatePolicy: 'manual',
    linkedAt: '2026-01-01T00:00:00.000Z',
    requiredSecretKeyIds: [],
    ...over,
  };
}

const emptyBridge = { activeWorkspace: () => undefined } as unknown as VsCodeBridge;

function ledger(
  ...versions: Array<{ v: string; deprecated?: boolean; yanked?: boolean }>
): ReleaseHistory {
  return {
    currentVersion: versions[versions.length - 1]?.v ?? null,
    versions: versions.map((x) => ({
      version: x.v,
      publishedAt: '2026-01-01T00:00:00.000Z',
      notes: '',
      workspaceSnapshot: 'a'.repeat(64),
      deprecated: x.deprecated ?? false,
      yanked: x.yanked ?? false,
    })),
  };
}

describe('LinkWorkspaceView', () => {
  it('viewId matches the package.json contribution', () => {
    expect(new LinkWorkspaceView(emptyBridge).viewId).toBe('apicircle.linkWorkspaces');
  });

  it('returns no nodes when there is no active workspace', async () => {
    expect(await new LinkWorkspaceView(emptyBridge).getChildren()).toEqual([]);
  });

  it('shows the Releases + Linked workspaces roots at top level', async () => {
    const view = new LinkWorkspaceView(bridgeWith(null));
    const roots = await view.getChildren();
    expect(roots).toEqual([{ kind: 'releasesRoot' }, { kind: 'linkedRoot' }]);
  });

  it('the Linked workspaces root reads its count and lists links alphabetically', async () => {
    const view = new LinkWorkspaceView(
      bridgeWith(null, { b: lw('b', { name: 'Bravo' }), a: lw('a', { name: 'Alpha' }) }),
    );
    const root = await view.getTreeItem({ kind: 'linkedRoot' });
    expect(root.label).toBe('Linked workspaces');
    expect(root.description).toBe('2 linked');

    const children = await view.getChildren({ kind: 'linkedRoot' });
    expect(children.map((c) => (c.kind === 'linkedWorkspace' ? c.id : null))).toEqual(['a', 'b']);
  });

  it('a linked-workspace node shows kind + pin and opens its YAML', async () => {
    const view = new LinkWorkspaceView(
      bridgeWith(null, { a: lw('a', { name: 'Alpha', pinnedVersion: '1.2.0' }) }),
    );
    const item = await view.getTreeItem({ kind: 'linkedWorkspace', id: 'a' });
    expect(item.label).toBe('Alpha');
    expect(item.description).toBe('public · v1.2.0');
    expect(item.contextValue).toBe('apicircleLinkedWorkspace');
    expect(item.command?.command).toBe('apicircle.openLinkYaml');
    expect(item.command?.arguments).toEqual([{ id: 'a' }]);
  });

  it("the Linked workspaces root reads 'none yet' when empty", async () => {
    const view = new LinkWorkspaceView(bridgeWith(null));
    const root = await view.getTreeItem({ kind: 'linkedRoot' });
    expect(root.description).toBe('none yet');
  });

  it("the Releases root reads 'no releases yet' for an empty ledger", async () => {
    const view = new LinkWorkspaceView(bridgeWith(null));
    const item = await view.getTreeItem({ kind: 'releasesRoot' });
    expect(item.label).toBe('Releases');
    expect(item.description).toBe('no releases yet');
    expect(item.command?.command).toBe('apicircle.openReleaseHistory');
  });

  it('lists versions newest-first under the Releases root with status', async () => {
    const view = new LinkWorkspaceView(
      bridgeWith(ledger({ v: '1.0.0', deprecated: true }, { v: '1.2.0' })),
    );
    const root = await view.getTreeItem({ kind: 'releasesRoot' });
    expect(root.description).toBe('v1.2.0 · 2 published versions');

    const children = await view.getChildren({ kind: 'releasesRoot' });
    expect(children.map((c) => (c.kind === 'release' ? c.version : null))).toEqual([
      '1.2.0',
      '1.0.0',
    ]);

    const deprecatedItem = await view.getTreeItem({
      kind: 'release',
      version: '1.0.0',
      deprecated: true,
      yanked: false,
    });
    expect(deprecatedItem.label).toBe('v1.0.0');
    expect(deprecatedItem.description).toBe('deprecated');
    expect(deprecatedItem.contextValue).toBe('apicircleReleaseVersion');
  });

  it("lists a linked workspace's cached requests as children", async () => {
    const snapshot = {
      pulledAt: 't',
      ref: 'HEAD@main',
      collections: {
        tree: { id: 'r', type: 'root', children: [] },
        requests: {
          'req-1': { id: 'req-1', name: 'List pets', method: 'GET' },
          'req-2': { id: 'req-2', name: 'Add pet', method: 'POST' },
        },
        folders: {},
      },
      environments: { items: {}, activeName: null, priorityOrder: [] },
    };
    const view = new LinkWorkspaceView(
      bridgeWith(
        null,
        { a: lw('a', { name: 'Alpha' }) },
        { a: snapshot },
        {
          requests: {
            'a:req-1': { linkedWorkspaceId: 'a', itemId: 'req-1', patch: {}, updatedAt: 't' },
          },
          environmentVars: {},
        },
      ),
    );
    const children = await view.getChildren({ kind: 'linkedWorkspace', id: 'a' });
    expect(children.map((c) => (c.kind === 'linkedRequest' ? c.requestId : null))).toEqual([
      'req-2',
      'req-1',
    ]);

    const item = await view.getTreeItem({ kind: 'linkedRequest', linkId: 'a', requestId: 'req-1' });
    expect(item.label).toBe('List pets');
    expect(item.description).toBe('GET · modified');
    expect(item.command?.command).toBe('apicircle.openLinkedRequest');
    expect(item.command?.arguments).toEqual([{ linkId: 'a', requestId: 'req-1' }]);
  });
});
