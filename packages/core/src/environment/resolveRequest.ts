import type {
  EnvPriorityRef,
  Environment,
  Request as ApiRequest,
  RequestAuth,
  RequestBody,
  WorkspaceSynced,
} from '@apicircle/shared';
import { envPriorityKey } from '@apicircle/shared';
import { resolveInheritedAuth } from '../request/resolveInheritedAuth';
import { buildScope, resolveString, type ResolutionScope } from './variableResolver';

// =============================================================================
// Pure send-time resolver.
//
// Builds a `ResolutionScope` from the workspace + caller-supplied decrypted
// envs/secrets, then interpolates `{{var}}` placeholders in url, headers,
// query, body, and auth fields. Folder-level auth inheritance is resolved
// here too. The caller owns the vault (decryption is host-specific — web,
// desktop, and VS Code all decrypt differently); this function takes the
// already-decrypted flat maps and is therefore synchronous + portable.
// =============================================================================

export interface ResolveRequestArgs {
  request: ApiRequest;
  synced: WorkspaceSynced;
  /** Plaintext local envs: `{ envName: { varKey: value } }`. */
  localEnvs: Record<string, Record<string, string>>;
  /**
   * Plaintext linked envs keyed by linkedWorkspaceId, then envName. Caller
   * is expected to have already applied any linkedOverrides.environmentVars
   * (use `applyLinkedEnvironmentOverrides` from this module first).
   */
  linkedEnvs?: Record<string, Record<string, Record<string, string>>>;
  /** Plaintext secrets keyed by their display label (vault-decrypted). */
  secrets?: Record<string, string>;
  /**
   * `globalContext` (latest-write-wins extractions) + plan variables
   * (optional) — sit between request.contextVars and the env layer.
   */
  globalContext?: Record<string, string>;
  planVariables?: ReadonlyArray<{ key: string; value: string }>;
  /** Plan-level priority overrides take precedence when non-empty. */
  envPriorityOverride?: readonly EnvPriorityRef[];
}

export interface ResolvedRequestResult {
  request: ApiRequest;
  scope: ResolutionScope;
  missing: string[];
}

export function resolveRequestForExecution(args: ResolveRequestArgs): ResolvedRequestResult {
  const refs =
    args.envPriorityOverride && args.envPriorityOverride.length > 0
      ? args.envPriorityOverride
      : args.synced.environments.priorityOrder;

  // Flatten local + linked envs into one keyed map the resolver can index by
  // composite key — matches the priority list's `EnvPriorityRef` shape.
  const flatEnvs: Record<string, Record<string, string>> = {};
  for (const [name, vars] of Object.entries(args.localEnvs)) {
    flatEnvs[envPriorityKey({ kind: 'local', name })] = vars;
  }
  for (const [linkId, byEnv] of Object.entries(args.linkedEnvs ?? {})) {
    for (const [envName, vars] of Object.entries(byEnv)) {
      flatEnvs[envPriorityKey({ kind: 'linked', linkedWorkspaceId: linkId, envName })] = vars;
    }
  }

  // contextVars: globalContext < plan vars < request.contextVars.
  const ctxMap: Record<string, string> = { ...(args.globalContext ?? {}) };
  for (const v of args.planVariables ?? []) {
    if (v.key) ctxMap[v.key] = v.value;
  }
  for (const v of args.request.contextVars) {
    if (v.key) ctxMap[v.key] = v.value;
  }
  const contextVars = Object.entries(ctxMap).map(([key, value]) => ({ key, value }));

  const scope = buildScope({
    contextVars,
    environments: flatEnvs,
    activeEnvName: null, // priorityOrder is the sole list the resolver consults.
    priorityOrder: refs.map(envPriorityKey),
    secrets: args.secrets ?? {},
  });

  const missing = new Set<string>();
  const interp = (s: string): string => {
    const r = resolveString(s, scope);
    for (const m of r.missing) missing.add(m);
    return r.value;
  };

  const url = interp(args.request.url);
  const headers = args.request.headers.map((h) => ({
    ...h,
    key: interp(h.key),
    value: interp(h.value),
  }));
  const query = args.request.query.map((q) => ({
    ...q,
    key: interp(q.key),
    value: interp(q.value),
  }));

  let body: RequestBody = args.request.body;
  if (
    body.type === 'json' ||
    body.type === 'text' ||
    body.type === 'xml' ||
    body.type === 'graphql' ||
    body.type === 'urlencoded'
  ) {
    body = { ...body, content: interp(body.content) };
  } else if (body.type === 'form-data' && body.formRows) {
    body = {
      ...body,
      formRows: body.formRows.map((row) =>
        row.kind === 'text'
          ? { ...row, key: interp(row.key), value: interp(row.value) }
          : { ...row, key: interp(row.key) },
      ),
    };
  }

  // Auth: resolve folder inheritance, then interpolate every string field
  // (so a `{{token}}` typed into Bearer / Basic / API-key works).
  const inheritedAuth = resolveInheritedAuth({
    requestAuth: args.request.auth ?? { type: 'none' },
    folderId: args.request.folderId,
    folders: args.synced.collections.folders,
  });
  const auth = interpolateAuthVariables(inheritedAuth, interp);

  return {
    request: { ...args.request, url, headers, query, body, auth },
    scope,
    missing: [...missing],
  };
}

function interpolateAuthVariables(auth: RequestAuth, interp: (s: string) => string): RequestAuth {
  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(auth)) {
    // `type` is the discriminant — never templated.
    resolved[key] = key !== 'type' && typeof value === 'string' ? interp(value) : value;
  }
  return resolved as unknown as RequestAuth;
}

// ---------------------------------------------------------------------------
// Linked-env override application (pure)
// ---------------------------------------------------------------------------

/**
 * Layer `synced.linkedOverrides.environmentVars` entries onto a source env
 * map for one linked workspace. Used by the host to prepare the plaintext
 * `linkedEnvs` argument before calling `resolveRequestForExecution`.
 */
export function applyLinkedEnvironmentOverrides(
  source: WorkspaceSynced['environments'],
  linkedWorkspaceId: string,
  synced: WorkspaceSynced,
): WorkspaceSynced['environments'] {
  const overrides = Object.values(synced.linkedOverrides.environmentVars).filter(
    (o) => o.linkedWorkspaceId === linkedWorkspaceId,
  );
  if (overrides.length === 0) return source;
  const items: WorkspaceSynced['environments']['items'] = {};
  for (const [envName, env] of Object.entries(source.items)) {
    const envOverrides = overrides.filter((o) => o.envName === envName);
    if (envOverrides.length === 0) {
      items[envName] = env;
      continue;
    }
    const removed = new Set(envOverrides.filter((o) => o.removed).map((o) => o.varKey));
    const replaceMap = new Map(envOverrides.filter((o) => !o.removed).map((o) => [o.varKey, o]));
    const variables: Environment['variables'] = [];
    const seenKeys = new Set<string>();
    for (const v of env.variables) {
      if (removed.has(v.key)) continue;
      const ov = replaceMap.get(v.key);
      if (ov) {
        variables.push({
          key: v.key,
          value: ov.value ?? v.value,
          encrypted: ov.encrypted ?? v.encrypted,
          ...(ov.secretKeyId !== undefined
            ? { secretKeyId: ov.secretKeyId }
            : v.secretKeyId !== undefined
              ? { secretKeyId: v.secretKeyId }
              : {}),
        });
      } else {
        variables.push(v);
      }
      seenKeys.add(v.key);
    }
    for (const ov of envOverrides) {
      if (ov.removed) continue;
      if (seenKeys.has(ov.varKey)) continue;
      variables.push({
        key: ov.varKey,
        value: ov.value ?? '',
        encrypted: ov.encrypted ?? false,
        ...(ov.secretKeyId !== undefined ? { secretKeyId: ov.secretKeyId } : {}),
      });
    }
    items[envName] = { ...env, variables };
  }
  return { ...source, items };
}

/**
 * Strip an envs map down to its plaintext key→value pairs, dropping any
 * variable still marked `encrypted: true` (the host's vault layer should have
 * decrypted those in advance). Returns the plaintext map the resolver
 * consumes.
 */
export function plaintextEnvMap(
  source: WorkspaceSynced['environments'],
): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const [name, env] of Object.entries(source.items)) {
    const vars: Record<string, string> = {};
    for (const v of env.variables) {
      if (v.encrypted) continue; // host did not decrypt this row; skip silently.
      vars[v.key] = v.value;
    }
    out[name] = vars;
  }
  return out;
}
