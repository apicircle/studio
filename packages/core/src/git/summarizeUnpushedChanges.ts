import type { WorkspaceSynced } from '@apicircle/shared';
import { redactForGit } from './redactWorkspace';
import { type EntityBucket, computeThreeWayDiff } from './threeWayDiff';

// Pre-push diff summary: compares the consumer's currently-edited synced
// doc against the last-pulled snapshot to enumerate every uncommitted
// change. Powers the BranchCard's "+N added · ~M modified · -K removed"
// strip (B.3) and the side-by-side preview modal beneath it.
//
// Pure — caller decides when to recompute (typically on every store
// mutation; cheap enough to skip debouncing for typical workspace
// sizes).

export interface UnpushedChange {
  bucket: EntityBucket;
  /** Entity id within the bucket; empty string for singletons (tree, etc.). */
  key: string;
  label: string;
  kind: 'added' | 'modified' | 'removed';
  base: unknown;
  local: unknown;
}

export interface UnpushedSummary {
  added: number;
  modified: number;
  removed: number;
  total: number;
  /** Per-entry list, sorted by bucket then label so the preview list renders predictably. */
  changes: UnpushedChange[];
  computedAt: string;
}

const BUCKET_ORDER: EntityBucket[] = [
  'tree',
  'request',
  'folder',
  'environment',
  'environmentsActive',
  'environmentsPriority',
  'linkedWorkspace',
  'linkedRequestOverride',
  'linkedEnvOverride',
  'mockServer',
  'executionPlan',
  'globalSchema',
  'globalGraphql',
  'globalFile',
  'secretKey',
  'secretCrypto',
  'releaseSelf',
  'releasePerLink',
];

const EMPTY_SUMMARY: UnpushedSummary = {
  added: 0,
  modified: 0,
  removed: 0,
  total: 0,
  changes: [],
  computedAt: new Date(0).toISOString(),
};

export function summarizeUnpushedChanges(
  base: WorkspaceSynced | null,
  current: WorkspaceSynced,
  options: { now?: () => Date } = {},
): UnpushedSummary {
  const now = options.now ?? (() => new Date());
  // The push path writes a redacted workspace.json. Compare the same synced
  // intent here so local-only credential values do not appear as phantom
  // unpushed changes after a refresh/merge preserves them in memory.
  const gitCurrent = redactForGit(current);
  if (!base) {
    // No upstream yet (workspace was just created or never pulled).
    // Everything in `current` counts as "added" — walking the buckets
    // directly is simpler than feeding an empty-shape doc to the diff
    // engine.
    return summarizeAllAsAdded(gitCurrent, now().toISOString());
  }
  // Reuse the existing 3-way diff with `remote = base` so every entry
  // is either 'unchanged' or 'local-only'. We then translate
  // 'local-only' into added / modified / removed by inspecting which of
  // base / local is undefined.
  const gitBase = redactForGit(base);
  const diff = computeThreeWayDiff(gitBase, gitCurrent, gitBase);
  const changes: UnpushedChange[] = [];
  for (const entry of diff.entries) {
    if (entry.status !== 'local-only') continue;
    // Treat null and undefined alike as "absent" for kind classification.
    // The `releaseSelf` singleton extracts to `null` when no ledger
    // exists — without nullish-aware logic, the first publish (null →
    // ledger) gets labeled "modified" instead of "added", which the
    // strip then under-counts in its "+N added" badge.
    const baseAbsent = entry.base === undefined || entry.base === null;
    const localAbsent = entry.local === undefined || entry.local === null;
    let kind: UnpushedChange['kind'];
    if (baseAbsent && !localAbsent) kind = 'added';
    else if (!baseAbsent && localAbsent) kind = 'removed';
    else kind = 'modified';
    changes.push({
      bucket: entry.bucket,
      key: entry.key,
      label: entry.label,
      kind,
      base: entry.base,
      local: entry.local,
    });
  }
  return finalize(changes, now().toISOString());
}

/**
 * Cheap "anything to push?" check for the BranchCard badge. Avoids
 * recomputing the full preview list when the caller only needs a
 * boolean. Identity short-circuits on referential equality of `current`
 * and `base` — common when the store hasn't mutated since pull.
 */
export function hasUnpushedChanges(
  base: WorkspaceSynced | null,
  current: WorkspaceSynced,
): boolean {
  if (current === base) return false;
  return summarizeUnpushedChanges(base, current).total > 0;
}

function summarizeAllAsAdded(synced: WorkspaceSynced, computedAt: string): UnpushedSummary {
  const changes: UnpushedChange[] = [];
  for (const [id, req] of Object.entries(synced.collections.requests)) {
    changes.push({
      bucket: 'request',
      key: id,
      label: req.name || id,
      kind: 'added',
      base: undefined,
      local: req,
    });
  }
  for (const [id, folder] of Object.entries(synced.collections.folders)) {
    changes.push({
      bucket: 'folder',
      key: id,
      label: folder.name || id,
      kind: 'added',
      base: undefined,
      local: folder,
    });
  }
  for (const [name, env] of Object.entries(synced.environments.items)) {
    changes.push({
      bucket: 'environment',
      key: name,
      label: name,
      kind: 'added',
      base: undefined,
      local: env,
    });
  }
  for (const [id, link] of Object.entries(synced.linkedWorkspaces)) {
    changes.push({
      bucket: 'linkedWorkspace',
      key: id,
      label: link.name || id,
      kind: 'added',
      base: undefined,
      local: link,
    });
  }
  for (const [id, server] of Object.entries(synced.mockServers)) {
    changes.push({
      bucket: 'mockServer',
      key: id,
      label: server.name || id,
      kind: 'added',
      base: undefined,
      local: server,
    });
  }
  // executionPlans is optional in the synced doc — pre-migration workspaces
  // may not have hydrated it yet. Treat absent as the empty dict (no plans
  // to report) rather than crashing on Object.entries(undefined).
  for (const [id, plan] of Object.entries(synced.executionPlans ?? {})) {
    changes.push({
      bucket: 'executionPlan',
      key: id,
      label: plan.name || id,
      kind: 'added',
      base: undefined,
      local: plan,
    });
  }
  // secretKeys is also optional pre-migration; same treatment as plans.
  for (const [id, meta] of Object.entries(synced.secretKeys ?? {})) {
    changes.push({
      bucket: 'secretKey',
      key: id,
      label: meta.label || id,
      kind: 'added',
      base: undefined,
      local: meta,
    });
  }
  for (const [id, schema] of Object.entries(synced.globalAssets.schemas)) {
    changes.push({
      bucket: 'globalSchema',
      key: id,
      label: schema.name || id,
      kind: 'added',
      base: undefined,
      local: schema,
    });
  }
  for (const [id, gql] of Object.entries(synced.globalAssets.graphql)) {
    changes.push({
      bucket: 'globalGraphql',
      key: id,
      label: gql.name || id,
      kind: 'added',
      base: undefined,
      local: gql,
    });
  }
  for (const [id, file] of Object.entries(synced.globalAssets.files ?? {})) {
    changes.push({
      bucket: 'globalFile',
      key: id,
      label: file.name || file.filename || id,
      kind: 'added',
      base: undefined,
      local: file,
    });
  }
  for (const [key, override] of Object.entries(synced.linkedOverrides.requests)) {
    changes.push({
      bucket: 'linkedRequestOverride',
      key,
      label: `linked request override (${key})`,
      kind: 'added',
      base: undefined,
      local: override,
    });
  }
  for (const [key, override] of Object.entries(synced.linkedOverrides.environmentVars)) {
    changes.push({
      bucket: 'linkedEnvOverride',
      key,
      label: `linked env var override (${key})`,
      kind: 'added',
      base: undefined,
      local: override,
    });
  }
  for (const [linkId, ledger] of Object.entries(synced.releases.perLink)) {
    changes.push({
      bucket: 'releasePerLink',
      key: linkId,
      label: `linked release ledger (${linkId})`,
      kind: 'added',
      base: undefined,
      local: ledger,
    });
  }
  // Singletons that only count when they're non-default. We only report
  // the tree when it's non-empty — otherwise every fresh workspace would
  // claim a singleton "add".
  if (synced.collections.tree.children.length > 0) {
    changes.push({
      bucket: 'tree',
      key: '',
      label: 'Folder tree',
      kind: 'added',
      base: undefined,
      local: synced.collections.tree,
    });
  }
  if (synced.releases.self) {
    changes.push({
      bucket: 'releaseSelf',
      key: '',
      label: 'Release ledger',
      kind: 'added',
      base: undefined,
      local: synced.releases.self,
    });
  }
  // Workspace passphrase: only counts when actually set. A null/absent
  // value is the no-passphrase default — don't claim a singleton "add"
  // for every fresh workspace.
  if (synced.secretCrypto) {
    changes.push({
      bucket: 'secretCrypto',
      key: '',
      label: 'Workspace passphrase',
      kind: 'added',
      base: undefined,
      local: synced.secretCrypto,
    });
  }
  return finalize(changes, computedAt);
}

function finalize(changes: UnpushedChange[], computedAt: string): UnpushedSummary {
  changes.sort((a, b) => {
    const ba = BUCKET_ORDER.indexOf(a.bucket);
    const bb = BUCKET_ORDER.indexOf(b.bucket);
    if (ba !== bb) return ba - bb;
    return a.label.localeCompare(b.label, undefined, { sensitivity: 'base' });
  });
  let added = 0;
  let modified = 0;
  let removed = 0;
  for (const c of changes) {
    if (c.kind === 'added') added += 1;
    else if (c.kind === 'modified') modified += 1;
    else removed += 1;
  }
  return { added, modified, removed, total: changes.length, changes, computedAt };
}

/** Stable empty value for callers that want to default-render an empty summary. */
export const EMPTY_UNPUSHED_SUMMARY = EMPTY_SUMMARY;
