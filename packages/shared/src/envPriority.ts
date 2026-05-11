import type { EnvPriorityRef } from './types';

/**
 * Stable string key for an `EnvPriorityRef`. Used by the resolver as the
 * lookup key into the flattened `environments` map (which mixes local and
 * linked envs under composite keys), and by React lists as the row id.
 *
 *   - local: `local:<envName>`
 *   - linked: `linked:<linkedWorkspaceId>:<envName>`
 *
 * The `local:` prefix is intentional even for local envs — having a uniform
 * shape avoids ambiguity (a local env named `linked:abc:dev` would collide
 * with a linked env without the prefix). Treat keys as opaque; round-trip
 * through `parseEnvPriorityKey` rather than parsing inline.
 */
export function envPriorityKey(ref: EnvPriorityRef): string {
  if (ref.kind === 'local') return `local:${ref.name}`;
  return `linked:${ref.linkedWorkspaceId}:${ref.envName}`;
}

/**
 * Inverse of `envPriorityKey`. Returns null for unknown shapes — callers
 * use that to skip stale priority entries (e.g. a linked env that was
 * unlinked between pulls).
 */
export function parseEnvPriorityKey(key: string): EnvPriorityRef | null {
  if (key.startsWith('local:')) {
    return { kind: 'local', name: key.slice('local:'.length) };
  }
  if (key.startsWith('linked:')) {
    const rest = key.slice('linked:'.length);
    // Linked-workspace ids are UUIDs (no colons), so the FIRST colon
    // separates id from envName. Env names CAN contain colons — keep them
    // intact in the suffix.
    const colonIdx = rest.indexOf(':');
    if (colonIdx === -1) return null;
    return {
      kind: 'linked',
      linkedWorkspaceId: rest.slice(0, colonIdx),
      envName: rest.slice(colonIdx + 1),
    };
  }
  return null;
}

/**
 * Equality on EnvPriorityRef. Used for "is this env in the priority
 * list?" toggles and for diffing in tests.
 */
export function envPriorityRefEqual(a: EnvPriorityRef, b: EnvPriorityRef): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'local') return b.kind === 'local' && a.name === b.name;
  return (
    b.kind === 'linked' && a.linkedWorkspaceId === b.linkedWorkspaceId && a.envName === b.envName
  );
}

/**
 * Display name for an env priority entry. Used by sidebar + plan editor.
 * Linked entries get a "via {linkName}" suffix at render-time — we keep
 * just the env name here so the caller can format with workspace context.
 */
export function envPriorityDisplayName(ref: EnvPriorityRef): string {
  return ref.kind === 'local' ? ref.name : ref.envName;
}
