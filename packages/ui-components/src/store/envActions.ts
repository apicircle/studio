import type { Environment, EnvPriorityRef, WorkspaceSynced } from '@apicircle/shared';
import { envPriorityKey } from '@apicircle/shared';

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
      priorityOrder: synced.environments.priorityOrder.some(
        (r) => r.kind === 'local' && r.name === trimmed,
      )
        ? synced.environments.priorityOrder
        : [...synced.environments.priorityOrder, { kind: 'local', name: trimmed }],
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
      priorityOrder: synced.environments.priorityOrder.filter(
        (r) => !(r.kind === 'local' && r.name === name),
      ),
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
      priorityOrder: synced.environments.priorityOrder.map((r) =>
        r.kind === 'local' && r.name === oldName ? { kind: 'local' as const, name: trimmed } : r,
      ),
    },
  });
}

export function duplicateEnvironment(synced: WorkspaceSynced, name: string): WorkspaceSynced {
  const src = synced.environments.items[name];
  if (!src) return synced;
  // Pick the first non-colliding "<name> (copy)", "<name> (copy 2)", … —
  // mirrors editorActions' duplicateRequest naming.
  let candidate = `${name} (copy)`;
  let n = 2;
  while (synced.environments.items[candidate]) {
    candidate = `${name} (copy ${n})`;
    n += 1;
  }
  // Variables are copied verbatim. Encrypted vars carry their secretKeyId
  // unchanged — the same vault key resolves the duplicate. (Users who want
  // independent secrets should rebind via the Encrypt button after.)
  const dup: Environment = {
    name: candidate,
    variables: src.variables.map((v) => ({ ...v })),
  };
  return bumpUpdatedAt({
    ...synced,
    environments: {
      ...synced.environments,
      items: { ...synced.environments.items, [candidate]: dup },
      // Land at the end of the priority list, mirroring addEnvironment.
      priorityOrder: synced.environments.priorityOrder.some(
        (r) => r.kind === 'local' && r.name === candidate,
      )
        ? synced.environments.priorityOrder
        : [...synced.environments.priorityOrder, { kind: 'local', name: candidate }],
    },
  });
}

/**
 * Serialize an environment to a portable JSON string. Encrypted vars
 * intentionally drop their value — only the bound `secretKeyId` survives,
 * so importing on another machine requires the user to provide the secret
 * locally. Plain vars roundtrip in full.
 */
export function exportEnvironment(synced: WorkspaceSynced, name: string): string | null {
  const env = synced.environments.items[name];
  if (!env) return null;
  const payload = {
    apicircleEnvironment: 1 as const,
    name: env.name,
    variables: env.variables.map((v) =>
      v.encrypted && v.secretKeyId
        ? { key: v.key, encrypted: true as const, secretKeyId: v.secretKeyId }
        : { key: v.key, value: v.value, encrypted: false as const },
    ),
  };
  return JSON.stringify(payload, null, 2);
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

export function setPriorityOrder(
  synced: WorkspaceSynced,
  order: EnvPriorityRef[],
): WorkspaceSynced {
  // Filter local refs to known env names; pass linked refs through (the
  // snapshot lives in WorkspaceLocal so this reducer can't validate them
  // — stale linked refs surface as empty layers at resolve time and the
  // sidebar drops them with a warning). Dedupe across kinds via composite
  // key so flipping a checkbox twice doesn't append twice.
  const knownLocal = new Set(Object.keys(synced.environments.items));
  const seen = new Set<string>();
  const filtered = order.filter((ref) => {
    const key = envPriorityKey(ref);
    if (seen.has(key)) return false;
    if (ref.kind === 'local' && !knownLocal.has(ref.name)) return false;
    seen.add(key);
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
