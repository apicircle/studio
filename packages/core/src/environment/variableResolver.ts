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

export interface ResolutionScope {
  contextVars: Record<string, string>;
  activeEnv: Record<string, string>;
  priorityEnvs: Array<Record<string, string>>;
  secrets: Record<string, string>;
}

export interface ResolveResult {
  value: string;
  /** Names that were referenced but not found in any scope. */
  missing: string[];
}

const PLACEHOLDER = /\{\{\s*([A-Za-z_][\w.-]*)\s*\}\}/g;

export function lookup(scope: ResolutionScope, name: string): string | undefined {
  if (Object.prototype.hasOwnProperty.call(scope.contextVars, name)) {
    return scope.contextVars[name];
  }
  if (Object.prototype.hasOwnProperty.call(scope.activeEnv, name)) {
    return scope.activeEnv[name];
  }
  for (const env of scope.priorityEnvs) {
    if (Object.prototype.hasOwnProperty.call(env, name)) return env[name];
  }
  if (Object.prototype.hasOwnProperty.call(scope.secrets, name)) {
    return scope.secrets[name];
  }
  return undefined;
}

/**
 * Replace every `{{NAME}}` in `input` with its resolved value. Unknown names
 * are left as-is in the output (so the user can see which placeholder didn't
 * resolve) and reported via `missing`.
 */
export function resolveString(input: string, scope: ResolutionScope): ResolveResult {
  const missing = new Set<string>();
  const value = input.replace(PLACEHOLDER, (match, name: string) => {
    const resolved = lookup(scope, name);
    if (resolved === undefined) {
      missing.add(name);
      return match;
    }
    return resolved;
  });
  return { value, missing: [...missing] };
}

/**
 * Resolve placeholders in every string value of an object (one level deep).
 * Used for header / param row arrays — both keys and values are resolved.
 * Returns a flat list of all missing names across the inputs.
 */
export function resolveStringMap(
  obj: Record<string, string>,
  scope: ResolutionScope,
): { result: Record<string, string>; missing: string[] } {
  const out: Record<string, string> = {};
  const missing = new Set<string>();
  for (const [key, value] of Object.entries(obj)) {
    const k = resolveString(key, scope);
    const v = resolveString(value, scope);
    out[k.value] = v.value;
    for (const m of k.missing) missing.add(m);
    for (const m of v.missing) missing.add(m);
  }
  return { result: out, missing: [...missing] };
}

/**
 * Build a ResolutionScope from a Workspace + a per-request context-vars
 * list. Optional plan-level priority overrides take precedence over the
 * workspace's global priority order.
 *
 * `secrets` is passed in already-decrypted because resolveString runs
 * synchronously — decryption happens once before send.
 */
export function buildScope(args: {
  contextVars: ReadonlyArray<{ key: string; value: string }>;
  environments: Record<string, Record<string, string>>;
  activeEnvName: string | null;
  priorityOrder: string[];
  secrets?: Record<string, string>;
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
  };
}
