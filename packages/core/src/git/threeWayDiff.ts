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
  | 'workspaceName'
  | 'tree'
  | 'environmentsActive'
  | 'environmentsPriority'
  | 'releaseSelf';

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
];

const singletons: SingletonSpec[] = [
  {
    bucket: 'workspaceName',
    key: '',
    label: 'Workspace name',
    extract: (s) => s.workspaceName,
  },
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
      if (value === undefined) delete requests[entry.key];
      else requests[entry.key] = value as (typeof requests)[string];
      return { ...local, collections: { ...local.collections, requests } };
    }
    case 'folder': {
      const folders = { ...local.collections.folders };
      if (value === undefined) delete folders[entry.key];
      else folders[entry.key] = value as (typeof folders)[string];
      return { ...local, collections: { ...local.collections, folders } };
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
    case 'workspaceName':
      return { ...local, workspaceName: remote.workspaceName };
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
  }
}
