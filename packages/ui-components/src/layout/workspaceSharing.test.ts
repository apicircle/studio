import { describe, expect, it } from 'vitest';
import { WORKSPACE_SHARING_ENABLED } from '@apicircle/shared';
import {
  isWorkspaceSharingEnabled,
  visibleUnderSharing,
  type SharingTagged,
} from './workspaceSharing';

interface Entry extends SharingTagged {
  id: string;
}

const ENTRIES: readonly Entry[] = [
  { id: 'plain' },
  { id: 'shared', requiresWorkspaceSharing: true },
  { id: 'explicitly-not', requiresWorkspaceSharing: false },
];

describe('isWorkspaceSharingEnabled', () => {
  it('is off — the shipped v1 configuration', () => {
    // The assertion the whole change rests on. If this ever flips, the Link
    // Workspace panel, the Releases card and Tag/Topics all come back.
    expect(isWorkspaceSharingEnabled()).toBe(false);
  });

  it('reports the hard-coded constant rather than a local copy of it', () => {
    expect(isWorkspaceSharingEnabled()).toBe(WORKSPACE_SHARING_ENABLED);
  });
});

describe('visibleUnderSharing', () => {
  it('drops the tagged entries when sharing is off', () => {
    expect(visibleUnderSharing(ENTRIES, false).map((e) => e.id)).toEqual([
      'plain',
      'explicitly-not',
    ]);
  });

  it('keeps every entry when sharing is on', () => {
    expect(visibleUnderSharing(ENTRIES, true)).toBe(ENTRIES);
  });

  it('defaults to this build — no argument means the shipped answer', () => {
    // The default parameter exists so a caller can't accidentally filter
    // against the opposite of what the app is actually doing.
    expect(visibleUnderSharing(ENTRIES)).toEqual(visibleUnderSharing(ENTRIES, false));
  });

  it('handles an empty list', () => {
    expect(visibleUnderSharing([], false)).toEqual([]);
  });
});
