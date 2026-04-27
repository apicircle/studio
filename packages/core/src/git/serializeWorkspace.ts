import type { WorkspaceSynced } from '@apicircle-v2/shared';

// Canonical serializer for the workspace.json that lands in Git. Stable
// key order so re-pushing the same logical state produces byte-identical
// JSON, which means GitHub diffs stay minimal across pushes.
//
// The plan §2 commits to a single `workspace.json` at the repo root; this
// function is the only place that decides its on-disk shape.

const INDENT = 2;

/**
 * Stringify a WorkspaceSynced doc with deeply-sorted object keys + 2-space
 * indent + trailing newline (so editors don't re-stamp the file when the
 * user opens it). Arrays preserve their existing order — that's part of
 * the workspace's user-visible shape (priority list, tree children, etc).
 */
export function serializeWorkspaceForGit(synced: WorkspaceSynced): string {
  return `${stringifySorted(synced)}\n`;
}

function stringifySorted(value: unknown): string {
  return JSON.stringify(value, sortedReplacer, INDENT);
}

function sortedReplacer(this: unknown, _key: string, value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value;
  // Sort plain objects' keys; non-plain objects (e.g. dates) pass through
  // as-is via JSON.stringify's default coercion.
  const proto = Object.getPrototypeOf(value) as object | null;
  if (proto !== Object.prototype && proto !== null) return value;
  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(source).sort()) {
    const v: unknown = source[k];
    out[k] = v;
  }
  return out;
}
