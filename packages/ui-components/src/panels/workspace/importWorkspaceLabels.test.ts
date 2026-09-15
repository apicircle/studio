import { describe, expect, it } from 'vitest';
import { importWorkspaceLabels } from './importWorkspaceLabels';

function localRegistry(workspaces: Array<{ id: string; name: string }>) {
  return {
    schemaVersion: 1 as const,
    activeWorkspaceId: workspaces[0]?.id ?? null,
    workspaces: workspaces.map((w) => ({ ...w, createdAt: 't', lastOpenedAt: 't' })),
  };
}

function summary(id: string, name: string | null) {
  return { id, name, isActive: false };
}

describe('importWorkspaceLabels', () => {
  it("labels with this device's name, then the pushed name, then the id", () => {
    const labels = importWorkspaceLabels(
      [
        summary('ws-local', 'Pushed'),
        summary('ws-pushed', 'Pushed name'),
        summary('ws-unnamed', null),
      ],
      localRegistry([
        { id: 'ws-local', name: '  Mine  ' },
        // Blank locally (a name mid-edit) — the pushed name still shows.
        { id: 'ws-pushed', name: '   ' },
      ]),
    );
    expect([...labels]).toEqual([
      ['ws-local', 'Mine'],
      ['ws-pushed', 'Pushed name'],
      ['ws-unnamed', 'ws-unnamed'],
    ]);
  });

  it('works before the local registry has loaded', () => {
    expect([...importWorkspaceLabels([summary('ws-a', null), summary('ws-b', 'B')], null)]).toEqual(
      [
        ['ws-a', 'ws-a'],
        ['ws-b', 'B'],
      ],
    );
  });

  it('suffixes only case-insensitive collisions, with the first four id characters', () => {
    const labels = importWorkspaceLabels(
      [summary('aaaa1111', 'API'), summary('bbbb2222', 'api'), summary('cccc3333', 'Orders')],
      null,
    );
    expect([...labels.values()]).toEqual(['API #aaaa', 'api #bbbb', 'Orders']);
  });

  it('counts a local name toward collisions', () => {
    const labels = importWorkspaceLabels(
      [summary('aaaa1111', 'Payments'), summary('bbbb2222', 'Billing')],
      localRegistry([{ id: 'bbbb2222', name: 'payments' }]),
    );
    expect([...labels.values()]).toEqual(['Payments #aaaa', 'payments #bbbb']);
  });

  it('returns an empty map for an empty list', () => {
    expect(importWorkspaceLabels([], null).size).toBe(0);
  });
});
