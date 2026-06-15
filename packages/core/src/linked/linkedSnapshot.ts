import type {
  LinkedSnapshot,
  LinkedWorkspace,
  ReleaseHistory,
  SecretKeyMeta,
  WorkspaceSynced,
} from '@apicircle/shared';

// =============================================================================
// Linked-workspace snapshot helpers — the PURE half of the link/refresh flow.
//
// `parseLinkedWorkspaceJson` decodes a remote `.apicircle/workspace-<id>/workspace.json`
// (fetched over the GitHub API by the host) into the slices a consumer needs:
// the release ledger, the collections + environments tree, the secret-key
// registry, and the global-asset library. `buildLinkedSnapshot` turns that +
// the link record into the `LinkedSnapshot` cached in
// `WorkspaceLocal.linkedCollections`.
//
// Both are pure + network-free so the UI store, the VS Code extension, and the
// CLI share one implementation. The network fetch + applyMutation write live
// in the caller.
// =============================================================================

export interface LinkedWorkspaceProbe {
  workspaceId?: string;
  releases?: { self?: ReleaseHistory | null };
  collections?: WorkspaceSynced['collections'];
  environments?: WorkspaceSynced['environments'];
  secretKeys?: Record<string, SecretKeyMeta>;
  globalAssets?: WorkspaceSynced['globalAssets'];
}

const LINKED_FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_LINKED_JSON_BYTES = 16 * 1024 * 1024;

/**
 * Parse + sanitize a remote workspace.json string into the slices a linked
 * consumer reads. Throws on oversized input, invalid JSON, or a non-object
 * root. Prototype-pollution keys are stripped at parse time.
 */
export function parseLinkedWorkspaceJson(text: string): LinkedWorkspaceProbe {
  if (text.length > MAX_LINKED_JSON_BYTES) {
    throw new Error('Remote workspace.json exceeds 16 MiB');
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text, (key: string, value: unknown) =>
      LINKED_FORBIDDEN_KEYS.has(key) ? undefined : value,
    );
  } catch {
    throw new Error('Remote workspace.json is not valid JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('Remote workspace.json is not an object');
  }
  const obj = raw as Record<string, unknown>;
  const asObject = <T>(v: unknown): T | undefined =>
    typeof v === 'object' && v !== null ? (v as T) : undefined;
  return {
    workspaceId: typeof obj.workspaceId === 'string' ? obj.workspaceId : undefined,
    releases: asObject<{ self?: ReleaseHistory | null }>(obj.releases),
    collections: asObject<WorkspaceSynced['collections']>(obj.collections),
    environments: asObject<WorkspaceSynced['environments']>(obj.environments),
    secretKeys: asObject<Record<string, SecretKeyMeta>>(obj.secretKeys),
    globalAssets: asObject<WorkspaceSynced['globalAssets']>(obj.globalAssets),
  };
}

/** The cached ledger from a probe, defaulting to an empty ledger. */
export function ledgerFromProbe(parsed: LinkedWorkspaceProbe): ReleaseHistory {
  return parsed.releases?.self ?? { versions: [], currentVersion: null };
}

/**
 * Build the `LinkedSnapshot` cached in `WorkspaceLocal.linkedCollections` from
 * a parsed probe + the link record. Returns null when the source has neither
 * collections nor environments to cache.
 */
export function buildLinkedSnapshot(
  parsed: LinkedWorkspaceProbe,
  link: LinkedWorkspace,
): LinkedSnapshot | null {
  if (!parsed.collections && !parsed.environments) return null;
  return {
    pulledAt: link.linkedAt,
    ref: link.pinnedVersion ? `v${link.pinnedVersion}` : `HEAD@${link.source.branch}`,
    collections: parsed.collections ?? {
      tree: { id: 'remote-root', type: 'root', children: [] },
      requests: {},
      folders: {},
    },
    environments: parsed.environments ?? {
      items: {},
      activeName: null,
      priorityOrder: [],
    },
    ...(parsed.secretKeys ? { secretKeys: parsed.secretKeys } : {}),
    ...(parsed.globalAssets ? { globalAssets: parsed.globalAssets } : {}),
  };
}
