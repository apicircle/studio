// Safe parser for any `workspace.json` we read from a Git remote.
//
// Threat: the workspace.json file on the remote is whatever a collaborator
// (or anyone with write access to the repo) pushed. Treating it as a
// trusted `WorkspaceSynced` and merging it into store state is a primary
// attack surface — three audit findings clustered here:
//
//   1. JSON content can carry `"__proto__"` / `"constructor"` keys that
//      pollute Object.prototype when shallow-merged or even just iterated
//      with `for...in`. We strip those keys at parse time via a reviver.
//
//   2. `JSON.parse(x) as WorkspaceSynced` is a TypeScript-only lie. The
//      remote could have any shape — empty object, deeply-nested arrays,
//      missing required fields. We enforce a minimum shape that matches
//      what every downstream consumer (three-way diff, schema-version
//      migrations, store rehydrate) relies on.
//
//   3. A malicious workspace.json can be massive (gigabytes of nested
//      junk) — we cap the input string length before JSON.parse even
//      runs so a hostile blob can't OOM the renderer.
//
// We deliberately don't enforce a full Zod schema — the WorkspaceSynced
// type is hundreds of fields and would balloon this module. The audit's
// concrete asks are (a) prototype-pollution defense and (b) reject docs
// that aren't structurally workspaces. Both are achieved here.

import type { WorkspaceSynced } from '@apicircle/shared';

/** Hard cap on the JSON string length we'll accept. 16 MiB is generous
 *  for any realistic workspace doc — Git tooling chokes on much smaller
 *  files anyway. Reject anything past this rather than letting the parser
 *  walk megabytes of attacker-controlled bytes. */
const MAX_WORKSPACE_JSON_BYTES = 16 * 1024 * 1024;

/** Names of object keys we drop at parse time. Setting `__proto__`,
 *  `constructor`, or `prototype` as an OWN property doesn't mutate
 *  Object.prototype the same way `__proto__` assignment does, but `for...in`
 *  iteration / shallow-merge code can still surprise itself. Dropping them
 *  at the reviver boundary is the safest place. */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** Error thrown when the input fails any of our checks. `code` lets the UI
 *  branch on the specific failure (oversized, bad JSON, wrong shape, etc.)
 *  without parsing the message string. */
export class RemoteWorkspaceParseError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'oversized'
      | 'invalid-json'
      | 'not-object'
      | 'missing-workspace-id'
      | 'missing-collections'
      | 'missing-environments',
  ) {
    super(message);
    this.name = 'RemoteWorkspaceParseError';
  }
}

/**
 * Parse a remote `workspace.json` and return a `WorkspaceSynced` we can
 * safely merge into store state. Throws `RemoteWorkspaceParseError` on
 * any failure — callers should catch and surface to the user as a
 * "this workspace was modified by an incompatible version" message.
 *
 * The returned object is NOT a deep clone of the input; if any nested
 * object had a `__proto__` etc. key, that key was dropped at the reviver
 * level. Strings, numbers, and arrays pass through unchanged.
 *
 * The function is intentionally PERMISSIVE about unknown fields — newer
 * versions of Studio may add fields we don't know about, and we want
 * those workspaces to remain readable. We only enforce the fields the
 * existing codebase positively requires.
 */
export function parseWorkspaceJson(content: string): WorkspaceSynced {
  if (content.length > MAX_WORKSPACE_JSON_BYTES) {
    throw new RemoteWorkspaceParseError(
      `Workspace document exceeds ${MAX_WORKSPACE_JSON_BYTES} bytes (got ${content.length})`,
      'oversized',
    );
  }
  let raw: unknown;
  try {
    // The reviver runs once per (key, value) pair. Returning `undefined`
    // drops the property. This is the canonical way to strip dangerous
    // keys at parse time — V8 doesn't even attach the value to the parent
    // object. Cheaper and safer than walking the tree afterwards.
    raw = JSON.parse(content, (key: string, value: unknown) => {
      if (FORBIDDEN_KEYS.has(key)) return undefined;
      return value;
    });
  } catch (err) {
    throw new RemoteWorkspaceParseError(
      `Remote workspace.json is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      'invalid-json',
    );
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new RemoteWorkspaceParseError('Remote workspace.json is not a JSON object', 'not-object');
  }
  const obj = raw as Record<string, unknown>;

  // Minimum shape: every field below is read unconditionally by the store
  // and three-way diff. A missing one means we're either looking at a
  // half-empty doc or a totally different schema; either way we refuse.
  if (typeof obj.workspaceId !== 'string' || obj.workspaceId.length === 0) {
    throw new RemoteWorkspaceParseError(
      'Remote workspace.json is missing workspaceId',
      'missing-workspace-id',
    );
  }
  if (
    typeof obj.collections !== 'object' ||
    obj.collections === null ||
    Array.isArray(obj.collections)
  ) {
    throw new RemoteWorkspaceParseError(
      'Remote workspace.json is missing or malformed `collections`',
      'missing-collections',
    );
  }
  if (
    typeof obj.environments !== 'object' ||
    obj.environments === null ||
    Array.isArray(obj.environments)
  ) {
    throw new RemoteWorkspaceParseError(
      'Remote workspace.json is missing or malformed `environments`',
      'missing-environments',
    );
  }

  // Shape passes — return the parsed value cast to the workspace type.
  // Unknown fields are preserved; the consumer is responsible for any
  // schema-version handling.
  return obj as unknown as WorkspaceSynced;
}
