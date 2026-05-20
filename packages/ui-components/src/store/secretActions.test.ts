import { describe, expect, it } from 'vitest';
import { createEmptyWorkspace } from '../persistence/workspaceStorage';
import {
  addSecretEntry,
  applyUsedInMap,
  removeSecretEntry,
  renameSecretEntry,
  setSecretUsedIn,
} from './secretActions';

describe('secretActions', () => {
  describe('addSecretEntry', () => {
    it('adds a workspace-origin entry with empty usedIn', () => {
      const { local } = createEmptyWorkspace();
      const next = addSecretEntry(local, { id: 's1', label: 'API_KEY' });
      const entry = next.secretIndex.entries.s1;
      expect(entry.label).toBe('API_KEY');
      expect(entry.origin).toBe('workspace');
      expect(entry.usedIn).toEqual([]);
    });

    it('trims labels and rejects empty / duplicate ones', () => {
      const { local } = createEmptyWorkspace();
      const a = addSecretEntry(local, { id: 's1', label: '  API_KEY  ' });
      expect(a.secretIndex.entries.s1?.label).toBe('API_KEY');
      // Duplicate label
      expect(addSecretEntry(a, { id: 's2', label: 'API_KEY' })).toBe(a);
      // Empty label
      expect(addSecretEntry(a, { id: 's3', label: '   ' })).toBe(a);
    });

    it('records linked-origin with linkedWorkspaceId + linkedKeyId', () => {
      const { local } = createEmptyWorkspace();
      const next = addSecretEntry(local, {
        id: 's1',
        label: 'PETS_TOKEN',
        origin: 'linked',
        linkedWorkspaceId: 'lw-1',
        linkedKeyId: 'TOKEN',
      });
      const entry = next.secretIndex.entries.s1;
      expect(entry.origin).toBe('linked');
      expect(entry.linkedWorkspaceId).toBe('lw-1');
      expect(entry.linkedKeyId).toBe('TOKEN');
    });
  });

  describe('removeSecretEntry', () => {
    it('removes the entry', () => {
      const { local } = createEmptyWorkspace();
      const a = addSecretEntry(local, { id: 's1', label: 'X' });
      const b = removeSecretEntry(a, 's1');
      expect(b.secretIndex.entries).not.toHaveProperty('s1');
    });
    it('is a no-op for unknown ids', () => {
      const { local } = createEmptyWorkspace();
      expect(removeSecretEntry(local, 'nope')).toBe(local);
    });
  });

  describe('renameSecretEntry', () => {
    it('renames to a unique label', () => {
      const { local } = createEmptyWorkspace();
      const a = addSecretEntry(local, { id: 's1', label: 'OLD' });
      const b = renameSecretEntry(a, 's1', 'NEW');
      expect(b.secretIndex.entries.s1?.label).toBe('NEW');
    });
    it('rejects empty / unchanged / colliding labels', () => {
      const { local } = createEmptyWorkspace();
      const a = addSecretEntry(addSecretEntry(local, { id: 's1', label: 'A' }), {
        id: 's2',
        label: 'B',
      });
      expect(renameSecretEntry(a, 's1', '   ')).toBe(a);
      expect(renameSecretEntry(a, 's1', 'A')).toBe(a);
      expect(renameSecretEntry(a, 's1', 'B')).toBe(a);
    });
    it('is a no-op for unknown ids', () => {
      const { local } = createEmptyWorkspace();
      expect(renameSecretEntry(local, 'nope', 'X')).toBe(local);
    });
  });

  describe('setSecretUsedIn / applyUsedInMap', () => {
    it('setSecretUsedIn updates a single entry', () => {
      const { local } = createEmptyWorkspace();
      const a = addSecretEntry(local, { id: 's1', label: 'X' });
      const b = setSecretUsedIn(a, 's1', [{ kind: 'request', id: 'r1', label: 'Get user' }]);
      expect(b.secretIndex.entries.s1?.usedIn).toEqual([
        { kind: 'request', id: 'r1', label: 'Get user' },
      ]);
    });

    it('setSecretUsedIn is a no-op for unknown ids', () => {
      const { local } = createEmptyWorkspace();
      expect(setSecretUsedIn(local, 'nope', [])).toBe(local);
    });

    it('applyUsedInMap stamps many entries atomically', () => {
      const { local } = createEmptyWorkspace();
      const a = addSecretEntry(addSecretEntry(local, { id: 's1', label: 'A' }), {
        id: 's2',
        label: 'B',
      });
      const b = applyUsedInMap(a, {
        s1: [{ kind: 'request', id: 'r1', label: 'r' }],
        s2: [],
      });
      expect(b.secretIndex.entries.s1?.usedIn).toHaveLength(1);
      expect(b.secretIndex.entries.s2?.usedIn).toEqual([]);
    });

    it('applyUsedInMap returns the same reference when nothing changed', () => {
      const { local } = createEmptyWorkspace();
      const a = addSecretEntry(local, { id: 's1', label: 'A' });
      const same = applyUsedInMap(a, { s1: [] });
      expect(same).toBe(a);
    });

    it('applyUsedInMap ignores unknown ids', () => {
      const { local } = createEmptyWorkspace();
      const a = addSecretEntry(local, { id: 's1', label: 'A' });
      const b = applyUsedInMap(a, { unknown: [{ kind: 'request', id: 'r', label: 'r' }] });
      expect(b).toBe(a);
    });
  });
});
