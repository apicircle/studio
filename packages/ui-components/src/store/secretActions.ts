import { applyLinkedEnvironmentOverrides } from '@apicircle/core';
import type {
  Environment,
  SecretEntry,
  SecretKeyMeta,
  WorkspaceLocal,
  WorkspaceSynced,
} from '@apicircle/shared';

// Pure reducers for the cross-workspace Secret Vault index. The encrypted
// payload itself lives in the secrets IDB store (see persistence/secrets.ts);
// these reducers manage the metadata in `WorkspaceLocal.secretIndex`.

/**
 * Slot id → the label `{{LABEL}}` names it by: the synced slot records, with
 * this device's vault index (which also holds linked and host-token entries)
 * on top. A slot is an encryption key whether or not this device has its
 * value, so the synced records count too. Feeds `findEncryptionKeys`.
 */
export function vaultSlotLabels(
  secretKeys: Readonly<Record<string, SecretKeyMeta>> | undefined,
  entries: Readonly<Record<string, SecretEntry>> | undefined,
): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const [id, meta] of Object.entries(secretKeys ?? {})) labels[id] = meta.label;
  for (const [id, entry] of Object.entries(entries ?? {})) labels[id] = entry.label;
  return labels;
}

/**
 * Every set of environments whose encrypted variables can bind a slot of this
 * workspace: its own (`linkedWorkspaceId: null`), and each linked workspace's
 * once the consumer's overrides (which can bind a variable to a slot) are
 * applied. Each set names the link it came from, so the Vault's "Used in" can
 * say where a bound variable lives.
 */
export function slotBindingEnvironmentSets(
  synced: WorkspaceSynced,
  linkedCollections: WorkspaceLocal['linkedCollections'],
): Array<{ linkedWorkspaceId: string | null; items: Record<string, Environment> }> {
  const sets: Array<{ linkedWorkspaceId: string | null; items: Record<string, Environment> }> = [
    { linkedWorkspaceId: null, items: synced.environments.items },
  ];
  for (const [linkId, snapshot] of Object.entries(linkedCollections)) {
    sets.push({
      linkedWorkspaceId: linkId,
      items: applyLinkedEnvironmentOverrides(snapshot.environments, linkId, synced).items,
    });
  }
  return sets;
}

/**
 * The sets of `slotBindingEnvironmentSets`, without their links. Feeds
 * `findEncryptionKeys`, the same sets a send resolves against.
 */
export function slotBindingEnvironments(
  synced: WorkspaceSynced,
  linkedCollections: WorkspaceLocal['linkedCollections'],
): Array<Record<string, Environment>> {
  return slotBindingEnvironmentSets(synced, linkedCollections).map((set) => set.items);
}

export function addSecretEntry(
  local: WorkspaceLocal,
  args: {
    id: string;
    label: string;
    origin?: 'workspace' | 'linked';
    linkedWorkspaceId?: string;
    linkedKeyId?: string;
  },
): WorkspaceLocal {
  const trimmed = args.label.trim();
  if (!trimmed) return local;
  // Labels must be unique within the index — they're how requests reference
  // secrets via {{LABEL}} placeholders.
  if (Object.values(local.secretIndex.entries).some((e) => e.label === trimmed)) return local;

  const entry: SecretEntry = {
    id: args.id,
    label: trimmed,
    createdAt: new Date().toISOString(),
    origin: args.origin ?? 'workspace',
    linkedWorkspaceId: args.linkedWorkspaceId,
    linkedKeyId: args.linkedKeyId,
    usedIn: [],
  };
  return {
    ...local,
    secretIndex: {
      ...local.secretIndex,
      entries: { ...local.secretIndex.entries, [args.id]: entry },
    },
  };
}

export function removeSecretEntry(local: WorkspaceLocal, id: string): WorkspaceLocal {
  if (!local.secretIndex.entries[id]) return local;
  const entries = { ...local.secretIndex.entries };
  delete entries[id];
  return {
    ...local,
    secretIndex: { ...local.secretIndex, entries },
  };
}

export function renameSecretEntry(
  local: WorkspaceLocal,
  id: string,
  newLabel: string,
): WorkspaceLocal {
  const trimmed = newLabel.trim();
  const existing = local.secretIndex.entries[id];
  if (!existing || !trimmed || existing.label === trimmed) return local;
  // Block label collisions with other entries.
  if (Object.values(local.secretIndex.entries).some((e) => e.id !== id && e.label === trimmed))
    return local;
  return {
    ...local,
    secretIndex: {
      ...local.secretIndex,
      entries: {
        ...local.secretIndex.entries,
        [id]: { ...existing, label: trimmed },
      },
    },
  };
}

export function setSecretUsedIn(
  local: WorkspaceLocal,
  id: string,
  usedIn: SecretEntry['usedIn'],
): WorkspaceLocal {
  const existing = local.secretIndex.entries[id];
  if (!existing) return local;
  return {
    ...local,
    secretIndex: {
      ...local.secretIndex,
      entries: {
        ...local.secretIndex.entries,
        [id]: { ...existing, usedIn },
      },
    },
  };
}

/**
 * Apply usedIn updates for many entries in one pass. The aggregator computes
 * a fresh map; this reducer stamps it onto the local doc atomically.
 */
export function applyUsedInMap(
  local: WorkspaceLocal,
  byId: Record<string, SecretEntry['usedIn']>,
): WorkspaceLocal {
  const entries: Record<string, SecretEntry> = { ...local.secretIndex.entries };
  let changed = false;
  for (const [id, usedIn] of Object.entries(byId)) {
    const existing = entries[id];
    if (!existing) continue;
    if (areUsedInEqual(existing.usedIn, usedIn)) continue;
    entries[id] = { ...existing, usedIn };
    changed = true;
  }
  if (!changed) return local;
  return { ...local, secretIndex: { ...local.secretIndex, entries } };
}

function areUsedInEqual(a: SecretEntry['usedIn'], b: SecretEntry['usedIn']): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x.kind !== y.kind || x.id !== y.id || x.label !== y.label) return false;
  }
  return true;
}
