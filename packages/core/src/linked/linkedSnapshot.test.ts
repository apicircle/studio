import { describe, expect, it } from 'vitest';
import type { LinkedWorkspace } from '@apicircle/shared';
import { buildLinkedSnapshot, ledgerFromProbe, parseLinkedWorkspaceJson } from './linkedSnapshot';

function link(over: Partial<LinkedWorkspace> = {}): LinkedWorkspace {
  return {
    id: 'lw1',
    kind: 'public',
    name: 'Payments',
    sourceWorkspaceId: 'remote-ws-1',
    source: { provider: 'github', repoFullName: 'o/r', branch: 'main', sessionMode: 'workspace' },
    scope: ['collections', 'environments'],
    pinnedVersion: null,
    updatePolicy: 'manual',
    linkedAt: '2026-01-01T00:00:00.000Z',
    requiredSecretKeyIds: [],
    ...over,
  };
}

describe('parseLinkedWorkspaceJson', () => {
  it('extracts releases / collections / environments / secretKeys / globalAssets', () => {
    const text = JSON.stringify({
      releases: { self: { currentVersion: '1.0.0', versions: [] } },
      collections: { tree: { id: 'r', type: 'root', children: [] }, requests: {}, folders: {} },
      environments: { items: {}, activeName: null, priorityOrder: [] },
      secretKeys: { k1: { id: 'k1', label: 'Key', salt: 's', createdAt: 't' } },
      globalAssets: { schemas: {}, graphql: {} },
    });
    const probe = parseLinkedWorkspaceJson(text);
    expect(probe.releases?.self?.currentVersion).toBe('1.0.0');
    expect(probe.collections).toBeDefined();
    expect(probe.environments).toBeDefined();
    expect(probe.secretKeys?.k1.label).toBe('Key');
    expect(probe.globalAssets).toBeDefined();
  });

  it('strips prototype-pollution keys', () => {
    const probe = parseLinkedWorkspaceJson('{"__proto__":{"polluted":true},"collections":{}}');
    expect((Object.prototype as Record<string, unknown>).polluted).toBeUndefined();
    expect(probe.collections).toBeDefined();
  });

  it('throws on invalid JSON, non-object root, and oversize', () => {
    expect(() => parseLinkedWorkspaceJson('not json')).toThrow(/not valid JSON/);
    expect(() => parseLinkedWorkspaceJson('[]')).toThrow(/not an object/);
    expect(() => parseLinkedWorkspaceJson('"' + 'x'.repeat(16 * 1024 * 1024 + 2) + '"')).toThrow(
      /16 MiB/,
    );
  });

  it('ledgerFromProbe defaults to an empty ledger', () => {
    expect(ledgerFromProbe({})).toEqual({ versions: [], currentVersion: null });
    expect(
      ledgerFromProbe({ releases: { self: { currentVersion: '2.0.0', versions: [] } } }),
    ).toEqual({
      currentVersion: '2.0.0',
      versions: [],
    });
  });
});

describe('buildLinkedSnapshot', () => {
  it('returns null when there are no collections or environments', () => {
    expect(buildLinkedSnapshot({}, link())).toBeNull();
  });

  it('builds a HEAD-ref snapshot when unpinned', () => {
    const snap = buildLinkedSnapshot(
      { collections: { tree: { id: 'r', type: 'root', children: [] }, requests: {}, folders: {} } },
      link({ pinnedVersion: null }),
    );
    expect(snap?.ref).toBe('HEAD@main');
    expect(snap?.environments).toEqual({ items: {}, activeName: null, priorityOrder: [] });
  });

  it('builds a versioned ref + carries secretKeys when pinned', () => {
    const snap = buildLinkedSnapshot(
      {
        environments: { items: {}, activeName: null, priorityOrder: [] },
        secretKeys: { k1: { id: 'k1', label: 'Key', salt: 's', createdAt: 't' } },
      },
      link({ pinnedVersion: '1.2.0' }),
    );
    expect(snap?.ref).toBe('v1.2.0');
    expect(snap?.secretKeys?.k1.label).toBe('Key');
  });
});
