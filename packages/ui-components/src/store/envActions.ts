import type { Environment, WorkspaceSynced } from '@apicircle/shared';

// Pure reducers for environment CRUD + active selection + priority order.
// All mirror the editorActions pattern: take a synced doc, return a new
// snapshot with `meta.updatedAt` bumped.

function bumpUpdatedAt(synced: WorkspaceSynced): WorkspaceSynced {
  return { ...synced, meta: { ...synced.meta, updatedAt: new Date().toISOString() } };
}

export function addEnvironment(synced: WorkspaceSynced, name: string): WorkspaceSynced {
  const trimmed = name.trim();
  if (!trimmed || synced.environments.items[trimmed]) return synced;
  const env: Environment = { name: trimmed, variables: [] };
  return bumpUpdatedAt({
    ...synced,
    environments: {
      ...synced.environments,
      items: { ...synced.environments.items, [trimmed]: env },
      // Newly-created envs land at the end of the priority list so they're
      // always reachable. The user can reorder freely after the fact.
      priorityOrder: synced.environments.priorityOrder.includes(trimmed)
        ? synced.environments.priorityOrder
        : [...synced.environments.priorityOrder, trimmed],
    },
  });
}

export function removeEnvironment(synced: WorkspaceSynced, name: string): WorkspaceSynced {
  if (!synced.environments.items[name]) return synced;
  const items = { ...synced.environments.items };
  delete items[name];
  return bumpUpdatedAt({
    ...synced,
    environments: {
      ...synced.environments,
      items,
      activeName: synced.environments.activeName === name ? null : synced.environments.activeName,
      priorityOrder: synced.environments.priorityOrder.filter((n) => n !== name),
    },
  });
}

export function renameEnvironment(
  synced: WorkspaceSynced,
  oldName: string,
  newName: string,
): WorkspaceSynced {
  const trimmed = newName.trim();
  if (!trimmed || trimmed === oldName) return synced;
  if (!synced.environments.items[oldName]) return synced;
  if (synced.environments.items[trimmed]) return synced; // collision

  const items = { ...synced.environments.items };
  const env = items[oldName];
  delete items[oldName];
  items[trimmed] = { ...env, name: trimmed };

  return bumpUpdatedAt({
    ...synced,
    environments: {
      ...synced.environments,
      items,
      activeName:
        synced.environments.activeName === oldName ? trimmed : synced.environments.activeName,
      priorityOrder: synced.environments.priorityOrder.map((n) => (n === oldName ? trimmed : n)),
    },
  });
}

export function setActiveEnvironment(
  synced: WorkspaceSynced,
  name: string | null,
): WorkspaceSynced {
  if (name !== null && !synced.environments.items[name]) return synced;
  if (synced.environments.activeName === name) return synced;
  return bumpUpdatedAt({
    ...synced,
    environments: { ...synced.environments, activeName: name },
  });
}

export function setPriorityOrder(synced: WorkspaceSynced, order: string[]): WorkspaceSynced {
  // Filter to known env names and dedupe so the persisted list always
  // reflects reality.
  const known = new Set(Object.keys(synced.environments.items));
  const seen = new Set<string>();
  const filtered = order.filter((n) => {
    if (!known.has(n) || seen.has(n)) return false;
    seen.add(n);
    return true;
  });
  return bumpUpdatedAt({
    ...synced,
    environments: { ...synced.environments, priorityOrder: filtered },
  });
}

// --- variable-level operations --------------------------------------------

export function setVariables(
  synced: WorkspaceSynced,
  envName: string,
  variables: Environment['variables'],
): WorkspaceSynced {
  const env = synced.environments.items[envName];
  if (!env) return synced;
  return bumpUpdatedAt({
    ...synced,
    environments: {
      ...synced.environments,
      items: {
        ...synced.environments.items,
        [envName]: { ...env, variables },
      },
    },
  });
}

/** Add a blank variable row to the named env. */
export function addVariableRow(synced: WorkspaceSynced, envName: string): WorkspaceSynced {
  const env = synced.environments.items[envName];
  if (!env) return synced;
  return setVariables(synced, envName, [
    ...env.variables,
    { key: '', value: '', encrypted: false },
  ]);
}
