import type { WorkspaceSynced } from '@apicircle/shared';

// 3-way diff for the refresh / pull flow (plan §3.5). The "base" is the
// snapshot from the last successful pull, captured in
// `WorkspaceLocal.sync.lastPulledSnapshot`. We diff each top-level bucket
// of the synced doc against base on both sides; entries that only one
// side touched fast-forward, entries both sides touched in different
// ways become conflicts the user must resolve.

export type DiffStatus = 'unchanged' | 'local-only' | 'remote-only' | 'both-equal' | 'conflict';

export type EntityBucket =
  | 'request'
  | 'folder'
  | 'environment'
  | 'linkedWorkspace'
  | 'mockServer'
  | 'executionPlan'
  | 'secretKey'
  | 'globalSchema'
  | 'globalGraphql'
  | 'linkedRequestOverride'
  | 'linkedEnvOverride'
  | 'releasePerLink'
  | 'tree'
  | 'environmentsActive'
  | 'environmentsPriority'
  | 'releaseSelf'
  | 'secretCrypto';

export interface DiffEntry {
  bucket: EntityBucket;
  /** Entity id within the bucket. Empty string for singleton buckets. */
  key: string;
  status: DiffStatus;
  /** Human-readable label for the resolver UI. */
  label: string;
  base: unknown;
  local: unknown;
  remote: unknown;
}

export interface ThreeWayDiff {
  entries: DiffEntry[];
  conflicts: DiffEntry[];
}

export type ConflictResolution = 'mine' | 'theirs';

/** Map keyed by `bucket:key` (e.g. `request:r-1`, `releaseSelf:`). */
export type ResolutionMap = Record<string, ConflictResolution>;

/**
 * Stable JSON for structural-equality checks. Same replacer the git
 * serializer uses — sorted object keys, arrays preserved verbatim.
 */
function canonicalize(value: unknown): string {
  return JSON.stringify(value, sortedReplacer);
}

function sortedReplacer(this: unknown, _key: string, value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value;
  const proto = Object.getPrototypeOf(value) as object | null;
  if (proto !== Object.prototype && proto !== null) return value;
  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(source).sort()) out[k] = source[k];
  return out;
}

function structurallyEqual(a: unknown, b: unknown): boolean {
  return canonicalize(a) === canonicalize(b);
}

interface DictBucketSpec {
  bucket: EntityBucket;
  // Keys are exposed via the Spec so tests don't have to rebuild it.
  extract(s: WorkspaceSynced): Record<string, unknown>;
  label(key: string, value: unknown): string;
}

interface SingletonSpec {
  bucket: EntityBucket;
  key: string;
  label: string;
  extract(s: WorkspaceSynced): unknown;
}

const dictBuckets: DictBucketSpec[] = [
  {
    bucket: 'request',
    extract: (s) => s.collections.requests,
    label: (key, value) => {
      const v = value as { name?: string } | undefined;
      return v?.name ?? key;
    },
  },
  {
    bucket: 'folder',
    extract: (s) => s.collections.folders,
    label: (key, value) => {
      const v = value as { name?: string } | undefined;
      return v?.name ?? key;
    },
  },
  {
    bucket: 'environment',
    extract: (s) => s.environments.items,
    label: (key) => key,
  },
  {
    bucket: 'linkedWorkspace',
    extract: (s) => s.linkedWorkspaces,
    label: (key, value) => {
      const v = value as { name?: string } | undefined;
      return v?.name ?? key;
    },
  },
  {
    bucket: 'mockServer',
    extract: (s) => s.mockServers,
    label: (key, value) => {
      const v = value as { name?: string } | undefined;
      return v?.name ?? key;
    },
  },
  {
    // Plan definitions live in `synced.executionPlans` post-hydrate. The
    // field is typed optional because pre-migration workspaces persisted
    // plans on `WorkspaceLocal` only; coerce a missing dict to `{}` so the
    // diff engine treats "absent" and "empty" identically.
    bucket: 'executionPlan',
    extract: (s) => s.executionPlans ?? {},
    label: (key, value) => {
      const v = value as { name?: string } | undefined;
      return v?.name ?? key;
    },
  },
  {
    // Secret-key slot metadata (label + KDF salt). Values are device-local
    // and never travel through git — only the slot identity does, so
    // collaborators see consistent labels for the same id.
    bucket: 'secretKey',
    extract: (s) => s.secretKeys ?? {},
    label: (key, value) => {
      const v = value as { label?: string } | undefined;
      return v?.label ?? key;
    },
  },
  {
    // Reusable JSON Schemas registered at workspace scope.
    bucket: 'globalSchema',
    extract: (s) => s.globalAssets.schemas,
    label: (key, value) => {
      const v = value as { name?: string } | undefined;
      return v?.name ?? key;
    },
  },
  {
    // Reusable GraphQL schema docs registered at workspace scope.
    bucket: 'globalGraphql',
    extract: (s) => s.globalAssets.graphql,
    label: (key, value) => {
      const v = value as { name?: string } | undefined;
      return v?.name ?? key;
    },
  },
  {
    // Consumer-side patches to a linked workspace's requests. Keyed
    // `${linkedWorkspaceId}:${requestId}`; the label leans on the key
    // since the override itself doesn't carry a name.
    bucket: 'linkedRequestOverride',
    extract: (s) => s.linkedOverrides.requests,
    label: (key) => `linked request override (${key})`,
  },
  {
    // Per-variable overrides for linked-workspace env vars. Keyed
    // `${linkedWorkspaceId}:${envName}:${varKey}`.
    bucket: 'linkedEnvOverride',
    extract: (s) => s.linkedOverrides.environmentVars,
    label: (key) => `linked env var override (${key})`,
  },
  {
    // Cached release ledgers for each linked workspace. Keyed by
    // linkedWorkspaceId. Refreshes via the link card's "Refresh ledger"
    // surface change here too.
    bucket: 'releasePerLink',
    extract: (s) => s.releases.perLink,
    label: (key) => `linked release ledger (${key})`,
  },
];

const singletons: SingletonSpec[] = [
  { bucket: 'tree', key: '', label: 'Folder tree', extract: (s) => s.collections.tree },
  {
    bucket: 'environmentsActive',
    key: '',
    label: 'Active environment',
    extract: (s) => s.environments.activeName,
  },
  {
    bucket: 'environmentsPriority',
    key: '',
    label: 'Environment priority',
    extract: (s) => s.environments.priorityOrder,
  },
  {
    bucket: 'releaseSelf',
    key: '',
    label: 'Release ledger',
    extract: (s) => s.releases.self,
  },
  {
    // Workspace passphrase metadata (KDF + verifier — never the secret
    // itself). Travels through git so a collaborator who pulls knows the
    // passphrase exists and can prompt for it on first decrypt.
    bucket: 'secretCrypto',
    key: '',
    label: 'Workspace passphrase',
    extract: (s) => s.secretCrypto ?? null,
  },
];

/**
 * Compute the per-entity diff. Returns every entity touched on at least
 * one side, plus a flat list of conflicts (subset of entries with status
 * 'conflict') for the resolver.
 *
 * `base` is the lastPulledSnapshot. When null (first refresh ever), every
 * remote entity that doesn't match local becomes a conflict — there's no
 * shared ancestor to pick a side automatically.
 */
export function computeThreeWayDiff(
  base: WorkspaceSynced | null,
  local: WorkspaceSynced,
  remote: WorkspaceSynced,
): ThreeWayDiff {
  const entries: DiffEntry[] = [];

  for (const spec of dictBuckets) {
    const baseDict = base ? spec.extract(base) : {};
    const localDict = spec.extract(local);
    const remoteDict = spec.extract(remote);
    const allKeys = new Set([
      ...Object.keys(baseDict),
      ...Object.keys(localDict),
      ...Object.keys(remoteDict),
    ]);
    for (const key of allKeys) {
      const b = baseDict[key];
      const l = localDict[key];
      const r = remoteDict[key];
      const status = classify(base !== null, b, l, r);
      if (status === 'unchanged') continue;
      const labelSource = l ?? r ?? b;
      entries.push({
        bucket: spec.bucket,
        key,
        status,
        label: spec.label(key, labelSource),
        base: b,
        local: l,
        remote: r,
      });
    }
  }

  for (const spec of singletons) {
    const b = base ? spec.extract(base) : undefined;
    const l = spec.extract(local);
    const r = spec.extract(remote);
    const status = classify(base !== null, b, l, r);
    if (status === 'unchanged') continue;
    entries.push({
      bucket: spec.bucket,
      key: spec.key,
      status,
      label: spec.label,
      base: b,
      local: l,
      remote: r,
    });
  }

  const conflicts = entries.filter((e) => e.status === 'conflict');
  return { entries, conflicts };
}

function classify(hasBase: boolean, base: unknown, local: unknown, remote: unknown): DiffStatus {
  const localUndef = local === undefined;
  const remoteUndef = remote === undefined;
  if (localUndef && remoteUndef) return 'unchanged';

  // Without a shared base, we can't tell who changed what — anything that
  // doesn't already match becomes a conflict. (Equal values are fine.)
  if (!hasBase) {
    if (structurallyEqual(local, remote)) return 'unchanged';
    if (localUndef) return 'remote-only';
    if (remoteUndef) return 'local-only';
    return 'conflict';
  }

  const localChanged = !structurallyEqual(base, local);
  const remoteChanged = !structurallyEqual(base, remote);
  if (!localChanged && !remoteChanged) return 'unchanged';
  if (!localChanged && remoteChanged) return 'remote-only';
  if (localChanged && !remoteChanged) return 'local-only';
  // Both changed.
  if (structurallyEqual(local, remote)) return 'both-equal';
  return 'conflict';
}

/**
 * Apply a fully-resolved diff: take fast-forwards (remote-only) into
 * local, keep local-only changes verbatim, and resolve every conflict
 * via the supplied `resolutions` map (`bucket:key` → 'mine' | 'theirs').
 *
 * Throws when any conflict is missing a resolution — the caller is
 * expected to populate the modal first.
 */
export function applyMerge(
  local: WorkspaceSynced,
  remote: WorkspaceSynced,
  diff: ThreeWayDiff,
  resolutions: ResolutionMap,
): WorkspaceSynced {
  let merged: WorkspaceSynced = local;
  for (const entry of diff.entries) {
    const id = `${entry.bucket}:${entry.key}`;
    let chosen: 'mine' | 'theirs';
    if (entry.status === 'remote-only') {
      chosen = 'theirs';
    } else if (entry.status === 'local-only' || entry.status === 'both-equal') {
      chosen = 'mine';
    } else {
      const r = resolutions[id];
      if (!r) throw new Error(`Missing resolution for ${id}`);
      chosen = r;
    }
    merged = applyEntry(merged, remote, entry, chosen);
  }
  return merged;
}

/**
 * Distinguishes the two outcomes a merge can have for a dict entry:
 *   - `upsert` — the entry now exists in the dict (added or modified).
 *               `parent` tells us if it belongs at root or inside a folder.
 *   - `remove` — the entry was deleted from the dict.
 * Without this discriminator, "value === undefined" can't be told apart from
 * "value present with parent === null" — and root-level deletes would silently
 * get re-added by the reconciler.
 */
type TreeOp = { kind: 'upsert'; parent: string | null } | { kind: 'remove' };

/**
 * Keep `tree.children` consistent with the requests/folders dict when a
 * merge inserts, modifies, or removes an entry. The sidebar derives the
 * visible list from two parallel sources — `tree.children` (root) and
 * `folderId/parentId` chains (nested). Without this reconciliation, a
 * pull that adds a top-level request leaves the dict updated but the
 * tree untouched, so the request becomes an "orphan" — present in the
 * unpushed-changes strip but invisible in the editor sidebar.
 *
 * Cases handled:
 *   - upsert at root: add to tree.children if missing
 *   - upsert nested: strip any stale root reference (entry can't be in two
 *     places at once)
 *   - remove: strip from tree.children if present
 */
function reconcileTreeForEntry(
  tree: WorkspaceSynced['collections']['tree'],
  kind: 'folder' | 'request',
  id: string,
  op: TreeOp,
): WorkspaceSynced['collections']['tree'] {
  const inTree = tree.children.some((c) => c.kind === kind && c.id === id);
  if (op.kind === 'upsert' && op.parent === null) {
    if (inTree) return tree;
    return { ...tree, children: [...tree.children, { kind, id }] };
  }
  // Nested upsert OR remove: ensure no stale root reference.
  if (!inTree) return tree;
  return {
    ...tree,
    children: tree.children.filter((c) => !(c.kind === kind && c.id === id)),
  };
}

function applyEntry(
  local: WorkspaceSynced,
  remote: WorkspaceSynced,
  entry: DiffEntry,
  chosen: 'mine' | 'theirs',
): WorkspaceSynced {
  if (chosen === 'mine') return local;
  // chosen === 'theirs': overwrite the entity in `local` with the remote value.
  const value = entry.remote;
  switch (entry.bucket) {
    case 'request': {
      const requests = { ...local.collections.requests };
      const treeOp: TreeOp =
        value === undefined
          ? { kind: 'remove' }
          : { kind: 'upsert', parent: (value as { folderId: string | null }).folderId ?? null };
      if (value === undefined) delete requests[entry.key];
      else requests[entry.key] = value as (typeof requests)[string];
      const tree = reconcileTreeForEntry(local.collections.tree, 'request', entry.key, treeOp);
      return { ...local, collections: { ...local.collections, requests, tree } };
    }
    case 'folder': {
      const folders = { ...local.collections.folders };
      const treeOp: TreeOp =
        value === undefined
          ? { kind: 'remove' }
          : { kind: 'upsert', parent: (value as { parentId: string | null }).parentId ?? null };
      if (value === undefined) delete folders[entry.key];
      else folders[entry.key] = value as (typeof folders)[string];
      const tree = reconcileTreeForEntry(local.collections.tree, 'folder', entry.key, treeOp);
      return { ...local, collections: { ...local.collections, folders, tree } };
    }
    case 'environment': {
      const items = { ...local.environments.items };
      if (value === undefined) delete items[entry.key];
      else items[entry.key] = value as (typeof items)[string];
      return { ...local, environments: { ...local.environments, items } };
    }
    case 'linkedWorkspace': {
      const linkedWorkspaces = { ...local.linkedWorkspaces };
      if (value === undefined) delete linkedWorkspaces[entry.key];
      else linkedWorkspaces[entry.key] = value as (typeof linkedWorkspaces)[string];
      return { ...local, linkedWorkspaces };
    }
    case 'mockServer': {
      const mockServers = { ...local.mockServers };
      if (value === undefined) delete mockServers[entry.key];
      else mockServers[entry.key] = value as (typeof mockServers)[string];
      return { ...local, mockServers };
    }
    case 'executionPlan': {
      // executionPlans is optional in the type — start from `{}` rather
      // than `undefined` so we never write a non-dict value back.
      const executionPlans = { ...(local.executionPlans ?? {}) };
      if (value === undefined) delete executionPlans[entry.key];
      else
        executionPlans[entry.key] = value as NonNullable<WorkspaceSynced['executionPlans']>[string];
      return { ...local, executionPlans };
    }
    case 'secretKey': {
      // secretKeys is optional in the type — coerce missing to {} so a
      // remote that hasn't ever populated the field doesn't smuggle in
      // an undefined.
      const secretKeys = { ...(local.secretKeys ?? {}) };
      if (value === undefined) delete secretKeys[entry.key];
      else secretKeys[entry.key] = value as NonNullable<WorkspaceSynced['secretKeys']>[string];
      return { ...local, secretKeys };
    }
    case 'globalSchema': {
      const schemas = { ...local.globalAssets.schemas };
      if (value === undefined) delete schemas[entry.key];
      else schemas[entry.key] = value as (typeof schemas)[string];
      return { ...local, globalAssets: { ...local.globalAssets, schemas } };
    }
    case 'globalGraphql': {
      const graphql = { ...local.globalAssets.graphql };
      if (value === undefined) delete graphql[entry.key];
      else graphql[entry.key] = value as (typeof graphql)[string];
      return { ...local, globalAssets: { ...local.globalAssets, graphql } };
    }
    case 'linkedRequestOverride': {
      const requests = { ...local.linkedOverrides.requests };
      if (value === undefined) delete requests[entry.key];
      else requests[entry.key] = value as (typeof requests)[string];
      return { ...local, linkedOverrides: { ...local.linkedOverrides, requests } };
    }
    case 'linkedEnvOverride': {
      const environmentVars = { ...local.linkedOverrides.environmentVars };
      if (value === undefined) delete environmentVars[entry.key];
      else environmentVars[entry.key] = value as (typeof environmentVars)[string];
      return { ...local, linkedOverrides: { ...local.linkedOverrides, environmentVars } };
    }
    case 'releasePerLink': {
      const perLink = { ...local.releases.perLink };
      if (value === undefined) delete perLink[entry.key];
      else perLink[entry.key] = value as (typeof perLink)[string];
      return { ...local, releases: { ...local.releases, perLink } };
    }
    case 'tree':
      return { ...local, collections: { ...local.collections, tree: remote.collections.tree } };
    case 'environmentsActive':
      return {
        ...local,
        environments: { ...local.environments, activeName: remote.environments.activeName },
      };
    case 'environmentsPriority':
      return {
        ...local,
        environments: {
          ...local.environments,
          priorityOrder: remote.environments.priorityOrder,
        },
      };
    case 'releaseSelf':
      return { ...local, releases: { ...local.releases, self: remote.releases.self } };
    case 'secretCrypto':
      return { ...local, secretCrypto: remote.secretCrypto ?? null };
  }
}
