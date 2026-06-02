import { describe, expect, it } from 'vitest';
import { createEmptyWorkspace } from '../persistence/workspaceStorage';
import {
  addEnvironment,
  addVariableRow,
  duplicateEnvironment,
  exportEnvironment,
  removeEnvironment,
  renameEnvironment,
  setActiveEnvironment,
  setPriorityOrder,
  setVariables,
} from './envActions';

describe('envActions', () => {
  describe('addEnvironment', () => {
    it('adds a new env to items + priorityOrder', () => {
      const { synced } = createEmptyWorkspace();
      const next = addEnvironment(synced, 'dev');
      expect(next.environments.items).toHaveProperty('dev');
      expect(next.environments.priorityOrder).toEqual([{ kind: 'local', name: 'dev' }]);
    });

    it('trims whitespace and rejects empty / duplicate names', () => {
      const { synced } = createEmptyWorkspace();
      const a = addEnvironment(synced, '  prod  ');
      expect(a.environments.items).toHaveProperty('prod');
      // Duplicate
      expect(addEnvironment(a, 'prod')).toBe(a);
      // Empty
      expect(addEnvironment(a, '   ')).toBe(a);
    });

    it('appends to priorityOrder without duplicating', () => {
      const { synced } = createEmptyWorkspace();
      const a = addEnvironment(synced, 'dev');
      const b = addEnvironment(a, 'prod');
      expect(b.environments.priorityOrder).toEqual([
        { kind: 'local', name: 'dev' },
        { kind: 'local', name: 'prod' },
      ]);
    });
  });

  describe('removeEnvironment', () => {
    it('removes from items, priority, and clears active when matching', () => {
      const { synced } = createEmptyWorkspace();
      const a = addEnvironment(synced, 'dev');
      const b = setActiveEnvironment(a, 'dev');
      const c = removeEnvironment(b, 'dev');
      expect(c.environments.items).not.toHaveProperty('dev');
      expect(c.environments.priorityOrder).toEqual([]);
      expect(c.environments.activeName).toBeNull();
    });

    it('keeps activeName when a different env is removed', () => {
      const { synced } = createEmptyWorkspace();
      const a = addEnvironment(addEnvironment(synced, 'dev'), 'prod');
      const b = setActiveEnvironment(a, 'dev');
      const c = removeEnvironment(b, 'prod');
      expect(c.environments.activeName).toBe('dev');
    });

    it('is a no-op for unknown names', () => {
      const { synced } = createEmptyWorkspace();
      expect(removeEnvironment(synced, 'nope')).toBe(synced);
    });
  });

  describe('renameEnvironment', () => {
    it('renames the env and updates references', () => {
      const { synced } = createEmptyWorkspace();
      const a = addEnvironment(synced, 'dev');
      const b = setActiveEnvironment(a, 'dev');
      const c = renameEnvironment(b, 'dev', 'staging');
      expect(c.environments.items).toHaveProperty('staging');
      expect(c.environments.items).not.toHaveProperty('dev');
      expect(c.environments.activeName).toBe('staging');
      expect(c.environments.priorityOrder).toEqual([{ kind: 'local', name: 'staging' }]);
    });

    it('rejects renames to existing names (collision)', () => {
      const { synced } = createEmptyWorkspace();
      const a = addEnvironment(addEnvironment(synced, 'dev'), 'prod');
      expect(renameEnvironment(a, 'dev', 'prod')).toBe(a);
    });

    it('rejects empty names and self-renames', () => {
      const { synced } = createEmptyWorkspace();
      const a = addEnvironment(synced, 'dev');
      expect(renameEnvironment(a, 'dev', '   ')).toBe(a);
      expect(renameEnvironment(a, 'dev', 'dev')).toBe(a);
    });

    it('is a no-op for unknown source names', () => {
      const { synced } = createEmptyWorkspace();
      expect(renameEnvironment(synced, 'nope', 'x')).toBe(synced);
    });
  });

  describe('setActiveEnvironment', () => {
    it('accepts null to clear the active env', () => {
      const { synced } = createEmptyWorkspace();
      const a = addEnvironment(synced, 'dev');
      const b = setActiveEnvironment(a, 'dev');
      const c = setActiveEnvironment(b, null);
      expect(c.environments.activeName).toBeNull();
    });

    it('rejects unknown names', () => {
      const { synced } = createEmptyWorkspace();
      expect(setActiveEnvironment(synced, 'nope')).toBe(synced);
    });

    it('is a no-op when value is unchanged', () => {
      const { synced } = createEmptyWorkspace();
      const a = addEnvironment(synced, 'dev');
      const b = setActiveEnvironment(a, 'dev');
      expect(setActiveEnvironment(b, 'dev')).toBe(b);
    });
  });

  describe('setPriorityOrder', () => {
    it('filters out unknown names and dedupes', () => {
      const { synced } = createEmptyWorkspace();
      const a = addEnvironment(addEnvironment(synced, 'dev'), 'prod');
      const b = setPriorityOrder(a, [
        { kind: 'local', name: 'prod' },
        { kind: 'local', name: 'unknown' },
        { kind: 'local', name: 'dev' },
        { kind: 'local', name: 'prod' },
      ]);
      expect(b.environments.priorityOrder).toEqual([
        { kind: 'local', name: 'prod' },
        { kind: 'local', name: 'dev' },
      ]);
    });
  });

  describe('variable rows', () => {
    it('setVariables replaces the array', () => {
      const { synced } = createEmptyWorkspace();
      const a = addEnvironment(synced, 'dev');
      const b = setVariables(a, 'dev', [{ key: 'K', value: 'v', encrypted: false }]);
      expect(b.environments.items.dev?.variables).toEqual([
        { key: 'K', value: 'v', encrypted: false },
      ]);
    });

    it('addVariableRow appends a blank row', () => {
      const { synced } = createEmptyWorkspace();
      const a = addEnvironment(synced, 'dev');
      const b = addVariableRow(a, 'dev');
      expect(b.environments.items.dev?.variables).toEqual([
        { key: '', value: '', encrypted: false },
      ]);
    });

    it('row mutators are no-ops for unknown env names', () => {
      const { synced } = createEmptyWorkspace();
      expect(setVariables(synced, 'nope', [])).toBe(synced);
      expect(addVariableRow(synced, 'nope')).toBe(synced);
    });
  });

  describe('duplicateEnvironment', () => {
    it('clones variables under "<name> (copy)" + appends to priorityOrder', () => {
      const { synced } = createEmptyWorkspace();
      const a = addEnvironment(synced, 'dev');
      const b = setVariables(a, 'dev', [
        { key: 'API', value: 'live', encrypted: false },
        { key: 'PORT', value: '8080', encrypted: false },
      ]);
      const c = duplicateEnvironment(b, 'dev');
      expect(c.environments.items).toHaveProperty('dev (copy)');
      // Variables are deep-copied (new array, new objects).
      expect(c.environments.items['dev (copy)']?.variables).toEqual(
        b.environments.items.dev?.variables,
      );
      expect(c.environments.items['dev (copy)']?.variables).not.toBe(
        b.environments.items.dev?.variables,
      );
      expect(c.environments.priorityOrder).toEqual([
        { kind: 'local', name: 'dev' },
        { kind: 'local', name: 'dev (copy)' },
      ]);
    });

    it('avoids name collisions with "<name> (copy 2)", … on repeated dupes', () => {
      const { synced } = createEmptyWorkspace();
      const a = addEnvironment(synced, 'dev');
      const b = duplicateEnvironment(a, 'dev'); // dev (copy)
      const c = duplicateEnvironment(b, 'dev'); // dev (copy 2)
      const d = duplicateEnvironment(c, 'dev'); // dev (copy 3)
      expect(c.environments.items).toHaveProperty('dev (copy 2)');
      expect(d.environments.items).toHaveProperty('dev (copy 3)');
    });

    it('preserves encrypted-var bindings (secretKeyId carries through)', () => {
      const { synced } = createEmptyWorkspace();
      const a = addEnvironment(synced, 'dev');
      const b = setVariables(a, 'dev', [
        { key: 'TOKEN', value: '', encrypted: true, secretKeyId: 'sec_abc' },
      ]);
      const c = duplicateEnvironment(b, 'dev');
      expect(c.environments.items['dev (copy)']?.variables).toEqual([
        { key: 'TOKEN', value: '', encrypted: true, secretKeyId: 'sec_abc' },
      ]);
    });

    it('is a no-op for unknown source names', () => {
      const { synced } = createEmptyWorkspace();
      expect(duplicateEnvironment(synced, 'nope')).toBe(synced);
    });
  });

  describe('exportEnvironment', () => {
    it('returns null for unknown env names', () => {
      const { synced } = createEmptyWorkspace();
      expect(exportEnvironment(synced, 'nope')).toBeNull();
    });

    it('serializes plain vars verbatim under apicircleEnvironment v2 shape', () => {
      const { synced } = createEmptyWorkspace();
      const a = addEnvironment(synced, 'dev');
      const b = setVariables(a, 'dev', [
        { key: 'A', value: '1', encrypted: false },
        { key: 'B', value: 'two', encrypted: false },
      ]);
      const json = exportEnvironment(b, 'dev');
      expect(json).not.toBeNull();
      const parsed = JSON.parse(json!);
      expect(parsed).toEqual({
        apicircleEnvironment: 2,
        name: 'dev',
        variables: [
          { key: 'A', value: '1', encrypted: false },
          { key: 'B', value: 'two', encrypted: false },
        ],
      });
    });

    it('carries ciphertext + slot salt for encrypted vars (v2 parity with Git push)', () => {
      const { synced } = createEmptyWorkspace();
      const a = addEnvironment(synced, 'dev');
      const withSlot: typeof a = {
        ...a,
        secretKeys: {
          sec_abc: {
            id: 'sec_abc',
            label: 'PROD_TOKEN',
            salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
            createdAt: '2026-06-02T00:00:00.000Z',
          },
        },
      };
      const b = setVariables(withSlot, 'dev', [
        // Real bound row: the value is the AES-GCM ciphertext, not the plaintext.
        {
          key: 'TOKEN',
          value: 'enc:v1:AAAAAAAAAAAAAAAA:abc==',
          encrypted: true,
          secretKeyId: 'sec_abc',
        },
      ]);
      const parsed = JSON.parse(exportEnvironment(b, 'dev')!);
      expect(parsed.apicircleEnvironment).toBe(2);
      expect(parsed.variables).toEqual([
        {
          key: 'TOKEN',
          encrypted: true,
          value: 'enc:v1:AAAAAAAAAAAAAAAA:abc==',
          secretKeyId: 'sec_abc',
          secret: { label: 'PROD_TOKEN', salt: 'AAAAAAAAAAAAAAAAAAAAAA==' },
        },
      ]);
      // The PLAINTEXT slot value never lives on the row, so the only thing
      // sensitive on the wire is the ciphertext + salt. Both are useless
      // without the user's local slot value — same model as Git push/pull.
      expect(exportEnvironment(b, 'dev')).not.toContain('PLAINTEXT');
    });

    it('emits empty value + null salt when a row is bound but value or slot metadata is missing', () => {
      const { synced } = createEmptyWorkspace();
      const a = addEnvironment(synced, 'dev');
      // No matching entry in synced.secretKeys — simulates a lazily-bound
      // row that pre-dates the eager-register path in addSecret. The row's
      // value is also plain (not a ciphertext) — defensive case from a
      // half-migrated workspace. Both fall back cleanly.
      const b = setVariables(a, 'dev', [
        {
          key: 'TOKEN',
          value: 'plain-not-ciphertext',
          encrypted: true,
          secretKeyId: 'sec_missing',
        },
      ]);
      const parsed = JSON.parse(exportEnvironment(b, 'dev')!);
      expect(parsed.apicircleEnvironment).toBe(2);
      expect(parsed.variables).toEqual([
        {
          key: 'TOKEN',
          encrypted: true,
          value: '', // non-encrypted value sanitized to empty so destination prompts
          secretKeyId: 'sec_missing',
          secret: { label: 'TOKEN', salt: null },
        },
      ]);
    });
  });
});
