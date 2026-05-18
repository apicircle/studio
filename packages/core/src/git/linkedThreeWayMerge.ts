// Three-way merge for linked-workspace updates.
//
// When a consumer wants to bump their pinned version of a linked workspace
// to a newer one, we classify every request / env-var / folder against
// THREE inputs:
//
//   • base     — the consumer's currently-pinned snapshot of the source.
//   • target   — the source's published snapshot at the new version.
//   • override — the consumer's local modifications (only requests +
//                env-vars carry overrides; folders are source-pinned).
//
// Each entity gets one status:
//
//   unchanged          base ≡ target AND no override   → no-op
//   source-only        base ≠ target AND no override   → fast-forward
//   local-only         base ≡ target AND override      → keep mine
//   both-changed       base ≠ target AND override      → user picks
//   new-in-source      base missing, target present    → adopt new entity
//   removed-in-source  base present, target missing    → orphan
//
// "both-changed" intentionally lumps clean-merge and conflict together
// for the first cut — letting the user explicitly accept-source or
// keep-mine is loud and safe. Auto-merging non-overlapping field edits
// is a follow-on slice (lands cleanly on top of this same data shape).

import type {
  EnvironmentVariable,
  EnvironmentVariableOverride,
  Folder,
  LinkedSnapshot,
  Request as ApiRequest,
  RequestOverride,
} from '@apicircle/shared';

export type LinkedUpdateStatus =
  | 'unchanged'
  | 'source-only'
  | 'local-only'
  | 'both-changed'
  | 'new-in-source'
  | 'removed-in-source';

export type LinkedUpdateBucket = 'request' | 'folder' | 'environment-var';

export interface LinkedUpdateEntry<TBase = unknown, TTarget = unknown, TOverride = unknown> {
  bucket: LinkedUpdateBucket;
  /** Identifier scoped to the bucket. For env-var, format `<envName>:<varKey>`. */
  key: string;
  label: string;
  status: LinkedUpdateStatus;
  base: TBase | null;
  target: TTarget | null;
  override: TOverride | null;
}

export interface LinkedUpdatePreview {
  fromVersion: string | null;
  toVersion: string;
  entries: LinkedUpdateEntry[];
  /** Quick counts for the modal summary line. */
  summary: Record<LinkedUpdateStatus, number>;
}

export interface PreviewArgs {
  fromVersion: string | null;
  toVersion: string;
  base: LinkedSnapshot | null;
  target: LinkedSnapshot;
  /** All request overrides keyed by `${linkedWorkspaceId}:${itemId}` — caller pre-filters to one link. */
  requestOverrides: RequestOverride[];
  /** All env-var overrides for this link. */
  envVarOverrides: EnvironmentVariableOverride[];
}

/**
 * Pure function — returns a structured preview of every change between
 * `base` and `target`, classified by status and annotated with the
 * consumer's overrides where applicable. Caller renders the modal and
 * collects resolutions for `both-changed` entries.
 */
export function previewLinkedUpdate(args: PreviewArgs): LinkedUpdatePreview {
  const entries: LinkedUpdateEntry[] = [];

  // --- Requests ----------------------------------------------------------
  const baseRequests = args.base?.collections.requests ?? {};
  const targetRequests = args.target.collections.requests;
  const overrideByItem = new Map<string, RequestOverride>(
    args.requestOverrides.map((o) => [o.itemId, o]),
  );
  const allRequestIds = new Set([...Object.keys(baseRequests), ...Object.keys(targetRequests)]);
  for (const id of allRequestIds) {
    const base = baseRequests[id] ?? null;
    const target = targetRequests[id] ?? null;
    const override = overrideByItem.get(id) ?? null;
    const status = classifyRequest(base, target, override);
    if (status === 'unchanged') continue;
    entries.push({
      bucket: 'request',
      key: id,
      label: target?.name ?? base?.name ?? id,
      status,
      base,
      target,
      override,
    });
  }

  // --- Folders -----------------------------------------------------------
  // Folders aren't overridable today — every change is either source-only
  // (consumer adopts) or removed-in-source (orphan). They always classify
  // cleanly without a user decision.
  const baseFolders = args.base?.collections.folders ?? {};
  const targetFolders = args.target.collections.folders;
  const allFolderIds = new Set([...Object.keys(baseFolders), ...Object.keys(targetFolders)]);
  for (const id of allFolderIds) {
    const base = baseFolders[id] ?? null;
    const target = targetFolders[id] ?? null;
    const status = classifyFolder(base, target);
    if (status === 'unchanged') continue;
    entries.push({
      bucket: 'folder',
      key: id,
      label: target?.name ?? base?.name ?? id,
      status,
      base,
      target,
      override: null,
    });
  }

  // --- Environment variables --------------------------------------------
  const baseEnvs = args.base?.environments.items ?? {};
  const targetEnvs = args.target.environments.items;
  const allEnvNames = new Set([...Object.keys(baseEnvs), ...Object.keys(targetEnvs)]);
  for (const envName of allEnvNames) {
    const baseVars = baseEnvs[envName]?.variables ?? [];
    const targetVars = targetEnvs[envName]?.variables ?? [];
    const overrides = args.envVarOverrides.filter((o) => o.envName === envName);
    const allKeys = new Set<string>([
      ...baseVars.map((v) => v.key),
      ...targetVars.map((v) => v.key),
      ...overrides.map((o) => o.varKey),
    ]);
    const baseByKey = new Map(baseVars.map((v) => [v.key, v]));
    const targetByKey = new Map(targetVars.map((v) => [v.key, v]));
    const overrideByKey = new Map(overrides.map((o) => [o.varKey, o]));
    for (const varKey of allKeys) {
      const base = baseByKey.get(varKey) ?? null;
      const target = targetByKey.get(varKey) ?? null;
      const override = overrideByKey.get(varKey) ?? null;
      const status = classifyEnvVar(base, target, override);
      if (status === 'unchanged') continue;
      entries.push({
        bucket: 'environment-var',
        key: `${envName}:${varKey}`,
        label: `${envName} → ${varKey}`,
        status,
        base,
        target,
        override,
      });
    }
  }

  const summary: Record<LinkedUpdateStatus, number> = {
    unchanged: 0,
    'source-only': 0,
    'local-only': 0,
    'both-changed': 0,
    'new-in-source': 0,
    'removed-in-source': 0,
  };
  for (const e of entries) summary[e.status] += 1;

  return {
    fromVersion: args.fromVersion,
    toVersion: args.toVersion,
    entries,
    summary,
  };
}

function classifyRequest(
  base: ApiRequest | null,
  target: ApiRequest | null,
  override: RequestOverride | null,
): LinkedUpdateStatus {
  if (!base && target) return 'new-in-source';
  if (base && !target) return 'removed-in-source';
  if (!base || !target) return 'unchanged';
  const sourceChanged = !structurallyEqual(base, target);
  const hasOverride = override !== null && Object.keys(override.patch).length > 0;
  if (!sourceChanged && !hasOverride) return 'unchanged';
  if (!sourceChanged && hasOverride) return 'local-only';
  if (sourceChanged && !hasOverride) return 'source-only';
  return 'both-changed';
}

function classifyFolder(base: Folder | null, target: Folder | null): LinkedUpdateStatus {
  if (!base && target) return 'new-in-source';
  if (base && !target) return 'removed-in-source';
  if (!base || !target) return 'unchanged';
  return structurallyEqual(base, target) ? 'unchanged' : 'source-only';
}

function classifyEnvVar(
  base: EnvironmentVariable | null,
  target: EnvironmentVariable | null,
  override: EnvironmentVariableOverride | null,
): LinkedUpdateStatus {
  // Consumer-only addition (no source counterpart, override exists, not removed).
  if (!base && !target && override && !override.removed) return 'local-only';
  if (!base && target) return 'new-in-source';
  if (base && !target) return 'removed-in-source';
  if (!base || !target) return 'unchanged';
  const sourceChanged = !structurallyEqual(base, target);
  const hasOverride = override !== null;
  if (!sourceChanged && !hasOverride) return 'unchanged';
  if (!sourceChanged && hasOverride) return 'local-only';
  if (sourceChanged && !hasOverride) return 'source-only';
  return 'both-changed';
}

/**
 * Map status → 'mine' | 'theirs' for entries the user has resolved.
 * 'mine' = keep the override / orphan. 'theirs' = adopt source.
 *
 * `source-only`, `new-in-source`, and `local-only` don't need a
 * resolution (auto-applied), so this map is keyed only by entries that
 * are `both-changed` or `removed-in-source` (the latter optionally lets
 * the user keep their override as a consumer-only request — a rarer
 * choice).
 */
export type LinkedUpdateResolutionMap = Record<string, 'mine' | 'theirs'>;

export interface ApplyArgs {
  base: LinkedSnapshot | null;
  target: LinkedSnapshot;
  preview: LinkedUpdatePreview;
  resolutions: LinkedUpdateResolutionMap;
  /** All overrides for this link, BEFORE the apply. */
  requestOverrides: RequestOverride[];
  envVarOverrides: EnvironmentVariableOverride[];
}

export interface ApplyResult {
  /** New canonical snapshot to cache (replaces base). */
  nextSnapshot: LinkedSnapshot;
  /** Override entries the consumer keeps after applying. */
  nextRequestOverrides: RequestOverride[];
  nextEnvVarOverrides: EnvironmentVariableOverride[];
  /** Per-entry record of what we did, surfaced to the toast / activity log. */
  log: Array<{ entryKey: string; bucket: LinkedUpdateBucket; action: string }>;
}

/**
 * Apply a fully-resolved preview. Pure — does not touch IDB or the store.
 *
 * Throws when any `both-changed` entry is missing a resolution.
 */
export function applyLinkedUpdate(args: ApplyArgs): ApplyResult {
  const log: ApplyResult['log'] = [];
  const requestOverridesByItem = new Map<string, RequestOverride>(
    args.requestOverrides.map((o) => [o.itemId, o]),
  );
  const envVarOverridesByKey = new Map<string, EnvironmentVariableOverride>(
    args.envVarOverrides.map((o) => [`${o.envName}:${o.varKey}`, o]),
  );

  for (const entry of args.preview.entries) {
    const id = `${entry.bucket}:${entry.key}`;
    if (entry.status === 'unchanged') continue;
    if (entry.status === 'source-only' || entry.status === 'new-in-source') {
      // Adopting target — nothing to do beyond replacing the snapshot.
      log.push({ entryKey: id, bucket: entry.bucket, action: 'adopt-source' });
      continue;
    }
    if (entry.status === 'local-only') {
      log.push({ entryKey: id, bucket: entry.bucket, action: 'keep-mine' });
      continue;
    }

    if (entry.status === 'removed-in-source') {
      // Default for orphans is to drop the override (nothing to override
      // if the source request is gone). Consumer can opt-in to keeping it
      // by supplying a 'mine' resolution explicitly.
      const choice = args.resolutions[id] ?? 'theirs';
      if (choice === 'theirs') {
        if (entry.bucket === 'request') requestOverridesByItem.delete(entry.key);
        else if (entry.bucket === 'environment-var') envVarOverridesByKey.delete(entry.key);
        log.push({ entryKey: id, bucket: entry.bucket, action: 'drop-orphan' });
      } else {
        log.push({ entryKey: id, bucket: entry.bucket, action: 'keep-orphan' });
      }
      continue;
    }

    if (entry.status === 'both-changed') {
      const choice = args.resolutions[id];
      if (!choice) {
        throw new Error(
          `applyLinkedUpdate: unresolved both-changed entry "${entry.label}" (${id})`,
        );
      }
      if (choice === 'theirs') {
        if (entry.bucket === 'request') requestOverridesByItem.delete(entry.key);
        else if (entry.bucket === 'environment-var') envVarOverridesByKey.delete(entry.key);
        log.push({ entryKey: id, bucket: entry.bucket, action: 'accept-source' });
      } else {
        log.push({ entryKey: id, bucket: entry.bucket, action: 'keep-mine' });
      }
    }
  }

  return {
    nextSnapshot: args.target,
    nextRequestOverrides: [...requestOverridesByItem.values()],
    nextEnvVarOverrides: [...envVarOverridesByKey.values()],
    log,
  };
}

/**
 * Stable structural equality. JSON.stringify is good enough here because
 * every diffable field is a plain JSON value (no Dates, no class
 * instances, no functions). Object key ordering is preserved by V8's
 * insertion-order semantics for string keys.
 *
 * The `serializeWorkspace` canonical sort happens at push time, not at
 * diff time — this is intra-doc comparison, not byte equality with git.
 */
function structurallyEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
