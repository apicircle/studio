import type {
  Environment,
  EnvPriorityRef,
  ExecutionPlan,
  PlanRun,
  Request as ApiRequest,
  RequestAuth,
  RequestOverridePatch,
  RequestRun,
  WorkspaceLocal,
  WorkspaceSynced,
} from '@apicircle/shared';
import { envPriorityKey, generateId, RUN_BODY_PREVIEW_LIMIT } from '@apicircle/shared';
import { executeRequest, type ExecutionResult } from '../request/executeRequest';
import type { AttachmentResolver } from '../request/buildRequest';
import { runAssertions, type AssertionResult } from '../assertions/runAssertions';
import { extractContext } from '../environment/extractContext';
import { resolveInheritedAuth } from '../request/resolveInheritedAuth';
import { buildScope, resolveString } from '../environment/variableResolver';
import type { WorkspaceState } from './patches';

// =============================================================================
// runPlan — the headless execution-plan runner.
//
// The browser/desktop store has its own `runPlan` (workspaceStore.ts) wired to
// IndexedDB secret crypto, AbortControllers, and live UI state. This one is the
// runtime-agnostic engine: it takes a plain `WorkspaceState`, executes a plan's
// steps with `executeRequest`, and returns the `PlanRun` plus the workspace
// with history + refreshed tokens folded in. The CLI (`apicircle run`) drives
// it; a hosted runtime or the MCP host could too.
//
// Secrets: encrypted env-var ciphertext is never decrypted here. Callers supply
// plaintext keyed by `secretKeyId` (the CLI sources these from
// `APICIRCLE_SECRET_<id>` / `--secrets`). An encrypted var with no supplied
// value is omitted from scope, so `{{VAR}}` surfaces as an unresolved
// placeholder rather than leaking ciphertext onto the wire.
// =============================================================================

// History buffer caps — mirror the store's circular-buffer behaviour so a CLI
// that runs plans repeatedly doesn't grow workspace.local.json unbounded.
const MAX_REQUEST_RUNS = 500;
const MAX_PLAN_RUNS = 200;

/**
 * Best-known identity of whoever launched a plan run. Recorded for display
 * and handed to the `authorize` hook. `unknown` is the headless default when
 * no GitHub session or OS user can be determined.
 */
export interface RunActor {
  kind: 'github' | 'os' | 'unknown';
  /** GitHub login, OS username, or 'unknown'. */
  name: string;
}

export const ANONYMOUS_ACTOR: RunActor = { kind: 'unknown', name: 'unknown' };

/**
 * Thrown by an `authorize` hook to deny a run. `runPlan` lets it propagate
 * untouched so callers (the CLI) can map it to a distinct exit code. Today no
 * built-in hook throws it — it exists for the per-user run restrictions that
 * are planned but not yet designed.
 */
export class PlanRunDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlanRunDeniedError';
  }
}

/** Context handed to the `authorize` hook before any HTTP request fires. */
export interface PlanRunAuthorizationContext {
  planId: string;
  plan: ExecutionPlan;
  actor: RunActor;
  state: WorkspaceState;
}

export interface RunPlanOptions {
  /** Evaluate the per-request assertions. Defaults to `true`. */
  withAssertions?: boolean;
  /**
   * Halt the run after the first failed step — including missing / linked
   * steps — regardless of the plan's own `stopOnAssertionFailure`. This is
   * the `apicircle run --bail` behaviour. Defaults to `false`.
   */
  bail?: boolean;
  /**
   * Name of a local environment to layer on top of the run's env priority
   * order (highest precedence). Used by `apicircle run --env <name>`. A name
   * with no matching environment simply contributes nothing.
   */
  env?: string;
  /** Injected fetch — defaults to `globalThis.fetch`. Tests pass a stub. */
  fetchImpl?: typeof fetch;
  /** Aborts the run between steps and the in-flight request. */
  signal?: AbortSignal;
  /** Per-request hard timeout in ms. `null` disables. Defaults to executeRequest's 30s. */
  timeoutMs?: number | null;
  /** Resolver for local and linked attachment bytes used by file/binary bodies. */
  resolveAttachment?: AttachmentResolver;
  /** Plaintext secret values keyed by `secretKeyId`, for encrypted env vars. */
  secretsById?: Record<string, string>;
  /** Identity of whoever launched the run. Defaults to {@link ANONYMOUS_ACTOR}. */
  actor?: RunActor;
  /**
   * Authorization seam. Called once, before the first request, with the
   * resolved plan + actor. Throw (ideally {@link PlanRunDeniedError}) to deny
   * the run. Omit for an unrestricted run — the current default everywhere.
   */
  authorize?: (ctx: PlanRunAuthorizationContext) => void | Promise<void>;
  /** Invoked after each step settles — lets a CLI stream progress live. */
  onStep?: (step: PlanStepResult) => void;
}

export interface PlanStepResult {
  /** Index into `plan.steps` — stable even when steps are skipped. */
  stepIndex: number;
  requestId: string;
  requestName: string;
  requestMethod: string;
  /** True when the step was skipped via `enabled: false`. */
  skipped: boolean;
  /** Execution result, or `null` for a skipped / unresolvable step. */
  result: ExecutionResult | null;
  assertionResults: AssertionResult[];
  /** `{{VAR}}` placeholders that didn't resolve in url / headers / query / body / auth. */
  missingVariables: string[];
  /** True when the request succeeded and (if enabled) every assertion passed. */
  passed: boolean;
  /** Set when the step couldn't run at all (missing / linked / unsupported). */
  error?: string;
}

export interface RunPlanResult {
  planRun: PlanRun;
  /** One entry per step, including skipped ones (in `plan.steps` order). */
  steps: PlanStepResult[];
  /**
   * Workspace with the plan-run + request-runs appended to history and any
   * refreshed OAuth2 tokens persisted onto `synced`. Save this back to disk.
   */
  nextState: WorkspaceState;
  /** True when every executed (non-skipped) step passed. Vacuously true when none ran. */
  passed: boolean;
}

export type ResolvePlanRefResult =
  | { ok: true; id: string; plan: ExecutionPlan }
  | { ok: false; error: string; available: string[] };

/**
 * Resolve a user-supplied plan reference (a plan id, or a plan name) against a
 * workspace. Name matching is case-insensitive and trimmed; an ambiguous name
 * (two plans share it) is rejected so the caller can ask for an id instead.
 */
export function resolvePlanRef(synced: WorkspaceSynced, ref: string): ResolvePlanRefResult {
  const plans = synced.executionPlans ?? {};
  const entries = Object.entries(plans);
  const available = entries.map(([, p]) => p.name);
  if (entries.length === 0) {
    return { ok: false, error: 'This workspace has no execution plans.', available };
  }
  const direct = plans[ref];
  if (direct) return { ok: true, id: ref, plan: direct };

  const wanted = ref.trim().toLowerCase();
  const byName = entries.filter(([, p]) => p.name.trim().toLowerCase() === wanted);
  if (byName.length === 1) return { ok: true, id: byName[0][0], plan: byName[0][1] };
  if (byName.length > 1) {
    return {
      ok: false,
      error: `Plan name "${ref}" is ambiguous — ${byName.length} plans share it. Pass the plan id instead.`,
      available,
    };
  }
  return { ok: false, error: `No plan named "${ref}" in this workspace.`, available };
}

function lookupPlanStepRequest(
  step: { requestId: string; linkedWorkspaceId?: string },
  synced: WorkspaceSynced,
  local: WorkspaceLocal,
): {
  request: ApiRequest | null;
  linkedEnvironments?: WorkspaceSynced['environments'];
  linkedFolders?: WorkspaceSynced['collections']['folders'];
  linkedGlobalAssets?: WorkspaceSynced['globalAssets'];
  error?: string;
} {
  if (!step.linkedWorkspaceId) {
    const request = synced.collections.requests[step.requestId];
    return request
      ? { request }
      : { request: null, error: 'Request no longer exists in workspace.' };
  }

  const link = synced.linkedWorkspaces[step.linkedWorkspaceId];
  if (!link) return { request: null, error: 'Linked workspace was unlinked.' };

  const snapshot = local.linkedCollections[step.linkedWorkspaceId];
  if (!snapshot) {
    return {
      request: null,
      error: `No cached snapshot for "${link.name}". Refresh the link before running this plan.`,
    };
  }

  const baseRequest = snapshot.collections.requests[step.requestId];
  if (!baseRequest) {
    return {
      request: null,
      error: `Request not present in the cached snapshot of "${link.name}".`,
    };
  }

  const overrideKey = `${step.linkedWorkspaceId}:${step.requestId}`;
  const override = synced.linkedOverrides.requests[overrideKey];
  const request = override ? mergeRequestOverride(baseRequest, override.patch) : baseRequest;
  return {
    request,
    linkedEnvironments: applyEnvironmentOverrides(
      snapshot.environments,
      step.linkedWorkspaceId,
      synced,
    ),
    linkedFolders: snapshot.collections.folders,
    linkedGlobalAssets: snapshot.globalAssets,
  };
}

function mergeRequestOverride(base: ApiRequest, patch: RequestOverridePatch): ApiRequest {
  const merged: ApiRequest = { ...base };
  if (patch.name !== undefined) merged.name = patch.name;
  if (patch.method !== undefined) merged.method = patch.method;
  if (patch.url !== undefined) merged.url = patch.url;
  if (patch.headers !== undefined) merged.headers = patch.headers;
  if (patch.query !== undefined) merged.query = patch.query;
  if (patch.pathParams !== undefined) merged.pathParams = patch.pathParams;
  if (patch.cookies !== undefined) merged.cookies = patch.cookies;
  if (patch.body !== undefined) merged.body = patch.body;
  if (patch.auth !== undefined) merged.auth = patch.auth;
  if (patch.contextVars !== undefined) merged.contextVars = patch.contextVars;
  if (patch.extractions !== undefined) merged.extractions = patch.extractions;
  if (patch.assertions !== undefined) merged.assertions = patch.assertions;
  return merged;
}

function applyEnvironmentOverrides(
  source: WorkspaceSynced['environments'],
  linkedWorkspaceId: string,
  synced: WorkspaceSynced,
): WorkspaceSynced['environments'] {
  const overrides = Object.values(synced.linkedOverrides.environmentVars).filter(
    (override) => override.linkedWorkspaceId === linkedWorkspaceId,
  );
  if (overrides.length === 0) return source;

  const items: WorkspaceSynced['environments']['items'] = {};
  for (const [envName, env] of Object.entries(source.items)) {
    const envOverrides = overrides.filter((override) => override.envName === envName);
    if (envOverrides.length === 0) {
      items[envName] = env;
      continue;
    }

    const removed = new Set(
      envOverrides.filter((override) => override.removed).map((override) => override.varKey),
    );
    const replaceMap = new Map<string, (typeof envOverrides)[number]>();
    for (const override of envOverrides) {
      if (!override.removed) replaceMap.set(override.varKey, override);
    }
    const variables: Environment['variables'] = [];
    const seenKeys = new Set<string>();
    for (const variable of env.variables) {
      if (removed.has(variable.key)) continue;
      const override = replaceMap.get(variable.key);
      if (override) {
        variables.push({
          key: variable.key,
          value: override.value ?? variable.value,
          encrypted: override.encrypted ?? variable.encrypted,
          ...(override.secretKeyId !== undefined
            ? { secretKeyId: override.secretKeyId }
            : variable.secretKeyId !== undefined
              ? { secretKeyId: variable.secretKeyId }
              : {}),
        });
      } else {
        variables.push(variable);
      }
      seenKeys.add(variable.key);
    }

    for (const override of envOverrides) {
      if (override.removed || seenKeys.has(override.varKey)) continue;
      variables.push({
        key: override.varKey,
        value: override.value ?? '',
        encrypted: override.encrypted ?? false,
        ...(override.secretKeyId !== undefined ? { secretKeyId: override.secretKeyId } : {}),
      });
    }
    items[envName] = { ...env, variables };
  }
  return { ...source, items };
}

/**
 * Execute every enabled step of `planId` against the workspace. Never throws
 * for HTTP / assertion failures — those land in the returned step results.
 * Throws only for a missing plan or a denial from the `authorize` hook.
 */
export async function runPlan(
  state: WorkspaceState,
  planId: string,
  opts: RunPlanOptions = {},
): Promise<RunPlanResult> {
  const plan = state.synced.executionPlans?.[planId];
  if (!plan) throw new Error(`Plan "${planId}" not found in workspace`);

  const actor = opts.actor ?? ANONYMOUS_ACTOR;
  if (opts.authorize) {
    await opts.authorize({ planId, plan, actor, state });
  }

  const withAssertions = opts.withAssertions ?? true;
  const bail = opts.bail ?? false;
  // The plan's own stop flag only halts on a *failed assertion*; --bail halts
  // on any failed step. Both feed the post-step break below.
  const stopOnAssertion = withAssertions && (plan.stopOnAssertionFailure ?? false);
  const secretsById = opts.secretsById ?? {};
  const flatEnvs = buildEnvMaps(state.synced, secretsById, state.local);
  const secretsByLabel = buildSecretsByLabel(state.synced, secretsById);

  // Env priority for this run: the plan's overlay (or the workspace order),
  // with an optional `--env` environment layered on top at highest precedence.
  const baseRefs =
    plan.envPriorityOrder.length > 0
      ? plan.envPriorityOrder
      : state.synced.environments.priorityOrder;
  const envRefs: readonly EnvPriorityRef[] = opts.env
    ? [{ kind: 'local', name: opts.env }, ...baseRefs]
    : baseRefs;

  const startedAt = new Date().toISOString();
  const planRunId = generateId();
  const t0 = Date.now();

  const stepRecords: PlanRun['steps'] = [];
  const newRequestRuns: RequestRun[] = [];
  const stepResults: PlanStepResult[] = [];

  // Rolling state across steps: extracted context vars feed the next step's
  // resolver; refreshed OAuth2 tokens replace the request's stored auth.
  let globalContext = { ...state.local.globalContext };
  let requests = state.synced.collections.requests;
  const tokenRefreshes = new Map<string, RequestAuth>();

  const record = (step: PlanStepResult): void => {
    stepResults.push(step);
    opts.onStep?.(step);
  };

  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i];

    // Disabled steps stay in the plan but contribute nothing to the run —
    // no request-run, no PlanRun.steps entry. Matches the store's runPlan.
    if (step.enabled === false) {
      const req = requests[step.requestId];
      record({
        stepIndex: i,
        requestId: step.requestId,
        requestName: req?.name ?? '(unknown request)',
        requestMethod: req?.method ?? '—',
        skipped: true,
        result: null,
        assertionResults: [],
        missingVariables: [],
        passed: true,
      });
      continue;
    }

    if (opts.signal?.aborted) break;

    const lookup = lookupPlanStepRequest(step, state.synced, state.local);
    const baseRequest = lookup.request;
    if (!baseRequest) {
      const runId = generateId();
      const error = lookup.error ?? 'Request no longer exists in workspace.';
      newRequestRuns.push(orphanRun(runId, step.requestId, error));
      stepRecords.push({ requestRunId: runId, passed: false });
      record({
        stepIndex: i,
        requestId: step.requestId,
        requestName: step.linkedWorkspaceId ? '(linked request)' : '(missing request)',
        requestMethod: '—',
        skipped: false,
        result: null,
        assertionResults: [],
        missingVariables: [],
        passed: false,
        error,
      });
      if (bail) break;
      continue;
    }

    const resolveSynced: WorkspaceSynced =
      step.linkedWorkspaceId && lookup.linkedEnvironments
        ? {
            ...state.synced,
            environments: lookup.linkedEnvironments,
            globalAssets: lookup.linkedGlobalAssets ?? state.synced.globalAssets,
            collections: {
              ...state.synced.collections,
              folders: lookup.linkedFolders ?? {},
            },
          }
        : state.synced;
    const stepEnvRefs =
      step.linkedWorkspaceId && plan.envPriorityOrder.length === 0
        ? (lookup.linkedEnvironments?.priorityOrder ?? envRefs)
        : envRefs;

    const { request: resolved, missing } = resolveRequest(
      baseRequest,
      resolveSynced,
      plan,
      stepEnvRefs,
      globalContext,
      step.linkedWorkspaceId ? buildEnvMaps(resolveSynced, secretsById, state.local) : flatEnvs,
      secretsByLabel,
    );

    const result = await executeRequest(resolved, {
      fetchImpl: opts.fetchImpl,
      signal: opts.signal,
      timeoutMs: opts.timeoutMs,
      resolveAttachment: opts.resolveAttachment,
      authOptions: {
        onTokenRefreshed: (refreshedAuth) => {
          if (!step.linkedWorkspaceId) tokenRefreshes.set(baseRequest.id, refreshedAuth);
        },
      },
    });

    const assertionResults = withAssertions ? runAssertions(baseRequest.assertions, result) : [];
    const passed = result.ok && (!withAssertions || assertionResults.every((a) => a.passed));
    const requestRun = buildRequestRun(resolved, result, assertionResults);
    newRequestRuns.push(requestRun);
    stepRecords.push({ requestRunId: requestRun.id, passed });
    record({
      stepIndex: i,
      requestId: baseRequest.id,
      requestName: baseRequest.name,
      requestMethod: baseRequest.method,
      skipped: false,
      result,
      assertionResults,
      missingVariables: missing,
      passed,
    });

    // Carry extracted context vars into the rolling scope for the next step.
    if (baseRequest.extractions.length > 0) {
      const { extracted } = extractContext(result, baseRequest.extractions);
      globalContext = { ...globalContext, ...extracted };
    }

    // Fold a refreshed token back into `requests` so a later step reusing the
    // same request sees the fresh access token instead of re-refreshing.
    const refreshed = step.linkedWorkspaceId ? undefined : tokenRefreshes.get(baseRequest.id);
    if (refreshed) {
      requests = {
        ...requests,
        [baseRequest.id]: { ...requests[baseRequest.id], auth: refreshed },
      };
    }

    if ((bail || stopOnAssertion) && !passed) break;
  }

  const planRun: PlanRun = {
    id: planRunId,
    planId,
    startedAt,
    durationMs: Date.now() - t0,
    withAssertions,
    steps: stepRecords,
  };

  // Newest-first history, same convention the store uses. Request-runs are
  // reversed so the last step to run sits at index 0.
  const requestRuns = [...newRequestRuns]
    .reverse()
    .concat(state.local.history.requestRuns)
    .slice(0, MAX_REQUEST_RUNS);
  const planRuns = [planRun, ...state.local.history.planRuns].slice(0, MAX_PLAN_RUNS);

  const nextState: WorkspaceState = {
    synced:
      tokenRefreshes.size > 0
        ? {
            ...state.synced,
            collections: { ...state.synced.collections, requests },
            meta: { ...state.synced.meta, updatedAt: new Date().toISOString() },
          }
        : state.synced,
    local: {
      ...state.local,
      globalContext,
      history: { ...state.local.history, requestRuns, planRuns },
    },
  };

  const executed = stepResults.filter((s) => !s.skipped);
  const passed = executed.every((s) => s.passed);

  return { planRun, steps: stepResults, nextState, passed };
}

// ---------------------------------------------------------------------------
// variable resolution (headless — no IndexedDB / WebCrypto)
// ---------------------------------------------------------------------------

/**
 * Flatten the workspace's local environments into the `envPriorityKey`-keyed
 * map `buildScope` expects. Encrypted vars are substituted with the supplied
 * plaintext; an encrypted var with no supplied secret is omitted so the
 * `{{VAR}}` reference surfaces as unresolved instead of leaking ciphertext.
 */
function buildEnvMaps(
  synced: WorkspaceSynced,
  secretsById: Record<string, string>,
  local?: WorkspaceLocal,
): Record<string, Record<string, string>> {
  const flat: Record<string, Record<string, string>> = {};
  for (const [name, env] of Object.entries(synced.environments.items)) {
    const vars: Record<string, string> = {};
    for (const v of env.variables) {
      if (!v.key) continue;
      if (v.encrypted) {
        const supplied = v.secretKeyId ? secretsById[v.secretKeyId] : undefined;
        if (supplied === undefined) continue;
        vars[v.key] = supplied;
      } else {
        vars[v.key] = v.value;
      }
    }
    flat[envPriorityKey({ kind: 'local', name })] = vars;
  }
  if (local) {
    for (const [linkId, snapshot] of Object.entries(local.linkedCollections)) {
      const overridden = applyEnvironmentOverrides(snapshot.environments, linkId, synced);
      for (const [envName, env] of Object.entries(overridden.items)) {
        const vars: Record<string, string> = {};
        for (const variable of env.variables) {
          if (!variable.key) continue;
          if (variable.encrypted) {
            const supplied = variable.secretKeyId ? secretsById[variable.secretKeyId] : undefined;
            if (supplied === undefined) continue;
            vars[variable.key] = supplied;
          } else {
            vars[variable.key] = variable.value;
          }
        }
        flat[envPriorityKey({ kind: 'linked', linkedWorkspaceId: linkId, envName })] = vars;
      }
    }
  }
  return flat;
}

/** Project supplied secrets onto their human labels for direct `{{Label}}` refs. */
function buildSecretsByLabel(
  synced: WorkspaceSynced,
  secretsById: Record<string, string>,
): Record<string, string> {
  const meta = synced.secretKeys ?? {};
  const byLabel: Record<string, string> = {};
  for (const [id, value] of Object.entries(secretsById)) {
    const label = meta[id]?.label;
    if (label) byLabel[label] = value;
  }
  return byLabel;
}

/**
 * Interpolate `{{var}}` placeholders across a request's url, headers, query,
 * body, and auth fields. Resolver precedence (highest first): per-request
 * contextVars → plan variables → rolling globalContext → env priority list →
 * secret labels. Path params and cookies are left verbatim — same as the
 * store's `resolveRequest`.
 */
function resolveRequest(
  request: ApiRequest,
  synced: WorkspaceSynced,
  plan: ExecutionPlan,
  envRefs: readonly EnvPriorityRef[],
  globalContext: Record<string, string>,
  flatEnvs: Record<string, Record<string, string>>,
  secretsByLabel: Record<string, string>,
): { request: ApiRequest; missing: string[] } {
  // contextVars layering (low → high): globalContext, plan vars, request vars.
  const ctxMap: Record<string, string> = { ...globalContext };
  for (const v of plan.variables ?? []) {
    if (v.key) ctxMap[v.key] = v.value;
  }
  for (const v of request.contextVars) {
    if (v.key) ctxMap[v.key] = v.value;
  }

  const scope = buildScope({
    contextVars: Object.entries(ctxMap).map(([key, value]) => ({ key, value })),
    environments: flatEnvs,
    activeEnvName: null,
    priorityOrder: envRefs.map(envPriorityKey),
    secrets: secretsByLabel,
  });

  const missing = new Set<string>();
  const sub = (input: string): string => {
    const { value, missing: m } = resolveString(input, scope);
    for (const name of m) missing.add(name);
    return value;
  };

  const url = sub(request.url);
  const headers = request.headers.map((h) => ({
    ...h,
    key: sub(h.key),
    value: sub(h.value),
  }));
  const query = request.query.map((q) => ({
    ...q,
    key: sub(q.key),
    value: sub(q.value),
  }));

  let body = request.body;
  if (
    body.type === 'json' ||
    body.type === 'text' ||
    body.type === 'xml' ||
    body.type === 'graphql' ||
    body.type === 'urlencoded'
  ) {
    body = { ...body, content: sub(body.content) };
  } else if (body.type === 'form-data' && body.formRows) {
    body = {
      ...body,
      formRows: body.formRows.map((row) =>
        row.kind === 'text'
          ? { ...row, key: sub(row.key), value: sub(row.value) }
          : { ...row, key: sub(row.key) },
      ),
    };
  }

  const inheritedAuth = resolveInheritedAuth({
    requestAuth: request.auth ?? { type: 'none' },
    folderId: request.folderId,
    folders: synced.collections.folders,
  });
  const auth = resolveAuthVariables(inheritedAuth, sub);

  return { request: { ...request, url, headers, query, body, auth }, missing: [...missing] };
}

/** Interpolate `{{var}}` in every string-valued auth field; `type` is left verbatim. */
function resolveAuthVariables(auth: RequestAuth, sub: (input: string) => string): RequestAuth {
  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(auth)) {
    resolved[key] = key !== 'type' && typeof value === 'string' ? sub(value) : value;
  }
  return resolved as unknown as RequestAuth;
}

// ---------------------------------------------------------------------------
// RequestRun construction
// ---------------------------------------------------------------------------

function orphanRun(id: string, requestId: string, error: string): RequestRun {
  return {
    id,
    requestId,
    startedAt: new Date().toISOString(),
    durationMs: 0,
    status: null,
    statusText: '',
    ok: false,
    error,
    url: '',
    method: '',
    requestHeaders: {},
    requestBodyPreview: null,
    responseHeaders: {},
    responseBodyPreview: '',
    responseBodyKind: 'empty',
    responseTruncated: false,
    assertions: [],
  };
}

function buildRequestRun(
  resolved: ApiRequest,
  result: ExecutionResult,
  assertions: RequestRun['assertions'],
): RequestRun {
  const { preview, truncated } = clampPreview(result.body ?? '');
  return {
    id: generateId(),
    requestId: resolved.id,
    startedAt: result.startedAt,
    durationMs: result.durationMs,
    status: result.status,
    statusText: result.statusText,
    ok: result.ok,
    error: result.error,
    url: redactUrlCredentials(result.url),
    method: result.method,
    requestHeaders: composeWireHeaders(resolved.headers),
    requestBodyPreview: previewRequestBody(resolved),
    responseHeaders: result.headers,
    responseBodyPreview: preview,
    responseBodyKind: result.bodyKind,
    responseTruncated: truncated,
    assertions,
  };
}

function clampPreview(value: string): { preview: string; truncated: boolean } {
  if (value.length <= RUN_BODY_PREVIEW_LIMIT) return { preview: value, truncated: false };
  return { preview: value.slice(0, RUN_BODY_PREVIEW_LIMIT), truncated: true };
}

/** Strip `user:pass@` userinfo before a URL enters persisted history. */
function redactUrlCredentials(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) {
      parsed.username = '';
      parsed.password = '';
      return parsed.toString();
    }
  } catch {
    /* not a parseable URL — leave it alone */
  }
  return url;
}

function composeWireHeaders(
  rows: ReadonlyArray<{ key: string; value: string; enabled: boolean }>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of rows) {
    if (!row.enabled) continue;
    const k = row.key.trim();
    if (k) out[k] = row.value;
  }
  return out;
}

function previewRequestBody(req: ApiRequest): string | null {
  const body = req.body;
  if (
    body.type === 'json' ||
    body.type === 'text' ||
    body.type === 'xml' ||
    body.type === 'urlencoded'
  ) {
    return clampPreview(body.content ?? '').preview;
  }
  if (body.type === 'graphql') {
    const envelope = JSON.stringify(
      { query: body.content ?? '', variables: body.variables ?? '' },
      null,
      2,
    );
    return clampPreview(envelope).preview;
  }
  return null;
}
