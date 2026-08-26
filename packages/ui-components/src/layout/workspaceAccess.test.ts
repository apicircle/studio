import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WORKSPACE_ACCESS,
  canCreateWorkspace,
  unlockedWorkspaceIds,
  type AccessibleWorkspace,
} from './workspaceAccess';

const ws = (id: string, createdAt: string): AccessibleWorkspace => ({ id, createdAt });

// Deliberately out of creation order, so any test that passes is passing because
// the resolver sorts rather than because the input happened to be sorted.
const THREE = [
  ws('c', '2026-03-01T00:00:00.000Z'),
  ws('a', '2026-01-01T00:00:00.000Z'),
  ws('b', '2026-02-01T00:00:00.000Z'),
];

describe('DEFAULT_WORKSPACE_ACCESS', () => {
  it('is a cap of one', () => {
    // This is the load-bearing default: a build with no edition attached is the
    // free tier, so omitting the seam must NOT mean "unlimited".
    expect(DEFAULT_WORKSPACE_ACCESS).toEqual({ maxWorkspaces: 1 });
  });
});

describe('unlockedWorkspaceIds', () => {
  it('keeps the oldest workspaces, not the most recently used', () => {
    expect(unlockedWorkspaceIds(THREE, 1)).toEqual(new Set(['a']));
    expect(unlockedWorkspaceIds(THREE, 2)).toEqual(new Set(['a', 'b']));
  });

  it('unlocks everything when the cap is at or above the count', () => {
    expect(unlockedWorkspaceIds(THREE, 3)).toEqual(new Set(['a', 'b', 'c']));
    expect(unlockedWorkspaceIds(THREE, 99)).toEqual(new Set(['a', 'b', 'c']));
  });

  it('unlocks everything when the cap is unlimited', () => {
    expect(unlockedWorkspaceIds(THREE, Infinity)).toEqual(new Set(['a', 'b', 'c']));
  });

  it('is stable — the same input always yields the same set', () => {
    // Ordering by lastOpenedAt would silently change which workspaces are
    // reachable every time the user switched. This is the guard against that.
    const first = unlockedWorkspaceIds(THREE, 2);
    const shuffled = [THREE[1], THREE[2], THREE[0]];
    expect(unlockedWorkspaceIds(shuffled, 2)).toEqual(first);
  });

  it('breaks a createdAt tie on id so the order is total', () => {
    const same = '2026-01-01T00:00:00.000Z';
    const tied = [ws('z', same), ws('y', same), ws('x', same)];
    expect(unlockedWorkspaceIds(tied, 2)).toEqual(new Set(['x', 'y']));
  });

  it('promotes the next-oldest when an unlocked workspace is removed', () => {
    // The whole reason for oldest-first: deleting frees a slot with no extra
    // bookkeeping, and the promotion is predictable.
    expect(unlockedWorkspaceIds(THREE, 1)).toEqual(new Set(['a']));
    const withoutA = THREE.filter((w) => w.id !== 'a');
    expect(unlockedWorkspaceIds(withoutA, 1)).toEqual(new Set(['b']));
  });

  it('handles an empty registry and a zero cap', () => {
    expect(unlockedWorkspaceIds([], 1)).toEqual(new Set());
    expect(unlockedWorkspaceIds(THREE, 0)).toEqual(new Set());
    expect(unlockedWorkspaceIds(THREE, -1)).toEqual(new Set());
  });
});

describe('canCreateWorkspace', () => {
  it('allows creation strictly below the cap', () => {
    expect(canCreateWorkspace(0, 1)).toBe(true);
    expect(canCreateWorkspace(1, 1)).toBe(false);
    expect(canCreateWorkspace(2, 3)).toBe(true);
    expect(canCreateWorkspace(3, 3)).toBe(false);
  });

  it('always allows creation when unlimited', () => {
    expect(canCreateWorkspace(10_000, Infinity)).toBe(true);
  });

  it('refuses when already over the cap', () => {
    // Reachable for real: an existing multi-workspace user whose plan caps lower
    // than what they already have.
    expect(canCreateWorkspace(5, 1)).toBe(false);
  });
});
