import type { WorkspaceSynced } from '@apicircle/shared';
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
  /** Entity id within the bucket; empty string for singletons (workspaceName, tree, etc.). */
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
  'workspaceName',
  'tree',
  'request',
  'folder',
  'environment',
  'environmentsActive',
  'environmentsPriority',
  'linkedWorkspace',
  'releaseSelf',
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
  if (!base) {
    // No upstream yet (workspace was just created or never pulled).
    // Everything in `current` counts as "added" — walking the buckets
    // directly is simpler than feeding an empty-shape doc to the diff
    // engine.
    return summarizeAllAsAdded(current, now().toISOString());
  }
  // Reuse the existing 3-way diff with `remote = base` so every entry
  // is either 'unchanged' or 'local-only'. We then translate
  // 'local-only' into added / modified / removed by inspecting which of
  // base / local is undefined.
  const diff = computeThreeWayDiff(base, current, base);
  const changes: UnpushedChange[] = [];
  for (const entry of diff.entries) {
    if (entry.status !== 'local-only') continue;
    let kind: UnpushedChange['kind'];
    if (entry.base === undefined && entry.local !== undefined) kind = 'added';
    else if (entry.base !== undefined && entry.local === undefined) kind = 'removed';
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
  // Singletons that only count when they're non-default. We only report
  // workspaceName when it's been changed from the seed default and the
  // tree when it's non-empty — otherwise every fresh workspace would
  // claim two singleton "adds".
  if (synced.workspaceName && synced.workspaceName !== 'My Workspace') {
    changes.push({
      bucket: 'workspaceName',
      key: '',
      label: 'Workspace name',
      kind: 'added',
      base: undefined,
      local: synced.workspaceName,
    });
  }
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
