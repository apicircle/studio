// Variable substitution for request fields.
//
// `{{NAME}}` placeholders are resolved against a layered scope. The default
// precedence (matches the plan's "Global priority" rule) is:
//
//   1. contextVars      — defined inline on the request itself
//   2. activeEnv        — currently-selected environment's variables
//   3. priorityEnvs[*]  — fallback chain (other environments in user-set
//                         order). First match wins.
//
// Plan-level overrides (P6) plug in by passing a different priorityEnvs
// list — execution plans build their own ordered scope and pass it as the
// outermost wins. The `contextVars` layer is always highest priority.
//
// Secrets are surfaced as a fourth layer: a `secrets` map of decrypted
// values keyed by secret label. The Secret Vault hands these in pre-decrypted
// for the duration of one send so this layer doesn't need crypto.
//
// A Secret Vault slot that encrypts environment variables is an encryption
// key, not a variable: its value is what those variables' ciphertext is
// derived from, so sending it would expose every variable it encrypts. Such a
// slot is listed in `encryptionKeys` and its label never resolves from the
// secrets layer.

export interface ResolutionScope {
  contextVars: Record<string, string>;
  activeEnv: Record<string, string>;
  priorityEnvs: Array<Record<string, string>>;
  secrets: Record<string, string>;
  /**
   * Labels of the Secret Vault slots that encrypt environment variables, each
   * mapped to the variables it encrypts (see `findEncryptionKeys`). A
   * `{{LABEL}}` naming one is left as typed and reported in
   * `ResolveResult.encryptionKeys`, even when `secrets` holds its value. A
   * context or environment variable of the same name still resolves.
   */
  encryptionKeys?: Readonly<Record<string, readonly string[]>>;
}

export interface ResolveResult {
  value: string;
  /** Names that were referenced but not found in any scope. */
  missing: string[];
  /**
   * Names that refer to an encryption-key slot (`scope.encryptionKeys`). They
   * are left as typed, never substituted, and are not in `missing`.
   */
  encryptionKeys: string[];
}

const PLACEHOLDER = /\{\{\s*([A-Za-z_][\w.-]*)\s*\}\}/g;

function has(map: Readonly<Record<string, unknown>>, name: string): boolean {
  return Object.prototype.hasOwnProperty.call(map, name);
}

/** True when `name` names an encryption-key slot in `scope`. */
function isEncryptionKey(scope: ResolutionScope, name: string): boolean {
  return scope.encryptionKeys !== undefined && has(scope.encryptionKeys, name);
}

export function lookup(scope: ResolutionScope, name: string): string | undefined {
  if (has(scope.contextVars, name)) {
    return scope.contextVars[name];
  }
  if (has(scope.activeEnv, name)) {
    return scope.activeEnv[name];
  }
  for (const env of scope.priorityEnvs) {
    if (has(env, name)) return env[name];
  }
  // An encryption key is never a value, whatever the secrets layer holds.
  if (isEncryptionKey(scope, name)) return undefined;
  if (has(scope.secrets, name)) {
    return scope.secrets[name];
  }
  return undefined;
}

/**
 * Replace every `{{NAME}}` in `input` with its resolved value. Unknown names
 * are left as-is in the output (so the user can see which placeholder didn't
 * resolve) and reported via `missing`; names of encryption-key slots are left
 * as-is too and reported via `encryptionKeys`.
 */
export function resolveString(input: string, scope: ResolutionScope): ResolveResult {
  const missing = new Set<string>();
  const encryptionKeys = new Set<string>();
  const value = input.replace(PLACEHOLDER, (match, name: string) => {
    const resolved = lookup(scope, name);
    if (resolved === undefined) {
      if (isEncryptionKey(scope, name)) encryptionKeys.add(name);
      else missing.add(name);
      return match;
    }
    return resolved;
  });
  return { value, missing: [...missing], encryptionKeys: [...encryptionKeys] };
}

/**
 * Resolve placeholders in every string value of an object (one level deep).
 * Used for header / param row arrays — both keys and values are resolved.
 * Returns a flat list of all missing names across the inputs, and of the
 * encryption-key names they referenced.
 */
export function resolveStringMap(
  obj: Record<string, string>,
  scope: ResolutionScope,
): { result: Record<string, string>; missing: string[]; encryptionKeys: string[] } {
  const out: Record<string, string> = {};
  const missing = new Set<string>();
  const encryptionKeys = new Set<string>();
  for (const [key, value] of Object.entries(obj)) {
    const k = resolveString(key, scope);
    const v = resolveString(value, scope);
    out[k.value] = v.value;
    for (const r of [k, v]) {
      for (const m of r.missing) missing.add(m);
      for (const e of r.encryptionKeys) encryptionKeys.add(e);
    }
  }
  return { result: out, missing: [...missing], encryptionKeys: [...encryptionKeys] };
}

/**
 * Build a ResolutionScope from a Workspace + a per-request context-vars
 * list. Optional plan-level priority overrides take precedence over the
 * workspace's global priority order.
 *
 * `secrets` is passed in already-decrypted because resolveString runs
 * synchronously — decryption happens once before send. `encryptionKeys`
 * names the slots among them that must never resolve.
 */
export function buildScope(args: {
  contextVars: ReadonlyArray<{ key: string; value: string }>;
  environments: Record<string, Record<string, string>>;
  activeEnvName: string | null;
  priorityOrder: string[];
  secrets?: Record<string, string>;
  encryptionKeys?: Readonly<Record<string, readonly string[]>>;
}): ResolutionScope {
  const ctx: Record<string, string> = {};
  for (const v of args.contextVars) {
    if (v.key) ctx[v.key] = v.value;
  }
  const activeEnv =
    args.activeEnvName && args.environments[args.activeEnvName]
      ? args.environments[args.activeEnvName]
      : {};
  const priorityEnvs = args.priorityOrder
    .filter((name) => name !== args.activeEnvName)
    .map((name) => args.environments[name] ?? {});
  return {
    contextVars: ctx,
    activeEnv: activeEnv ?? {},
    priorityEnvs,
    secrets: args.secrets ?? {},
    ...(args.encryptionKeys ? { encryptionKeys: args.encryptionKeys } : {}),
  };
}

// --- Autocomplete ------------------------------------------------------

export type VariableSource = 'context' | 'active-env' | 'priority-env' | 'secret';

export interface VariableSuggestion {
  key: string;
  source: VariableSource;
  /** Display-only — secrets always show as the placeholder string. */
  preview: string;
}

const SECRET_PREVIEW = '••••';

/**
 * Walk a ResolutionScope in precedence order and produce one suggestion
 * per unique key. Used by the editor's `{{` autocomplete and Monaco's
 * completion provider.
 */
export function collectVariableSuggestions(scope: ResolutionScope): VariableSuggestion[] {
  const seen = new Map<string, VariableSuggestion>();
  const push = (key: string, source: VariableSource, preview: string) => {
    if (!seen.has(key)) seen.set(key, { key, source, preview });
  };
  for (const [k, v] of Object.entries(scope.contextVars)) {
    push(k, 'context', v);
  }
  for (const [k, v] of Object.entries(scope.activeEnv)) {
    push(k, 'active-env', v);
  }
  for (const env of scope.priorityEnvs) {
    for (const [k, v] of Object.entries(env)) {
      push(k, 'priority-env', v);
    }
  }
  for (const k of Object.keys(scope.secrets)) {
    // An encryption key is not a variable, so it is not offered as one.
    if (!isEncryptionKey(scope, k)) push(k, 'secret', SECRET_PREVIEW);
  }
  return [...seen.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * Suggestions to show given a cursor position inside a text field. Returns
 * `null` when the cursor isn't inside an open `{{ … }}` token, so callers
 * can hide the popup. When inside a token, returns matches filtered by the
 * partial token text.
 */
export function getVariableAutocomplete(
  text: string,
  cursorPosition: number,
  scope: ResolutionScope,
): VariableSuggestion[] | null {
  const before = text.slice(0, cursorPosition);
  const openIdx = before.lastIndexOf('{{');
  if (openIdx === -1) return null;
  const fragment = before.slice(openIdx + 2);
  // If the user already closed the token, don't suggest anymore.
  if (fragment.includes('}}')) return null;
  const query = fragment.trim().toLowerCase();
  return collectVariableSuggestions(scope).filter((s) =>
    query.length === 0 ? true : s.key.toLowerCase().includes(query),
  );
}
