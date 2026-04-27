import { describe, expect, it } from 'vitest';
import { createEmptyWorkspace } from '../persistence/workspaceStorage';
import {
  addEnvironment,
  addVariableRow,
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
      expect(next.environments.priorityOrder).toEqual(['dev']);
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
      expect(b.environments.priorityOrder).toEqual(['dev', 'prod']);
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
      expect(c.environments.priorityOrder).toEqual(['staging']);
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
      const b = setPriorityOrder(a, ['prod', 'unknown', 'dev', 'prod']);
      expect(b.environments.priorityOrder).toEqual(['prod', 'dev']);
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
});
