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
 * Serialize an environment to a portable JSON string (envelope v2).
 *
 * Encrypted vars now travel the same way they do over Git push/pull: the
 * row's ciphertext goes on the wire, alongside the per-slot salt and the
 * human-readable slot label. The destination tries to decrypt with its
 * local slot value at request-execute time — when it matches, the value
 * resolves transparently; when it doesn't, the user is prompted via the
 * missing-slots gate (or the new decrypt-mismatch banner). This closes
 * the asymmetry where Git push carried ciphertext but Export-as-JSON
 * stripped it, forcing a manual rebind on every machine.
 *
 * Plain vars round-trip in full (unchanged from v1).
 *
 * The receiving parser accepts both v1 and v2 — older exports continue
 * to import via the prompt-the-user-for-value path. See
 * `@apicircle/core/import/apicircleEnvironment.ts` for the parser
 * surface (`payloadVersion: 1 | 2`).
 */
export function exportEnvironment(synced: WorkspaceSynced, name: string): string | null {
  const env = synced.environments.items[name];
  if (!env) return null;
  const payload = {
    apicircleEnvironment: 2 as const,
    name: env.name,
    variables: env.variables.map((v) => {
      if (v.encrypted && v.secretKeyId) {
        // Surface the slot's user-recognizable label so the importer can
        // match against an existing slot on the destination. The per-slot
        // salt lets the destination derive the same AES-GCM key the
        // source used (PBKDF2 with this salt + the user's slot plaintext
        // value). Falls back to the var key + null salt when slot
        // metadata is missing (defensive — addSecret should have
        // registered it, but lazy-bound rows may pre-date that path).
        const slot = synced.secretKeys?.[v.secretKeyId];
        const label = slot?.label ?? v.key;
        // Carry the ciphertext as-is when the row actually has one. When
        // a row is bound but its value is unexpectedly plain (e.g. legacy
        // pre-encryption rows that survived a partial migration), emit
        // an empty string so the destination still recognises the row as
        // encrypted and prompts for a fresh value.
        const value = typeof v.value === 'string' && v.value.startsWith('enc:') ? v.value : '';
        return {
          key: v.key,
          encrypted: true as const,
          value,
          secretKeyId: v.secretKeyId,
          secret: { label, salt: slot?.salt ?? null },
        };
      }
      return { key: v.key, value: v.value, encrypted: false as const };
    }),
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
