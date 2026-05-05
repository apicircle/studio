import type {
  AttachmentRef,
  Assertion,
  ConnectedRepo,
  Environment,
  LinkedSnapshot,
  FormDataRow,
  GitHubSession,
  HttpMethod,
  LinkedWorkspace,
  PanelId,
  PlanRun,
  ReleaseHistory,
  ContextExtraction,
  GlobalGraphQL,
  GlobalSchema,
  Request as ApiRequest,
  RequestAuth,
  RequestBody,
  RequestRun,
  ThemeId,
  WorkingBranch,
  WorkspaceLocal,
  WorkspaceSynced,
} from '@apicircle/shared';
import { type GitHubRepo, GitHubClient, MissingScopeError } from '@apicircle/git';
import { RUN_BODY_PREVIEW_LIMIT, generateId } from '@apicircle/shared';
import {
  type AttachmentResolver,
  type ExecutionResult,
  type ParsedPostmanCollection,
  type ParsedPostmanEnvironment,
  type PublishReleaseArgs,
  type ResolutionMap,
  type ThreeWayDiff,
  applyMerge,
  buildScope,
  collectAttachmentSlots,
  computeThreeWayDiff,
  decryptString,
  deprecateRelease as deprecateReleaseAction,
  encryptString,
  executeRequest as coreExecuteRequest,
  extractContext,
  generateWorkingBranchName,
  parseCurl,
  publishRelease as publishReleaseAction,
  resolveInheritedAuth,
  resolveString,
  runAssertions,
  serializeWorkspaceForGit,
  tryParsePayload,
  validateBranchName,
  yankRelease as yankReleaseAction,
} from '@apicircle/core';
import { create } from 'zustand';
import {
  createAttachmentFromFile,
  deleteAttachment,
  deleteManyAttachments,
  getAttachment,
  materializeAttachment,
  putAttachment,
} from '../persistence/attachments';
import { getMasterKey } from '../persistence/secretKey';
import {
  WorkspaceMismatchError,
  loadWorkspace,
  recoverPartialWorkspace,
  resetWorkspace as resetWorkspaceStorage,
  saveLocal,
  saveSynced,
} from '../persistence/workspaceStorage';
import { applyTheme } from '../theme/applyTheme';
import { bytesToBase64 } from './attachmentBlobs';
import type { TreeEntryInput } from '@apicircle/git';
import {
  addFolder as addFolderAction,
  addRequest as addRequestAction,
  collectRequestSlotIds,
  removeFolder as removeFolderAction,
  removeRequest as removeRequestAction,
  setRequestAssertions as setRequestAssertionsAction,
  setRequestAuth as setRequestAuthAction,
  setRequestBody as setRequestBodyAction,
  renameFolder as renameFolderAction,
  setFolderAuth as setFolderAuthAction,
  setRequestBodySchemaId as setRequestBodySchemaIdAction,
  setRequestContextVars as setRequestContextVarsAction,
  setRequestCookies as setRequestCookiesAction,
  setRequestExtractions as setRequestExtractionsAction,
  setRequestGraphqlSchemaId as setRequestGraphqlSchemaIdAction,
  setRequestHeaders as setRequestHeadersAction,
  setRequestMethod as setRequestMethodAction,
  setRequestPathParams as setRequestPathParamsAction,
  setRequestQuery as setRequestQueryAction,
  setRequestUrl as setRequestUrlAction,
  renameRequest as renameRequestAction,
} from './editorActions';
import {
  addGlobalGraphQL as addGlobalGraphQLAction,
  addGlobalSchema as addGlobalSchemaAction,
  removeGlobalGraphQL as removeGlobalGraphQLAction,
  removeGlobalSchema as removeGlobalSchemaAction,
  updateGlobalGraphQL as updateGlobalGraphQLAction,
  updateGlobalSchema as updateGlobalSchemaAction,
} from './globalAssetsActions';
import {
  addEnvironment as addEnvironmentAction,
  addVariableRow as addVariableRowAction,
  duplicateEnvironment as duplicateEnvironmentAction,
  exportEnvironment as exportEnvironmentAction,
  removeEnvironment as removeEnvironmentAction,
  renameEnvironment as renameEnvironmentAction,
  setActiveEnvironment as setActiveEnvironmentAction,
  setPriorityOrder as setPriorityOrderAction,
  setVariables as setVariablesAction,
} from './envActions';
import {
  addSecretEntry as addSecretEntryAction,
  removeSecretEntry as removeSecretEntryAction,
  renameSecretEntry as renameSecretEntryAction,
} from './secretActions';
import {
  addPlan as addPlanAction,
  addPlanStep as addPlanStepAction,
  duplicatePlan as duplicatePlanAction,
  removePlan as removePlanAction,
  removePlanStep as removePlanStepAction,
  renamePlan as renamePlanAction,
  reorderPlanSteps as reorderPlanStepsAction,
  setPlanEnvPriority as setPlanEnvPriorityAction,
  setPlanStepEnabled as setPlanStepEnabledAction,
  setPlanStopOnFailure as setPlanStopOnFailureAction,
  setPlanVariables as setPlanVariablesAction,
} from './planActions';
import { recomputeUsedIn } from './usedInAggregator';
import { deleteSecretPayload, getSecretPayload, putSecretPayload } from '../persistence/secrets';

const attachmentResolver: AttachmentResolver = async (slotId) => {
  const record = await getAttachment(slotId);
  if (!record) return null;
  return { blob: materializeAttachment(record), filename: record.filename };
};

const PANEL_STORAGE_KEY = 'apicircle-v2:active-panel';
const VALID_PANELS: PanelId[] = [
  'workspace',
  'link-workspace',
  'editor',
  'env',
  'execution',
  'history',
  'help',
];
// Cap on the number of request runs kept in local history. Older runs get
// dropped — execution history is a circular buffer to keep IDB writes cheap.
const MAX_REQUEST_RUNS = 500;
// Plan-runs are coarser-grained than request-runs; cap separately so the
// list stays browsable without competing for the request-run buffer.
const MAX_PLAN_RUNS = 200;

/**
 * Module-scoped set of plan ids whose `runPlan` is currently in flight.
 * Populated by `runPlan` for the duration of one execution; a second
 * `runPlan(samePlanId)` while the first is still running throws
 * 'plan already running' so the caller can surface a toast rather than
 * accidentally interleaving two runs on the same plan (their assertion
 * tallies + globalContext extractions would step on each other).
 */
const inflightPlanRuns = new Set<string>();

/** Truncate `value` to `RUN_BODY_PREVIEW_LIMIT` UTF-16 code units. */
function clampPreview(value: string): { preview: string; truncated: boolean } {
  if (value.length <= RUN_BODY_PREVIEW_LIMIT) return { preview: value, truncated: false };
  return { preview: value.slice(0, RUN_BODY_PREVIEW_LIMIT), truncated: true };
}

/**
 * Pull a stringy preview of the request body for history. Returns null for
 * binary / form-data / no-body cases — those don't make sense to display
 * inline in the History detail view.
 */
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

/** Build a RequestRun record from a resolved request + the executor result. */
function buildRequestRun(
  resolvedRequest: ApiRequest,
  result: ExecutionResult,
  assertions: RequestRun['assertions'],
): RequestRun {
  const { preview: responseBodyPreview, truncated } = clampPreview(result.body ?? '');
  return {
    id: generateId(),
    requestId: resolvedRequest.id,
    startedAt: result.startedAt,
    durationMs: result.durationMs,
    status: result.status,
    statusText: result.statusText,
    ok: result.ok,
    error: result.error,
    url: result.url,
    method: result.method,
    requestHeaders: composeWireHeaders(resolvedRequest.headers),
    requestBodyPreview: previewRequestBody(resolvedRequest),
    responseHeaders: result.headers,
    responseBodyPreview,
    responseBodyKind: result.bodyKind,
    responseTruncated: truncated,
    assertions,
  };
}

/**
 * Local stand-in for `composeHeaders` from core — kept inline so this file
 * doesn't grow another core import. Mirrors the exact shape we send.
 */
function composeWireHeaders(
  rows: ReadonlyArray<{ key: string; value: string; enabled: boolean }>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of rows) {
    if (!row.enabled) continue;
    const k = row.key.trim();
    if (!k) continue;
    out[k] = row.value;
  }
  return out;
}

function readStoredPanel(): PanelId {
  if (typeof localStorage === 'undefined') return 'editor';
  try {
    const stored = localStorage.getItem(PANEL_STORAGE_KEY);
    if (stored && (VALID_PANELS as string[]).includes(stored)) return stored as PanelId;
  } catch {
    // ignore
  }
  return 'editor';
}

function writeStoredPanel(panel: PanelId): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(PANEL_STORAGE_KEY, panel);
  } catch {
    // ignore
  }
}

export type RefreshOutcome =
  | { status: 'no-remote' }
  | { status: 'up-to-date' }
  | { status: 'merged' }
  | { status: 'conflicts'; diff: ThreeWayDiff };

interface PendingRefresh {
  diff: ThreeWayDiff;
  remote: WorkspaceSynced;
  remoteSha: string;
}

/**
 * Ephemeral UI state for the History panel. Filters + selected-run live here
 * so the sidebar (filters) and main area (run list + detail) stay in sync
 * without prop-drilling.
 */
export interface HistoryUiState {
  tab: 'requests' | 'plans';
  search: string;
  /** Status buckets to keep visible. Empty = no status filter. */
  statusBuckets: Array<'ok' | '4xx' | '5xx' | 'error'>;
  /** HTTP methods to keep visible. Empty = no method filter. */
  methods: string[];
  fromDate: string | null;
  toDate: string | null;
  selectedRunId: string | null;
}

const EMPTY_HISTORY_UI: HistoryUiState = {
  tab: 'requests',
  search: '',
  statusBuckets: [],
  methods: [],
  fromDate: null,
  toDate: null,
  selectedRunId: null,
};

/** Surfaced when `hydrate()` cannot load the persisted workspace cleanly. */
export interface HydrationError {
  message: string;
  /** When known, the workspaceIds we found in IDB (helps the user understand what they'd lose if they reset). */
  syncedWorkspaceId: string | null;
  localWorkspaceId: string | null;
}

type WorkspaceStore = {
  ready: boolean;
  /**
   * Set when hydrate() fails (unreadable IDB record, schema mismatch, etc.).
   * The App renders a recovery UI rather than auto-wiping the user's data.
   */
  hydrationError: HydrationError | null;
  synced: WorkspaceSynced | null;
  local: WorkspaceLocal | null;

  activePanel: PanelId;
  secretVaultOpen: boolean;
  /** Stashed during refreshWorkspace when conflicts surface; consumed by commitRefresh. */
  pendingRefresh: PendingRefresh | null;
  /**
   * In-memory selection for the Execution panel — the plan whose editor
   * is currently open. Not persisted: a fresh tab opens to "first plan
   * by updatedAt desc, or empty state".
   */
  activePlanId: string | null;
  /**
   * Plan §3.7: any 401/403 missing-scope from a GitHub action surfaces a
   * modal that points the user to the Sessions tab. Lives in store state
   * so a failure on one panel can render the modal regardless of which
   * panel is active.
   */
  missingScopePrompt: string[] | null;
  /**
   * Ephemeral UI state for the History panel — not persisted. Lives on the
   * store so the sidebar (filters) and main area (run list + detail) can
   * share state without a parent prop drill.
   */
  historyUi: HistoryUiState;
  setHistoryUi: (next: Partial<HistoryUiState>) => void;
  // Per-request last-run cache. Not persisted — request runs land in
  // local.history once they complete; this is the live working result for
  // the editor panel.
  lastRun: Record<string, ExecutionResult | null>;
  // Transient per-plan run details, keyed by planId. Populated after each
  // runPlan completes so the Execution panel can show per-step request,
  // status, response body, and assertion verdicts. Not persisted.
  lastPlanResults: Record<
    string,
    Array<{
      result: ExecutionResult;
      assertionResults: ReadonlyArray<RequestRun['assertions'][number]>;
      passed: boolean;
      requestName: string;
      requestMethod: string;
    }>
  >;
  isExecuting: Record<string, boolean>;

  hydrate: () => Promise<void>;

  setActivePanel: (panel: PanelId) => void;
  setActiveRequestId: (id: string | null) => void;
  toggleSidebarSection: (section: string) => void;
  setThemeId: (themeId: ThemeId) => void;
  setWorkspaceName: (name: string) => void;
  /** Toggle the pre-send validation panel (local.settings.validateOnSend). */
  setValidateOnSend: (value: boolean) => void;

  /** Remove a mock definition from the workspace. No runtime side effect. */
  removeMockServer: (id: string) => void;

  openSecretVault: () => void;
  closeSecretVault: () => void;

  /** Open the missing-scope prompt with the supplied list of scopes. */
  surfaceMissingScope: (scopes: string[]) => void;
  /** Dismiss the prompt without changing anything else. */
  dismissMissingScope: () => void;

  addRequest: (parentFolderId: string | null, name?: string) => string;
  /**
   * Parse a `curl` command and create a new request seeded with the
   * parsed method/URL/headers/body/auth. Selects the new request as
   * active. Returns its id + any warnings the parser surfaced (unknown
   * flags, file fields that need re-attaching, etc).
   */
  addRequestFromCurl: (
    curl: string,
    parentFolderId?: string | null,
  ) => { id: string; warnings: string[] };
  addFolder: (parentFolderId: string | null, name?: string) => string;
  removeFolder: (id: string) => void;
  removeRequest: (id: string) => void;
  renameRequest: (id: string, name: string) => void;
  renameFolder: (id: string, name: string) => void;
  /**
   * Wipes both IDB records and re-seeds an empty workspace. Only invoke from
   * an explicit user confirmation flow (e.g. the recovery banner shown after
   * `hydrationError` fires). The hydrate path no longer calls this implicitly.
   */
  resetWorkspace: () => Promise<void>;
  /**
   * Best-effort recovery from a partial-record state. Preserves whichever
   * side has data and rebuilds the missing partner with a matching
   * workspaceId. Returns `'recovered'` on success, `'no-data'` if both
   * records are empty (caller may want to fall through to resetWorkspace).
   */
  recoverPartialWorkspace: () => Promise<'recovered' | 'no-data'>;
  setRequestMethod: (id: string, method: HttpMethod) => void;
  setRequestUrl: (id: string, url: string) => void;
  setRequestBody: (id: string, body: RequestBody) => void;
  setRequestHeaders: (id: string, headers: ApiRequest['headers']) => void;
  setRequestQuery: (id: string, query: ApiRequest['query']) => void;
  setRequestPathParams: (id: string, pathParams: Record<string, string>) => void;
  setRequestCookies: (id: string, cookies: NonNullable<ApiRequest['cookies']>) => void;
  setRequestAssertions: (id: string, assertions: Assertion[]) => void;
  setRequestAuth: (id: string, auth: RequestAuth) => void;
  /** Set folder-level auth. Pass `undefined` to clear (folder becomes transparent on `inherit` walks). */
  setFolderAuth: (folderId: string, auth: RequestAuth | undefined) => void;
  /**
   * Import a parsed Postman v2.1 collection into the synced workspace. Wraps
   * the imported tree in a folder named after the collection. Returns counts
   * (`folders` includes the wrapper).
   */
  importPostmanCollection: (
    parsed: ParsedPostmanCollection,
    parentFolderId?: string | null,
  ) => { folders: number; requests: number };
  /**
   * Import a parsed Postman environment. Returns the final env name
   * (uniquified if it collided), or null if no synced doc was loaded.
   */
  importPostmanEnvironment: (parsed: ParsedPostmanEnvironment) => string | null;
  setRequestExtractions: (id: string, extractions: ContextExtraction[]) => void;
  setRequestContextVars: (id: string, contextVars: ApiRequest['contextVars']) => void;
  setRequestBodySchemaId: (id: string, schemaId: string | null) => void;
  setRequestGraphqlSchemaId: (id: string, schemaId: string | null) => void;

  // --- Global Assets library (P17) -----------------------------------
  addGlobalSchema: (init: { name: string; schema?: string; description?: string }) => string;
  updateGlobalSchema: (id: string, patch: Partial<Omit<GlobalSchema, 'id' | 'createdAt'>>) => void;
  removeGlobalSchema: (id: string) => void;
  addGlobalGraphQL: (init: {
    name: string;
    source?: string;
    kind?: GlobalGraphQL['kind'];
    description?: string;
  }) => string;
  updateGlobalGraphQL: (
    id: string,
    patch: Partial<Omit<GlobalGraphQL, 'id' | 'createdAt'>>,
  ) => void;
  removeGlobalGraphQL: (id: string) => void;
  /** Open/close the Global Assets library modal. */
  globalAssetsOpen: boolean;
  openGlobalAssets: () => void;
  closeGlobalAssets: () => void;

  // --- Linked-request overrides (P20) ---------------------------------
  /**
   * Replace the override patch for a linked workspace's request. The
   * patch may only include override-allowed fields: headers, contextVars,
   * assertions, extractions. Other fields are read straight from the
   * source workspace's snapshot.
   *
   * Pass an empty patch to clear the override (it'll round-trip to no-op
   * via the mergeRequestOverride helper) — or call clearLinkedRequestOverride.
   */
  setLinkedRequestOverride: (
    linkedWorkspaceId: string,
    itemId: string,
    patch: Record<string, unknown>,
  ) => void;
  /** Drop any local override for a linked workspace's request. */
  clearLinkedRequestOverride: (linkedWorkspaceId: string, itemId: string) => void;
  /** Currently-viewed linked request, if any. Drives LinkedRequestEditor. */
  activeLinkedRequest: { linkedWorkspaceId: string; itemId: string } | null;
  setActiveLinkedRequest: (id: { linkedWorkspaceId: string; itemId: string } | null) => void;
  /**
   * Drop a single key from the local-only globalContext map. Used by the
   * Context tab's "Forget extracted value" action.
   */
  removeGlobalContextKey: (key: string) => void;
  /** Clear every key in globalContext. */
  clearGlobalContext: () => void;

  // Form-data: replace the rows array. The store cleans up orphaned
  // attachment blobs (rows whose slotId is no longer present) automatically.
  setRequestFormRows: (id: string, rows: FormDataRow[]) => void;
  // Pick a file for a form-data row. Writes the blob to the attachments DB,
  // updates the row's slotId/filename/size/mimeType. The previous slotId for
  // that row (if any) is freed.
  attachFormFile: (requestId: string, rowIndex: number, file: File) => Promise<void>;
  detachFormFile: (requestId: string, rowIndex: number) => Promise<void>;

  // Binary: pick a file for the request body. Writes the blob to attachments,
  // sets body.attachment to point at it, and frees any previous slot.
  attachBinaryFile: (requestId: string, file: File) => Promise<void>;
  detachBinaryFile: (requestId: string) => Promise<void>;

  // Environments
  addEnvironment: (name: string) => void;
  removeEnvironment: (name: string) => void;
  renameEnvironment: (oldName: string, newName: string) => void;
  /**
   * Clone an environment under "<name> (copy)" (or `(copy 2)`, … if a
   * collision exists). Variables are copied verbatim — encrypted vars
   * keep their secretKeyId binding and resolve via the same vault key.
   */
  duplicateEnvironment: (name: string) => void;
  /**
   * Serialize an environment to a JSON string suitable for download or
   * sharing. Encrypted vars omit their value (only the secretKeyId
   * survives) so secrets never leave the local vault.
   */
  exportEnvironment: (name: string) => string | null;
  setActiveEnvironment: (name: string | null) => void;
  setPriorityOrder: (order: string[]) => void;
  setVariables: (envName: string, variables: Environment['variables']) => void;
  addVariableRow: (envName: string) => void;
  /**
   * Set a variable's value, encrypting it on the way in if `encrypted` is
   * true. Existing encrypted ciphertext is rotated under the same key.
   */
  setVariableValue: (envName: string, index: number, value: string, encrypted: boolean) => void;
  /**
   * Bind an environment variable to a vault secret-key id. Sets
   * encrypted=true, clears any stale plaintext value, and backfills the
   * synced `secretKeys` map so collaborators see the label.
   */
  bindVariableToSecretKey: (envName: string, index: number, secretKeyId: string) => void;
  /** Reverse of bindVariableToSecretKey: clear secretKeyId + return to plain. */
  unbindVariableSecretKey: (envName: string, index: number) => void;
  /** Transient panel focus — which env's variables the panel is editing. */
  envFocus: string | null;
  setEnvFocus: (name: string | null) => void;

  // Secret Vault
  /**
   * Create a Secret Vault entry. The plaintext is encrypted under the local
   * master key and persisted in the secrets IDB; the index entry (label,
   * origin, usedIn) lives in `WorkspaceLocal.secretIndex`. Resolves to the
   * generated secret id.
   */
  addSecret: (args: {
    label: string;
    value: string;
    origin?: 'workspace' | 'linked';
    linkedWorkspaceId?: string;
    linkedKeyId?: string;
  }) => Promise<string>;
  /**
   * Replace the encrypted value for an existing secret. Returns true on
   * success, false when the id is unknown.
   */
  setSecretValue: (id: string, value: string) => Promise<boolean>;
  /** Decrypt and return the plaintext value of a vault secret. */
  decryptSecret: (id: string) => Promise<string | null>;
  renameSecret: (id: string, label: string) => void;
  /** Remove the secret index entry and its encrypted payload. */
  removeSecret: (id: string) => Promise<void>;
  /** Force-recompute the `usedIn` index for every secret. */
  recomputeSecretUsage: () => void;

  // GitHub session — see Plan §3.6 + revision #6.
  /**
   * Connect a GitHub PAT. Verifies it via GET /user, encrypts via the master
   * key and stores in the secret vault, captures account login + granted
   * scopes into `local.sessions.github`. Returns the resolved session on
   * success; throws on rejected token or insufficient base scopes.
   */
  connectGitHubSession: (token: string) => Promise<GitHubSession>;
  /**
   * Re-verify the active session against GitHub and refresh granted scopes.
   * Returns the updated scopes or null when no session exists.
   */
  verifyGitHubScopes: () => Promise<string[] | null>;
  /**
   * Replace the PAT for the active session without losing branch/PR state.
   * Re-verifies + refreshes scopes in the same pass.
   */
  updateGitHubToken: (token: string) => Promise<GitHubSession>;
  /** Disconnect: free the encrypted token, clear the session entry. */
  disconnectGitHubSession: () => Promise<void>;

  // Repo + working-branch flow (P4.2)
  /**
   * Validate access to a GitHub repo via `GET /repos/:owner/:name` and
   * persist the connection metadata into `local.connectedRepo`. Throws
   * when no GitHub session is active or the repo is inaccessible.
   */
  connectRepo: (owner: string, name: string) => Promise<ConnectedRepo>;
  /**
   * Drop the connected repo and any working branch tied to it.
   */
  disconnectRepo: () => void;
  /**
   * Auto-create a new branch from `connectedRepo.defaultBranch` (or
   * caller-supplied baseBranch). Generates `apicircle/<slug>-<id>` when
   * no name is supplied. Throws on validation failure or GitHub error.
   */
  createWorkingBranch: (opts?: {
    branchName?: string;
    baseBranch?: string;
  }) => Promise<WorkingBranch>;
  /**
   * Drop the working branch slot without touching the remote ref. The
   * user typically rotates after a PR merges.
   */
  discardWorkingBranch: () => void;

  /**
   * Atomically commit the current synced doc + every referenced
   * attachment as one Git Tree commit on the working branch. Round-trip
   * is: read branch ref → read its tree → upload each new attachment as
   * a blob → create new tree (base_tree + workspace.json inline +
   * `.apicircle/attachments/<slotId>` per attachment) → create commit →
   * fast-forward the ref. On success, updates `workingBranch.headSha`
   * and `lastPushedSha`. Throws on missing-session, missing-repo,
   * missing-branch, or any GitHub error.
   *
   * Attachments whose bytes aren't in local IDB (e.g. pulled but not
   * downloaded) are skipped — `base_tree` keeps the existing entry
   * intact, so they don't get overwritten on the remote.
   */
  pushWorkspace: (commitMessage?: string) => Promise<{ commitSha: string }>;

  /**
   * Open a pull request from the working branch into its base. Requires a
   * prior push (lastPushedSha != null) — there's nothing to merge before
   * the first commit. Defaults: title "APICircle workspace updates",
   * body empty, draft false. On success, persists `openPrUrl` on
   * workingBranch and returns the PR number + URL.
   *
   * Throws MissingScopeError when the token lacks `pull_request` — the UI
   * catches that to prompt the user to update their token without losing
   * branch state (Plan §3.7).
   */
  createPullRequest: (args?: {
    title?: string;
    body?: string;
    draft?: boolean;
  }) => Promise<{ number: number; htmlUrl: string }>;

  /**
   * Walk every attachment slot referenced in the synced doc; for each
   * one whose bytes aren't in local IDB (or whose recorded sha256 has
   * drifted), pull the blob from `.apicircle/attachments/<slotId>` on
   * the working branch and persist it. Returns counts so the UI can
   * report results (plan §7.6 — refresh attachment download).
   */
  syncAttachments: () => Promise<{ fetched: number; alreadyPresent: number; failed: number }>;

  /**
   * Pull remote `workspace.json` from the working branch and reconcile
   * it with local via 3-way diff (plan §3.5). Outcomes:
   *   - 'no-remote': the working branch has no workspace.json yet (the
   *     first push hasn't happened) → returned as a no-op.
   *   - 'up-to-date': local + remote agree → only the snapshot/sha is
   *     refreshed.
   *   - 'merged': diff was non-empty but had no conflicts; all
   *     fast-forwards applied and persisted.
   *   - 'conflicts': diff has conflicts. The pending diff + remote doc
   *     are stashed in store state for the resolver modal; the caller
   *     finishes the merge by calling `commitRefresh(resolutions)`.
   */
  refreshWorkspace: () => Promise<RefreshOutcome>;

  /**
   * Apply user-resolved conflicts from the resolver modal. Picks up the
   * pending diff stashed by `refreshWorkspace`, runs `applyMerge`, and
   * persists the merged synced doc + updated sync snapshot.
   */
  commitRefresh: (resolutions: ResolutionMap) => Promise<void>;
  /** Drop the pending refresh without applying anything. */
  cancelRefresh: () => void;

  // --- Releases (workspace-self) ---------------------------------------
  /**
   * Append a new entry to `synced.releases.self.versions` and bump
   * `currentVersion`. The snapshot SHA is computed over the canonical
   * pre-publish workspace.json (plan §5.1). Throws on invalid semver or
   * duplicate version.
   */
  publishRelease: (args: PublishReleaseArgs) => Promise<void>;
  /** Flip `deprecated: true` on a published version. */
  deprecateRelease: (version: string) => void;
  /** Flip `yanked: true` on a published version. Soft destructive. */
  yankRelease: (version: string) => void;

  // --- Linked workspaces (P5.2) ---------------------------------------
  /**
   * Link another workspace as a private dependency. Fetches its
   * `workspace.json` from `repoFullName@branch` via the active GitHub
   * session, persists a LinkedWorkspace entry, and caches the source's
   * release ledger into `releases.perLink[id]`.
   *
   * Pin defaults to the source's `currentVersion` (or null when the
   * source hasn't published anything yet). Throws on missing session,
   * 404, or invalid remote JSON.
   */
  linkPrivateWorkspace: (args: {
    repoFullName: string;
    branch: string;
    pinnedVersion?: string | null;
  }) => Promise<LinkedWorkspace>;

  /**
   * Same fetch flow as `linkPrivateWorkspace` but tags the result as
   * `kind: 'public'`. Used by the marketplace "Link to workspace"
   * action — the source workspace is publicly readable on GitHub.
   */
  linkPublicWorkspace: (args: {
    repoFullName: string;
    branch: string;
    pinnedVersion?: string | null;
    marketplace?: { listedAs: string; tags: string[]; summary: string };
  }) => Promise<LinkedWorkspace>;

  /**
   * Search GitHub for repos tagged `topic:apicircle-marketplace` plus
   * the user-supplied query. Returns at most 30 results.
   */
  searchMarketplace: (query: string) => Promise<
    Array<{
      fullName: string;
      owner: string;
      name: string;
      description: string;
      topics: string[];
      stargazers: number;
      defaultBranch: string;
    }>
  >;

  /**
   * Re-fetch the linked workspace's `workspace.json` and refresh the
   * cached release ledger in `releases.perLink[id]`. Throws when the
   * link is unknown.
   */
  refreshLinkedWorkspace: (id: string) => Promise<void>;

  /** Drop a linked workspace + its cached release ledger. */
  unlinkWorkspace: (id: string) => void;

  // --- Execution plans (P6) -------------------------------------------
  setActivePlanId: (id: string | null) => void;
  /** Create a new local-only execution plan. Returns the new plan's id. */
  addPlan: (name?: string) => string;
  /** Drop a plan AND its plan-run history rows. */
  removePlan: (id: string) => void;
  renamePlan: (id: string, name: string) => void;
  /**
   * Clone a plan under "<name> (copy)" with the same steps + env
   * priority + variables + stopOnAssertionFailure. The clone gets a
   * fresh id and timestamps so plan-run history stays scoped to the
   * original plan. Returns the new plan's id, or null if the source
   * was unknown.
   */
  duplicatePlan: (planId: string) => string | null;
  addPlanStep: (planId: string, requestId: string, linkedWorkspaceId?: string) => void;
  removePlanStep: (planId: string, stepIndex: number) => void;
  reorderPlanSteps: (planId: string, fromIndex: number, toIndex: number) => void;
  /**
   * Toggle a step's `enabled` flag. Disabled steps stay in the plan but
   * are skipped by `runPlan`.
   */
  setPlanStepEnabled: (planId: string, stepIndex: number, enabled: boolean) => void;
  /**
   * Plan-level env priority overrides the workspace's global order
   * during runs of this plan. Empty array = no override.
   */
  setPlanEnvPriority: (planId: string, priorityOrder: readonly string[]) => void;
  /**
   * Set the plan's `stopOnAssertionFailure` flag. Only honored by
   * runPlan when launched `withAssertions`.
   */
  setPlanStopOnFailure: (planId: string, stopOnAssertionFailure: boolean) => void;
  /** Replace the plan's variable list. */
  setPlanVariables: (
    planId: string,
    variables: ReadonlyArray<{ key: string; value: string }>,
  ) => void;
  /**
   * Run every step of a plan in order. With assertions enabled, each
   * request's assertions are evaluated and the verdict aggregated into
   * the plan-run summary; without, only the request runs themselves are
   * persisted (no assertion verdicts in the plan-run row).
   *
   * Throws `'plan already running'` if the same plan id is already in
   * the inflight set — the UI must surface this rather than queue a
   * second run.
   */
  runPlan: (planId: string, opts?: { withAssertions?: boolean }) => Promise<PlanRun>;

  /**
   * Replay a recorded request run by re-firing the source request as it
   * exists today. The original RequestRun captures wire-level detail
   * but not the full request snapshot — replays use the live request
   * from `synced.collections.requests`. Returns the new RequestRun, or
   * `null` if the source request has been deleted (UI surfaces this as
   * a disabled/tooltipped button).
   */
  replayRequestRun: (runId: string) => Promise<RequestRun | null>;

  // --- History (local-only) -------------------------------------------
  /**
   * Drop a single request run from local history. Used by the per-row
   * delete control in HistoryPanel.
   */
  removeRequestRun: (runId: string) => void;
  /**
   * Drop a single plan run from local history.
   */
  removePlanRun: (runId: string) => void;
  /**
   * Wipe all request runs. Optional `predicate` filters which rows
   * survive — used by "clear runs for this request" actions.
   */
  clearRequestRuns: (predicate?: (run: RequestRun) => boolean) => void;
  /**
   * Wipe all plan runs. Optional `predicate` filters which rows survive.
   */
  clearPlanRuns: (predicate?: (run: PlanRun) => boolean) => void;

  /**
   * Pin (or unpin via `null`) a linked workspace to a specific version.
   * Throws when the link is unknown, or when `version` is non-null but
   * doesn't appear in the cached `releases.perLink[id]` ledger — pin to
   * something we can't see is a footgun.
   */
  pinLinkedVersion: (id: string, version: string | null) => void;

  /**
   * Declare a new required secret key on a linked workspace card.
   * Keys are de-duped. Use `provisionLinkedSecret` to fill in the value.
   */
  addLinkedRequiredKey: (linkId: string, keyId: string) => void;
  /**
   * Drop a required key from the link AND remove its provisioned vault
   * secret (if any). Use ConfirmDialog at the call site to gate the
   * destructive part.
   */
  removeLinkedRequiredKey: (linkId: string, keyId: string) => Promise<void>;
  /**
   * Encrypt + persist a value for a required key. Creates a Secret
   * Vault entry tagged `origin: 'linked'` with the linkedWorkspaceId
   * + linkedKeyId set; rotates the ciphertext when the key is already
   * provisioned. Returns the secret entry id.
   */
  provisionLinkedSecret: (linkId: string, keyId: string, value: string) => Promise<string>;

  executeActiveRequest: () => Promise<void>;
};

/**
 * Required base scopes for the connect flow. Push-to-save needs `repo`;
 * `pull_request` is required only for PR creation, surfaced as a warning
 * at connect time via the UI guidance copy. The verify step on connect
 * throws MissingScopeError when REQUIRED_BASE_SCOPES are missing.
 */
const REQUIRED_BASE_SCOPES = ['repo'] as const;
const GITHUB_TOKEN_LABEL_PREFIX = 'github-token:';

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
  ready: false,
  hydrationError: null,
  synced: null,
  local: null,
  historyUi: EMPTY_HISTORY_UI,
  setHistoryUi: (next) => set((s) => ({ historyUi: { ...s.historyUi, ...next } })),
  activePanel: readStoredPanel(),
  secretVaultOpen: false,
  globalAssetsOpen: false,
  activeLinkedRequest: null,
  pendingRefresh: null,
  missingScopePrompt: null,
  activePlanId: null,
  lastRun: {},
  lastPlanResults: {},
  isExecuting: {},
  envFocus: null,

  hydrate: async () => {
    try {
      const { synced, local } = await loadWorkspace();
      applyTheme(local.ui.themeId);
      // One-shot legacy migration: rows that were encrypted with the master
      // key (no secretKeyId) get decrypted in-place to plaintext, so the
      // new vault-key-only encryption model has a clean baseline.
      const migrated = await migrateLegacyEncryptedEnvVars(synced);
      if (migrated !== synced) {
        try {
          await saveSynced(migrated);
        } catch (saveErr) {
          console.error('[workspace.hydrate] legacy env-var migration could not persist', saveErr);
        }
      }
      set({ ready: true, hydrationError: null, synced: migrated, local });
    } catch (err) {
      // Surface the failure instead of overwriting IDB. The previous behavior
      // (auto-reset to a fresh workspace) destroyed user data on any
      // transient hiccup. Keep IDB intact and render a recovery UI in App.
      console.error('[workspace.hydrate] failed', err);
      const message = err instanceof Error ? err.message : String(err);
      const syncedWorkspaceId =
        err instanceof WorkspaceMismatchError ? err.syncedWorkspaceId : null;
      const localWorkspaceId = err instanceof WorkspaceMismatchError ? err.localWorkspaceId : null;
      set({
        ready: false,
        hydrationError: { message, syncedWorkspaceId, localWorkspaceId },
        synced: null,
        local: null,
      });
    }
  },

  /**
   * Deliberate user-initiated reset. Wipes both IDB records and re-seeds an
   * empty workspace. Only call from a confirmation flow surfaced after a
   * hydrationError — never automatically.
   */
  resetWorkspace: async () => {
    const { synced, local } = await resetWorkspaceStorage();
    applyTheme(local.ui.themeId);
    set({ ready: true, hydrationError: null, synced, local });
  },

  recoverPartialWorkspace: async () => {
    const result = await recoverPartialWorkspace();
    if (!result) return 'no-data';
    applyTheme(result.local.ui.themeId);
    set({
      ready: true,
      hydrationError: null,
      synced: result.synced,
      local: result.local,
    });
    return 'recovered';
  },

  setActivePanel: (panel) => {
    writeStoredPanel(panel);
    set({ activePanel: panel });
  },

  setActiveRequestId: (id) => {
    const local = get().local;
    if (!local) return;
    const next: WorkspaceLocal = { ...local, ui: { ...local.ui, activeRequestId: id } };
    set({ local: next });
    void saveLocal(next);
  },

  toggleSidebarSection: (section) => {
    const local = get().local;
    if (!local) return;
    const expanded = local.ui.sidebarExpandedSections;
    const isOpen = expanded.includes(section);
    const nextExpanded = isOpen ? expanded.filter((s) => s !== section) : [...expanded, section];
    const next: WorkspaceLocal = {
      ...local,
      ui: { ...local.ui, sidebarExpandedSections: nextExpanded },
    };
    set({ local: next });
    void saveLocal(next);
  },

  setThemeId: (themeId) => {
    const local = get().local;
    if (!local) return;
    const next: WorkspaceLocal = { ...local, ui: { ...local.ui, themeId } };
    applyTheme(themeId);
    set({ local: next });
    void saveLocal(next);
  },

  setValidateOnSend: (value) => {
    const local = get().local;
    if (!local) return;
    const next: WorkspaceLocal = {
      ...local,
      settings: { ...local.settings, validateOnSend: value },
    };
    set({ local: next });
    void saveLocal(next);
  },

  setWorkspaceName: (name) => {
    const synced = get().synced;
    if (!synced) return;
    const nextSynced: WorkspaceSynced = {
      ...synced,
      workspaceName: name,
      meta: { ...synced.meta, updatedAt: new Date().toISOString() },
    };
    set({ synced: nextSynced });
    void saveSynced(nextSynced);
  },

  // Delete a mock definition. Pure data op — the runtime is the Desktop
  // bridge's job and stays gated behind `apicircleDesktop.mock`.
  // Creation is intentionally MCP-only in the web UI: the OpenAPI /
  // Postman / Insomnia parsers (swagger-parser et al) are Node-only and
  // can't run in the browser without significant rework. See
  // MockServersPanel for the empty-state guidance pointing users at the
  // MCP `mock.create_from_*` tools / CLI / Desktop instead.
  removeMockServer: (id) => {
    const synced = get().synced;
    if (!synced || !synced.mockServers[id]) return;
    const { [id]: _drop, ...rest } = synced.mockServers;
    void _drop;
    const nextSynced: WorkspaceSynced = {
      ...synced,
      mockServers: rest,
      meta: { ...synced.meta, updatedAt: new Date().toISOString() },
    };
    set({ synced: nextSynced });
    void saveSynced(nextSynced);
  },

  openSecretVault: () => set({ secretVaultOpen: true }),
  closeSecretVault: () => set({ secretVaultOpen: false }),

  surfaceMissingScope: (scopes) => set({ missingScopePrompt: scopes }),
  dismissMissingScope: () => set({ missingScopePrompt: null }),

  addRequest: (parentFolderId, name) => {
    const synced = get().synced;
    if (!synced) return '';
    const { synced: nextSynced, request } = addRequestAction(synced, parentFolderId, name);
    set({ synced: nextSynced });
    void saveSynced(nextSynced);
    // Auto-select the new request.
    get().setActiveRequestId(request.id);
    return request.id;
  },

  addRequestFromCurl: (curl, parentFolderId = null) => {
    const synced = get().synced;
    if (!synced) return { id: '', warnings: ['Workspace not ready'] };
    const parsed = parseCurl(curl);
    const { synced: withRequest, request } = addRequestAction(synced, parentFolderId);
    // Build a friendlier name from the URL path.
    let displayName = request.name;
    try {
      const u = new URL(parsed.url);
      const path = u.pathname.replace(/\/$/, '') || '/';
      displayName = `${parsed.method} ${path}`;
    } catch {
      if (parsed.url) displayName = `${parsed.method} ${parsed.url}`;
    }
    const seeded = {
      ...withRequest,
      collections: {
        ...withRequest.collections,
        requests: {
          ...withRequest.collections.requests,
          [request.id]: {
            ...request,
            name: displayName,
            method: parsed.method,
            url: parsed.url,
            headers: parsed.headers,
            query: parsed.query,
            body: parsed.body,
            auth: parsed.auth,
            updatedAt: new Date().toISOString(),
          },
        },
      },
      meta: { ...withRequest.meta, updatedAt: new Date().toISOString() },
    };
    set({ synced: seeded });
    void saveSynced(seeded);
    get().setActiveRequestId(request.id);
    return { id: request.id, warnings: parsed.warnings };
  },

  addFolder: (parentFolderId, name) => {
    const synced = get().synced;
    if (!synced) return '';
    const { synced: nextSynced, folder } = addFolderAction(synced, parentFolderId, name);
    set({ synced: nextSynced });
    void saveSynced(nextSynced);
    return folder.id;
  },

  removeFolder: (id) => {
    const synced = get().synced;
    if (!synced) return;
    const { synced: next, deletedRequestIds } = removeFolderAction(synced, id);
    if (next === synced) return;
    set({ synced: next });
    void saveSynced(next);
    // Free attachments of every cascaded request, mirroring removeRequest.
    const slotIds: string[] = [];
    for (const rid of deletedRequestIds) {
      const original = synced.collections.requests[rid];
      if (original) slotIds.push(...collectRequestSlotIds(original));
    }
    if (slotIds.length > 0) void deleteManyAttachments(slotIds);
    const activeId = get().local?.ui.activeRequestId ?? null;
    if (activeId && deletedRequestIds.includes(activeId)) {
      get().setActiveRequestId(null);
    }
  },

  removeRequest: (id) => {
    const synced = get().synced;
    if (!synced) return;
    const existing = synced.collections.requests[id];
    const next = removeRequestAction(synced, id);
    if (next === synced) return;
    set({ synced: next });
    void saveSynced(next);
    if (existing) {
      const slotIds = collectRequestSlotIds(existing);
      if (slotIds.length > 0) void deleteManyAttachments(slotIds);
    }
    if (get().local?.ui.activeRequestId === id) get().setActiveRequestId(null);
  },

  renameRequest: (id, name) => commitSynced(set, get, (s) => renameRequestAction(s, id, name)),
  renameFolder: (id, name) => commitSynced(set, get, (s) => renameFolderAction(s, id, name)),
  setRequestMethod: (id, method) =>
    commitSynced(set, get, (s) => setRequestMethodAction(s, id, method)),
  setRequestUrl: (id, url) => commitSynced(set, get, (s) => setRequestUrlAction(s, id, url)),
  setRequestBody: (id, body) => commitSynced(set, get, (s) => setRequestBodyAction(s, id, body)),
  setRequestHeaders: (id, headers) =>
    commitSynced(set, get, (s) => setRequestHeadersAction(s, id, headers)),
  setRequestQuery: (id, query) =>
    commitSynced(set, get, (s) => setRequestQueryAction(s, id, query)),
  setRequestPathParams: (id, pathParams) =>
    commitSynced(set, get, (s) => setRequestPathParamsAction(s, id, pathParams)),
  setRequestCookies: (id, cookies) =>
    commitSynced(set, get, (s) => setRequestCookiesAction(s, id, cookies)),
  setRequestAssertions: (id, assertions) =>
    commitSynced(set, get, (s) => setRequestAssertionsAction(s, id, assertions)),
  setRequestAuth: (id, auth) => commitSynced(set, get, (s) => setRequestAuthAction(s, id, auth)),
  setFolderAuth: (folderId, auth) =>
    commitSynced(set, get, (s) => setFolderAuthAction(s, folderId, auth)),

  importPostmanCollection: (parsed, parentFolderId = null) => {
    const synced = get().synced;
    if (!synced) return { folders: 0, requests: 0 };
    let cur = synced;
    // Map from path-id stringification -> created folder id, so requests
    // attaching to nested folders can resolve their parent in O(1).
    const pathToFolderId = new Map<string, string>();
    pathToFolderId.set('', parentFolderId ?? '');
    // Create the top-level container folder so the imported tree doesn't
    // pollute the root with its requests.
    const { synced: afterRoot, folder: rootFolder } = addFolderAction(
      cur,
      parentFolderId,
      parsed.collectionName,
    );
    cur = afterRoot;
    const rootKey = '';
    pathToFolderId.set(rootKey, rootFolder.id);

    for (const folder of parsed.folders) {
      const parentKey = folder.parentPathIds ? folder.parentPathIds.join('.') : rootKey;
      const parentId = pathToFolderId.get(parentKey) ?? rootFolder.id;
      const { synced: next, folder: created } = addFolderAction(cur, parentId, folder.name);
      cur = next;
      pathToFolderId.set(folder.pathIds.join('.'), created.id);
    }

    for (const req of parsed.requests) {
      const parentKey = req.folderPathIds ? req.folderPathIds.join('.') : rootKey;
      const parentId = pathToFolderId.get(parentKey) ?? rootFolder.id;
      const { synced: next, request } = addRequestAction(cur, parentId, req.name);
      cur = next;
      // Patch the freshly-created request with the imported fields. We go
      // through `updateRequest` shape — same path renameRequest etc. use.
      const r = cur.collections.requests[request.id];
      const patched = {
        ...r,
        method: req.method,
        url: req.url,
        headers: req.headers,
        query: req.query,
        body: req.body,
        auth: req.auth,
        updatedAt: new Date().toISOString(),
      };
      cur = {
        ...cur,
        collections: {
          ...cur.collections,
          requests: { ...cur.collections.requests, [request.id]: patched },
        },
      };
    }

    set({ synced: cur });
    void saveSynced(cur);
    return { folders: parsed.folders.length + 1, requests: parsed.requests.length };
  },

  importPostmanEnvironment: (parsed) => {
    const state = get();
    if (!state.synced) return null;
    const { name, variables } = parsed;
    // Uniquify the name against existing environments — env names are unique
    // keys in the items map; collision would silently no-op the add.
    const existing = state.synced.environments.items;
    let finalName = name;
    let n = 2;
    while (existing[finalName]) {
      finalName = `${name} (${n})`;
      n += 1;
    }
    state.addEnvironment(finalName);
    state.setVariables(finalName, variables);
    return finalName;
  },
  setRequestExtractions: (id, extractions) =>
    commitSynced(set, get, (s) => setRequestExtractionsAction(s, id, extractions)),
  setRequestContextVars: (id, contextVars) =>
    commitSynced(set, get, (s) => setRequestContextVarsAction(s, id, contextVars)),
  setRequestBodySchemaId: (id, schemaId) =>
    commitSynced(set, get, (s) => setRequestBodySchemaIdAction(s, id, schemaId)),
  setRequestGraphqlSchemaId: (id, schemaId) =>
    commitSynced(set, get, (s) => setRequestGraphqlSchemaIdAction(s, id, schemaId)),

  addGlobalSchema: (init) => {
    const synced = get().synced;
    if (!synced) throw new Error('Workspace not ready');
    const result = addGlobalSchemaAction(synced, init);
    commitSynced(set, get, () => result.synced);
    return result.schema.id;
  },
  updateGlobalSchema: (id, patch) =>
    commitSynced(set, get, (s) => updateGlobalSchemaAction(s, id, patch)),
  removeGlobalSchema: (id) => commitSynced(set, get, (s) => removeGlobalSchemaAction(s, id)),
  addGlobalGraphQL: (init) => {
    const synced = get().synced;
    if (!synced) throw new Error('Workspace not ready');
    const result = addGlobalGraphQLAction(synced, init);
    commitSynced(set, get, () => result.synced);
    return result.graphql.id;
  },
  updateGlobalGraphQL: (id, patch) =>
    commitSynced(set, get, (s) => updateGlobalGraphQLAction(s, id, patch)),
  removeGlobalGraphQL: (id) => commitSynced(set, get, (s) => removeGlobalGraphQLAction(s, id)),
  openGlobalAssets: () => set({ globalAssetsOpen: true }),
  closeGlobalAssets: () => set({ globalAssetsOpen: false }),

  setLinkedRequestOverride: (linkedWorkspaceId, itemId, patch) => {
    const local = get().local;
    if (!local) return;
    const key = `${linkedWorkspaceId}:${itemId}`;
    const next: WorkspaceLocal = {
      ...local,
      overrides: {
        ...local.overrides,
        items: {
          ...local.overrides.items,
          [key]: { linkedWorkspaceId, itemId, patch, updatedAt: new Date().toISOString() },
        },
      },
    };
    set({ local: next });
    void saveLocal(next);
  },
  clearLinkedRequestOverride: (linkedWorkspaceId, itemId) => {
    const local = get().local;
    if (!local) return;
    const key = `${linkedWorkspaceId}:${itemId}`;
    if (!local.overrides.items[key]) return;
    const { [key]: _drop, ...rest } = local.overrides.items;
    void _drop;
    const next: WorkspaceLocal = {
      ...local,
      overrides: { ...local.overrides, items: rest },
    };
    set({ local: next });
    void saveLocal(next);
  },
  setActiveLinkedRequest: (id) => set({ activeLinkedRequest: id }),
  removeGlobalContextKey: (key) => {
    const local = get().local;
    if (!local) return;
    if (!(key in local.globalContext)) return;
    const { [key]: _omit, ...rest } = local.globalContext;
    void _omit;
    const next: WorkspaceLocal = { ...local, globalContext: rest };
    set({ local: next });
    void saveLocal(next);
  },
  clearGlobalContext: () => {
    const local = get().local;
    if (!local) return;
    const next: WorkspaceLocal = { ...local, globalContext: {} };
    set({ local: next });
    void saveLocal(next);
  },

  setRequestFormRows: (id, rows) => {
    const synced = get().synced;
    if (!synced) return;
    const existing = synced.collections.requests[id];
    if (!existing) return;
    const before =
      existing.body.type === 'form-data' && existing.body.formRows ? existing.body.formRows : [];
    const beforeSlots = new Set(
      before.flatMap((r) => (r.kind === 'file' && r.slotId ? [r.slotId] : [])),
    );
    const afterSlots = new Set(
      rows.flatMap((r) => (r.kind === 'file' && r.slotId ? [r.slotId] : [])),
    );
    const orphaned = [...beforeSlots].filter((s) => !afterSlots.has(s));
    const nextBody: RequestBody = { ...existing.body, type: 'form-data', formRows: rows };
    commitSynced(set, get, (s) => setRequestBodyAction(s, id, nextBody));
    if (orphaned.length > 0) void deleteManyAttachments(orphaned);
  },

  attachFormFile: async (requestId, rowIndex, file) => {
    enforceAttachmentSize(file);
    const synced = get().synced;
    if (!synced) return;
    const existing = synced.collections.requests[requestId];
    if (!existing || existing.body.type !== 'form-data' || !existing.body.formRows) return;
    const oldRow = existing.body.formRows[rowIndex];
    if (!oldRow) return;
    const previousSlot = oldRow.kind === 'file' && oldRow.slotId ? oldRow.slotId : null;

    const slotId = generateId();
    const record = await createAttachmentFromFile(file, slotId);
    await putAttachment(record);

    const nextRow: FormDataRow = {
      kind: 'file',
      key: oldRow.key,
      enabled: oldRow.enabled,
      slotId,
      filename: record.filename,
      size: record.size,
      mimeType: record.mimeType,
      sha256: record.sha256,
    };
    const nextRows = existing.body.formRows.map((r, i) => (i === rowIndex ? nextRow : r));
    const nextBody: RequestBody = { ...existing.body, formRows: nextRows };
    commitSynced(set, get, (s) => setRequestBodyAction(s, requestId, nextBody));
    if (previousSlot) await deleteAttachment(previousSlot);
  },

  detachFormFile: async (requestId, rowIndex) => {
    const synced = get().synced;
    if (!synced) return;
    const existing = synced.collections.requests[requestId];
    if (!existing || existing.body.type !== 'form-data' || !existing.body.formRows) return;
    const oldRow = existing.body.formRows[rowIndex];
    if (!oldRow || oldRow.kind !== 'file') return;
    const previousSlot = oldRow.slotId;

    const nextRow: FormDataRow = {
      kind: 'file',
      key: oldRow.key,
      enabled: oldRow.enabled,
      slotId: null,
    };
    const nextRows = existing.body.formRows.map((r, i) => (i === rowIndex ? nextRow : r));
    const nextBody: RequestBody = { ...existing.body, formRows: nextRows };
    commitSynced(set, get, (s) => setRequestBodyAction(s, requestId, nextBody));
    if (previousSlot) await deleteAttachment(previousSlot);
  },

  attachBinaryFile: async (requestId, file) => {
    enforceAttachmentSize(file);
    const synced = get().synced;
    if (!synced) return;
    const existing = synced.collections.requests[requestId];
    if (!existing) return;
    const previousSlot =
      existing.body.type === 'binary' ? (existing.body.attachment?.slotId ?? null) : null;

    const slotId = generateId();
    const record = await createAttachmentFromFile(file, slotId);
    await putAttachment(record);

    const ref: AttachmentRef = {
      slotId,
      filename: record.filename,
      size: record.size,
      mimeType: record.mimeType,
      sha256: record.sha256,
    };
    const nextBody: RequestBody = { type: 'binary', content: '', attachment: ref };
    commitSynced(set, get, (s) => setRequestBodyAction(s, requestId, nextBody));
    if (previousSlot) await deleteAttachment(previousSlot);
  },

  detachBinaryFile: async (requestId) => {
    const synced = get().synced;
    if (!synced) return;
    const existing = synced.collections.requests[requestId];
    if (!existing || existing.body.type !== 'binary') return;
    const previousSlot = existing.body.attachment?.slotId ?? null;

    const nextBody: RequestBody = { type: 'binary', content: '' };
    commitSynced(set, get, (s) => setRequestBodyAction(s, requestId, nextBody));
    if (previousSlot) await deleteAttachment(previousSlot);
  },

  // --- environments ------------------------------------------------------

  addEnvironment: (name) => commitSynced(set, get, (s) => addEnvironmentAction(s, name)),
  removeEnvironment: (name) => commitSynced(set, get, (s) => removeEnvironmentAction(s, name)),
  renameEnvironment: (oldName, newName) =>
    commitSynced(set, get, (s) => renameEnvironmentAction(s, oldName, newName)),
  duplicateEnvironment: (name) =>
    commitSynced(set, get, (s) => duplicateEnvironmentAction(s, name)),
  exportEnvironment: (name) => {
    // Pure read — no commit. Return the JSON string so the caller can
    // pipe it into a Blob/download or copy-to-clipboard.
    const synced = get().synced;
    if (!synced) return null;
    return exportEnvironmentAction(synced, name);
  },
  setActiveEnvironment: (name) =>
    commitSynced(set, get, (s) => setActiveEnvironmentAction(s, name)),
  setPriorityOrder: (order) => commitSynced(set, get, (s) => setPriorityOrderAction(s, order)),
  setVariables: (envName, variables) =>
    commitSynced(set, get, (s) => setVariablesAction(s, envName, variables)),
  addVariableRow: (envName) => commitSynced(set, get, (s) => addVariableRowAction(s, envName)),

  setVariableValue: (envName, index, value, encrypted) => {
    const synced = get().synced;
    if (!synced) return;
    const env = synced.environments.items[envName];
    if (!env) return;
    const existing = env.variables[index];
    if (!existing) return;

    // Encryption now flows exclusively through bindVariableToSecretKey:
    // the only legitimate way for a row to be `encrypted: true` is to be
    // bound to a vault secretKeyId. A direct setVariableValue call always
    // updates plaintext (and clears any stale secretKeyId).
    const nextVars: Environment['variables'] = env.variables.map((v, i) =>
      i === index ? { ...v, value, encrypted: false, secretKeyId: undefined } : v,
    );
    void encrypted; // legacy callers may still pass true; ignored intentionally.
    commitSynced(set, get, (s) => setVariablesAction(s, envName, nextVars));
  },

  bindVariableToSecretKey: (envName, index, secretKeyId) => {
    const synced = get().synced;
    if (!synced) return;
    const env = synced.environments.items[envName];
    if (!env) return;
    const local = get().local;
    if (!local || !local.secretIndex.entries[secretKeyId]) return;
    const entry = local.secretIndex.entries[secretKeyId];

    // Backfill the synced label map so collaborators see what this id is for.
    const existingMeta = synced.secretKeys?.[secretKeyId];
    const nextSecretKeys = {
      ...(synced.secretKeys ?? {}),
      [secretKeyId]: existingMeta ?? {
        id: secretKeyId,
        label: entry.label,
        createdAt: entry.createdAt,
      },
    };

    const nextVars: Environment['variables'] = env.variables.map((v, i) =>
      i === index ? { ...v, encrypted: true, secretKeyId, value: '' } : v,
    );

    commitSynced(set, get, (s) => ({
      ...setVariablesAction(s, envName, nextVars),
      secretKeys: nextSecretKeys,
    }));
  },

  unbindVariableSecretKey: (envName, index) => {
    const synced = get().synced;
    if (!synced) return;
    const env = synced.environments.items[envName];
    if (!env) return;
    const nextVars: Environment['variables'] = env.variables.map((v, i) =>
      i === index ? { ...v, encrypted: false, secretKeyId: undefined, value: '' } : v,
    );
    commitSynced(set, get, (s) => setVariablesAction(s, envName, nextVars));
  },

  setEnvFocus: (name) => {
    const items = get().synced?.environments.items ?? {};
    if (name && !items[name]) return;
    set({ envFocus: name });
  },

  // --- Secret Vault ------------------------------------------------------

  addSecret: async ({ label, value, origin, linkedWorkspaceId, linkedKeyId }) => {
    const local = get().local;
    if (!local) return '';
    const id = generateId();
    const key = await getMasterKey();
    const payload = await encryptString(value, key);
    await putSecretPayload(id, payload);
    const next = addSecretEntryAction(local, {
      id,
      label,
      origin,
      linkedWorkspaceId,
      linkedKeyId,
    });
    if (next === local) {
      // Reducer rejected (duplicate / empty label) — clean up the orphan blob.
      await deleteSecretPayload(id);
      return '';
    }
    set({ local: next });
    void saveLocal(next);
    get().recomputeSecretUsage();
    return id;
  },

  setSecretValue: async (id, value) => {
    const local = get().local;
    if (!local || !local.secretIndex.entries[id]) return false;
    const key = await getMasterKey();
    const payload = await encryptString(value, key);
    await putSecretPayload(id, payload);
    return true;
  },

  decryptSecret: async (id) => {
    const local = get().local;
    if (!local || !local.secretIndex.entries[id]) return null;
    const payload = await getSecretPayload(id);
    if (!payload) return null;
    try {
      const key = await getMasterKey();
      return await decryptString(payload, key);
    } catch {
      return null;
    }
  },

  renameSecret: (id, label) => {
    const local = get().local;
    if (!local) return;
    const next = renameSecretEntryAction(local, id, label);
    if (next === local) return;
    set({ local: next });
    void saveLocal(next);
  },

  removeSecret: async (id) => {
    const local = get().local;
    if (!local || !local.secretIndex.entries[id]) return;
    await deleteSecretPayload(id);
    const next = removeSecretEntryAction(local, id);
    set({ local: next });
    void saveLocal(next);
  },

  recomputeSecretUsage: () => {
    const synced = get().synced;
    const local = get().local;
    if (!synced || !local) return;
    const next = recomputeUsedIn(synced, local);
    if (next === local) return;
    set({ local: next });
    void saveLocal(next);
  },

  // --- GitHub session ----------------------------------------------------

  connectGitHubSession: async (token) => {
    const local = get().local;
    if (!local) throw new Error('Workspace not ready');
    const trimmed = token.trim();
    if (!trimmed) throw new Error('Token is required');

    // Verify via GET /user; throws MissingScopeError when base scopes are missing.
    const client = new GitHubClient();
    const { viewer, scopes } = await client.getViewer(trimmed, {
      requiredScopes: [...REQUIRED_BASE_SCOPES],
    });
    const missingBase = REQUIRED_BASE_SCOPES.filter((s) => !scopes.granted.includes(s));
    if (missingBase.length > 0) {
      throw new MissingScopeError(
        `Token is missing required base scopes: ${missingBase.join(', ')}.`,
        403,
        [...missingBase],
        scopes.granted,
      );
    }

    // Persist the PAT in the secret vault (re-using the master-key flow).
    const tokenSecretId = generateId();
    const masterKey = await getMasterKey();
    const payload = await encryptString(trimmed, masterKey);
    await putSecretPayload(tokenSecretId, payload);
    const indexed = addSecretEntryAction(local, {
      id: tokenSecretId,
      label: `${GITHUB_TOKEN_LABEL_PREFIX}${viewer.login}`,
    });
    if (indexed === local) {
      // Label collision (already a session for this account?) — clean up.
      await deleteSecretPayload(tokenSecretId);
      throw new Error(`A session for ${viewer.login} already exists`);
    }

    const session: GitHubSession = {
      accountLogin: viewer.login,
      tokenSecretId,
      grantedScopes: scopes.granted,
      addedAt: new Date().toISOString(),
      lastVerifiedAt: new Date().toISOString(),
    };
    const next: WorkspaceLocal = { ...indexed, sessions: { github: session } };
    set({ local: next });
    void saveLocal(next);
    return session;
  },

  verifyGitHubScopes: async () => {
    const local = get().local;
    const session = local?.sessions.github ?? null;
    if (!local || !session) return null;
    const payload = await getSecretPayload(session.tokenSecretId);
    if (!payload) return null;
    const masterKey = await getMasterKey();
    const token = await decryptString(payload, masterKey);
    const client = new GitHubClient();
    const { scopes } = await client.getViewer(token);
    const updated: GitHubSession = {
      ...session,
      grantedScopes: scopes.granted,
      lastVerifiedAt: new Date().toISOString(),
    };
    const next: WorkspaceLocal = { ...local, sessions: { github: updated } };
    set({ local: next });
    void saveLocal(next);
    return scopes.granted;
  },

  updateGitHubToken: async (token) => {
    const local = get().local;
    const session = local?.sessions.github ?? null;
    if (!local || !session) throw new Error('No active session to update');
    const trimmed = token.trim();
    if (!trimmed) throw new Error('Token is required');

    const client = new GitHubClient();
    const { viewer, scopes } = await client.getViewer(trimmed);
    if (viewer.login !== session.accountLogin) {
      throw new Error(
        `Token belongs to ${viewer.login} but the active session is for ${session.accountLogin}. Disconnect first.`,
      );
    }
    // Rotate the ciphertext under the existing slot id; branch/PR state
    // (working branch, ahead/behind, etc) is preserved verbatim.
    const masterKey = await getMasterKey();
    const payload = await encryptString(trimmed, masterKey);
    await putSecretPayload(session.tokenSecretId, payload);
    const updated: GitHubSession = {
      ...session,
      grantedScopes: scopes.granted,
      lastVerifiedAt: new Date().toISOString(),
    };
    const next: WorkspaceLocal = { ...local, sessions: { github: updated } };
    set({ local: next });
    void saveLocal(next);
    return updated;
  },

  disconnectGitHubSession: async () => {
    const local = get().local;
    const session = local?.sessions.github ?? null;
    if (!local || !session) return;
    await deleteSecretPayload(session.tokenSecretId);
    const indexCleared = removeSecretEntryAction(local, session.tokenSecretId);
    const next: WorkspaceLocal = {
      ...indexCleared,
      sessions: { github: null },
      // Disconnecting the session also drops the repo + branch — they're
      // unusable without an authenticated client.
      connectedRepo: null,
      workingBranch: null,
    };
    set({ local: next });
    void saveLocal(next);
  },

  // --- Repo + working-branch (P4.2) -------------------------------------

  connectRepo: async (owner, name) => {
    const local = get().local;
    if (!local) throw new Error('Workspace not ready');
    const token = await decryptSessionToken(local);

    const client = new GitHubClient();
    const repo: GitHubRepo = await client.getRepo(token, owner.trim(), name.trim());

    const connected: ConnectedRepo = {
      fullName: repo.fullName,
      owner: repo.owner,
      name: repo.name,
      defaultBranch: repo.defaultBranch,
      visibility: repo.visibility,
      isPrivate: repo.isPrivate,
      pushable: repo.pushable,
      connectedAt: new Date().toISOString(),
    };
    const next: WorkspaceLocal = {
      ...local,
      connectedRepo: connected,
      // If the user re-connects to a different repo, drop any branch tied
      // to the old one — pushing to the wrong repo would be a disaster.
      workingBranch:
        local.workingBranch?.repoFullName === connected.fullName ? local.workingBranch : null,
    };
    set({ local: next });
    void saveLocal(next);
    return connected;
  },

  disconnectRepo: () => {
    const local = get().local;
    if (!local) return;
    if (!local.connectedRepo && !local.workingBranch) return;
    const next: WorkspaceLocal = {
      ...local,
      connectedRepo: null,
      workingBranch: null,
    };
    set({ local: next });
    void saveLocal(next);
  },

  createWorkingBranch: async (opts) => {
    const local = get().local;
    const synced = get().synced;
    if (!local || !synced) throw new Error('Workspace not ready');
    const repo = local.connectedRepo;
    if (!repo) throw new Error('Connect a repo before creating a working branch');

    const baseBranch = opts?.baseBranch?.trim() || repo.defaultBranch;
    const branchName =
      opts?.branchName?.trim() ||
      generateWorkingBranchName({ workspaceName: synced.workspaceName });

    const validationError = validateBranchName(branchName);
    if (validationError) throw new Error(validationError);

    const token = await decryptSessionToken(local);
    const client = new GitHubClient();

    // Read the base branch HEAD, then create the new ref.
    const head = await client.getBranchHead(token, repo.owner, repo.name, baseBranch);
    const created = await client.createBranch(
      token,
      repo.owner,
      repo.name,
      branchName,
      head.commitSha,
    );

    const branch: WorkingBranch = {
      name: created.name,
      baseBranch,
      repoFullName: repo.fullName,
      repoOwner: repo.owner,
      repoName: repo.name,
      headSha: created.commitSha,
      createdAt: new Date().toISOString(),
      lastPushedSha: null,
      diffSummary: null,
      openPrUrl: null,
    };
    const next: WorkspaceLocal = { ...local, workingBranch: branch };
    set({ local: next });
    void saveLocal(next);
    return branch;
  },

  discardWorkingBranch: () => {
    const local = get().local;
    if (!local || !local.workingBranch) return;
    const next: WorkspaceLocal = { ...local, workingBranch: null };
    set({ local: next });
    void saveLocal(next);
  },

  pushWorkspace: async (commitMessage) => {
    const local = get().local;
    const synced = get().synced;
    if (!local || !synced) throw new Error('Workspace not ready');
    const branch = local.workingBranch;
    if (!branch) throw new Error('Create a working branch before pushing');
    const repo = local.connectedRepo;
    if (!repo) throw new Error('No repo connected');

    const token = await decryptSessionToken(local);
    const client = new GitHubClient();
    const owner = branch.repoOwner;
    const name = branch.repoName;

    // 1. Read the branch's current head SHA.
    const head = await client.getRef(token, owner, name, branch.name);
    // 2. Read its tree SHA.
    const headCommit = await client.getCommit(token, owner, name, head.sha);
    // 3. Upload every locally-cached attachment as a blob. Slots whose
    //    bytes aren't in local IDB are skipped — base_tree keeps the
    //    remote entry intact (or absent, on first push).
    const slots = collectAttachmentSlots(synced);
    const attachmentEntries: TreeEntryInput[] = [];
    for (const slot of slots) {
      const record = await getAttachment(slot.slotId);
      if (!record) continue;
      const blob = await client.createBlob(token, owner, name, {
        content: bytesToBase64(record.bytes),
        encoding: 'base64',
      });
      attachmentEntries.push({
        path: `.apicircle/attachments/${slot.slotId}`,
        sha: blob.sha,
      });
    }
    // 4. Build the new tree, layering workspace.json + attachments over base_tree.
    const content = serializeWorkspaceForGit(synced);
    const newTree = await client.createTree(token, owner, name, {
      baseTreeSha: headCommit.treeSha,
      entries: [{ path: 'workspace.json', content }, ...attachmentEntries],
    });
    // 5. Create the commit.
    const message = (commitMessage ?? '').trim() || 'chore: sync workspace via API Circle Studio';
    const newCommit = await client.createCommit(token, owner, name, {
      message,
      treeSha: newTree.sha,
      parents: [head.sha],
    });
    // 6. Fast-forward the branch ref.
    await client.updateRef(token, owner, name, {
      branch: branch.name,
      sha: newCommit.sha,
    });

    // 7. Persist the new local branch state.
    const updatedBranch: WorkingBranch = {
      ...branch,
      headSha: newCommit.sha,
      lastPushedSha: newCommit.sha,
    };
    const next: WorkspaceLocal = { ...get().local!, workingBranch: updatedBranch };
    set({ local: next });
    void saveLocal(next);
    return { commitSha: newCommit.sha };
  },

  publishRelease: async (args) => {
    const synced = get().synced;
    if (!synced) return;
    const next = await publishReleaseAction(synced, args);
    set({ synced: next });
    void saveSynced(next);
  },

  deprecateRelease: (version) => {
    commitSynced(set, get, (s) => deprecateReleaseAction(s, version));
  },

  yankRelease: (version) => {
    commitSynced(set, get, (s) => yankReleaseAction(s, version));
  },

  linkPrivateWorkspace: async (args) => doLinkWorkspace(set, get, { ...args, kind: 'private' }),

  linkPublicWorkspace: async (args) => doLinkWorkspace(set, get, { ...args, kind: 'public' }),

  searchMarketplace: async (query) => {
    const local = get().local;
    if (!local) throw new Error('Workspace not ready');
    const token = await decryptSessionToken(local);
    const client = new GitHubClient();
    return client.searchMarketplaceRepos(token, query);
  },

  refreshLinkedWorkspace: async (id) => {
    const local = get().local;
    const synced = get().synced;
    if (!local || !synced) throw new Error('Workspace not ready');
    const link = synced.linkedWorkspaces[id];
    if (!link) throw new Error(`Linked workspace ${id} not found`);

    const token = await decryptSessionToken(local);
    const client = new GitHubClient();
    const [owner, name] = link.source.repoFullName.split('/', 2);
    const file = await client.getContents(token, owner, name, 'workspace.json', link.source.branch);
    if (file === null) {
      throw new Error(
        `workspace.json missing on ${link.source.repoFullName}@${link.source.branch}`,
      );
    }
    const parsed = parseLinkedWorkspaceJson(file.content);
    const cachedLedger: ReleaseHistory = parsed.releases?.self ?? {
      versions: [],
      currentVersion: null,
    };
    const next: WorkspaceSynced = {
      ...synced,
      releases: {
        ...synced.releases,
        perLink: { ...synced.releases.perLink, [id]: cachedLedger },
      },
      meta: { ...synced.meta, updatedAt: new Date().toISOString() },
    };
    // Refresh the cached collections + environments alongside the
    // ledger. When the source's workspace.json doesn't ship those
    // fields we leave any existing snapshot untouched rather than
    // wiping it (it might still be useful from an earlier successful
    // pull).
    const snapshot = buildLinkedSnapshot(parsed, link);
    const nextLocal = snapshot
      ? { ...local, linkedCollections: { ...local.linkedCollections, [id]: snapshot } }
      : local;
    set({ synced: next, ...(snapshot ? { local: nextLocal } : {}) });
    void saveSynced(next);
    if (snapshot) void saveLocal(nextLocal);
  },

  pinLinkedVersion: (id, version) => {
    const synced = get().synced;
    if (!synced) return;
    const link = synced.linkedWorkspaces[id];
    if (!link) throw new Error(`Linked workspace ${id} not found`);
    if (version !== null) {
      const cached = synced.releases.perLink[id]?.versions ?? [];
      if (!cached.find((v) => v.version === version)) {
        throw new Error(`Version ${version} is not in the cached ledger — refresh the link first`);
      }
    }
    if (link.pinnedVersion === version) return;
    const next: WorkspaceSynced = {
      ...synced,
      linkedWorkspaces: {
        ...synced.linkedWorkspaces,
        [id]: { ...link, pinnedVersion: version },
      },
      meta: { ...synced.meta, updatedAt: new Date().toISOString() },
    };
    set({ synced: next });
    void saveSynced(next);
  },

  addLinkedRequiredKey: (linkId, keyId) => {
    const synced = get().synced;
    if (!synced) return;
    const link = synced.linkedWorkspaces[linkId];
    if (!link) throw new Error(`Linked workspace ${linkId} not found`);
    const trimmed = keyId.trim();
    if (!trimmed) throw new Error('Key id cannot be empty');
    if (link.requiredSecretKeyIds.includes(trimmed)) return;
    const next: WorkspaceSynced = {
      ...synced,
      linkedWorkspaces: {
        ...synced.linkedWorkspaces,
        [linkId]: {
          ...link,
          requiredSecretKeyIds: [...link.requiredSecretKeyIds, trimmed],
        },
      },
      meta: { ...synced.meta, updatedAt: new Date().toISOString() },
    };
    set({ synced: next });
    void saveSynced(next);
  },

  removeLinkedRequiredKey: async (linkId, keyId) => {
    const synced = get().synced;
    const local = get().local;
    if (!synced || !local) return;
    const link = synced.linkedWorkspaces[linkId];
    if (!link) throw new Error(`Linked workspace ${linkId} not found`);
    // Drop the key from the list…
    const next: WorkspaceSynced = {
      ...synced,
      linkedWorkspaces: {
        ...synced.linkedWorkspaces,
        [linkId]: {
          ...link,
          requiredSecretKeyIds: link.requiredSecretKeyIds.filter((k) => k !== keyId),
        },
      },
      meta: { ...synced.meta, updatedAt: new Date().toISOString() },
    };
    set({ synced: next });
    void saveSynced(next);
    // …and the matching provisioned vault entry, if any.
    const provisioned = findProvisionedSecretId(local, linkId, keyId);
    if (provisioned) {
      await get().removeSecret(provisioned);
    }
  },

  provisionLinkedSecret: async (linkId, keyId, value) => {
    const local = get().local;
    const synced = get().synced;
    if (!local || !synced) throw new Error('Workspace not ready');
    const link = synced.linkedWorkspaces[linkId];
    if (!link) throw new Error(`Linked workspace ${linkId} not found`);
    const existing = findProvisionedSecretId(local, linkId, keyId);
    if (existing) {
      await get().setSecretValue(existing, value);
      return existing;
    }
    const id = await get().addSecret({
      label: `link:${link.name}:${keyId}`,
      value,
      origin: 'linked',
      linkedWorkspaceId: linkId,
      linkedKeyId: keyId,
    });
    return id;
  },

  unlinkWorkspace: (id) => {
    const synced = get().synced;
    const local = get().local;
    if (!synced || !synced.linkedWorkspaces[id]) return;
    const linkedWorkspaces = { ...synced.linkedWorkspaces };
    delete linkedWorkspaces[id];
    const perLink = { ...synced.releases.perLink };
    delete perLink[id];
    const next: WorkspaceSynced = {
      ...synced,
      linkedWorkspaces,
      releases: { ...synced.releases, perLink },
      meta: { ...synced.meta, updatedAt: new Date().toISOString() },
    };
    // Drop the cached collections snapshot too — orphan state in
    // local.linkedCollections would just confuse the cross-workspace
    // step picker.
    let nextLocal = local;
    if (local && local.linkedCollections[id]) {
      const linkedCollections = { ...local.linkedCollections };
      delete linkedCollections[id];
      nextLocal = { ...local, linkedCollections };
    }
    if (nextLocal !== local && nextLocal) {
      set({ synced: next, local: nextLocal });
      void saveSynced(next);
      void saveLocal(nextLocal);
    } else {
      set({ synced: next });
      void saveSynced(next);
    }
  },

  // --- Execution plans (P6) ----------------------------------------------

  setActivePlanId: (id) => set({ activePlanId: id }),

  addPlan: (name) => {
    const local = get().local;
    if (!local) return '';
    const { local: next, plan } = addPlanAction(local, name);
    set({ local: next, activePlanId: plan.id });
    void saveLocal(next);
    return plan.id;
  },

  removePlan: (id) => {
    const local = get().local;
    if (!local) return;
    const next = removePlanAction(local, id);
    if (next === local) return;
    const wasActive = get().activePlanId === id;
    set({ local: next, ...(wasActive ? { activePlanId: null } : {}) });
    void saveLocal(next);
  },

  renamePlan: (id, name) => commitLocal(set, get, (l) => renamePlanAction(l, id, name)),
  duplicatePlan: (planId) => {
    const local = get().local;
    if (!local) return null;
    const { local: next, plan } = duplicatePlanAction(local, planId);
    if (!plan || next === local) return null;
    set({ local: next, activePlanId: plan.id });
    void saveLocal(next);
    return plan.id;
  },
  addPlanStep: (planId, requestId, linkedWorkspaceId) =>
    commitLocal(set, get, (l) => addPlanStepAction(l, planId, requestId, linkedWorkspaceId)),
  removePlanStep: (planId, stepIndex) =>
    commitLocal(set, get, (l) => removePlanStepAction(l, planId, stepIndex)),
  reorderPlanSteps: (planId, fromIndex, toIndex) =>
    commitLocal(set, get, (l) => reorderPlanStepsAction(l, planId, fromIndex, toIndex)),
  setPlanStepEnabled: (planId, stepIndex, enabled) =>
    commitLocal(set, get, (l) => setPlanStepEnabledAction(l, planId, stepIndex, enabled)),
  setPlanEnvPriority: (planId, priorityOrder) =>
    commitLocal(set, get, (l) => setPlanEnvPriorityAction(l, planId, priorityOrder)),
  setPlanStopOnFailure: (planId, stopOnAssertionFailure) =>
    commitLocal(set, get, (l) => setPlanStopOnFailureAction(l, planId, stopOnAssertionFailure)),
  setPlanVariables: (planId, variables) =>
    commitLocal(set, get, (l) => setPlanVariablesAction(l, planId, variables)),

  runPlan: async (planId, opts) => {
    const local = get().local;
    const synced = get().synced;
    if (!local || !synced) throw new Error('Workspace not ready');
    const plan = local.executionPlans[planId];
    if (!plan) throw new Error(`Plan ${planId} not found`);

    // Concurrent-run guard: refuse to start a second run of the same
    // plan while the first is still in flight. The UI surfaces this as
    // a toast ("Plan already running"); we don't queue.
    if (inflightPlanRuns.has(planId)) throw new Error('plan already running');
    inflightPlanRuns.add(planId);
    try {
      const withAssertions = opts?.withAssertions ?? false;
      const stopOnFailure = withAssertions && (plan.stopOnAssertionFailure ?? false);
      const startedAt = new Date().toISOString();
      const planRunId = generateId();
      const t0 = Date.now();
      const stepRecords: Array<{ requestRunId: string; passed: boolean }> = [];
      const newRequestRuns: RequestRun[] = [];
      const planResultDetails: WorkspaceStore['lastPlanResults'][string] = [];

      for (const step of plan.steps) {
        // Disabled steps (`enabled: false`) are skipped silently — they
        // contribute nothing to the request-run history or the plan-run
        // tally. The plan-step row stays in the plan; only the run is
        // skipped.
        if (step.enabled === false) continue;

        // Cross-workspace steps look the request up in the cached linked
        // snapshot rather than synced.collections.requests. The snapshot
        // is populated by linkPrivate/linkPublic/refreshLinkedWorkspace;
        // a missing snapshot means the user hasn't refreshed since the
        // schema landed (or the source's workspace.json doesn't ship
        // collections). We record an orphan failure either way.
        const lookup = lookupPlanStepRequest(step, synced, local);
        if (!lookup.request) {
          const runId = generateId();
          const orphanRun: RequestRun = {
            id: runId,
            requestId: step.requestId,
            startedAt: new Date().toISOString(),
            durationMs: 0,
            status: null,
            statusText: '',
            ok: false,
            error: lookup.error,
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
          newRequestRuns.push(orphanRun);
          stepRecords.push({ requestRunId: runId, passed: false });
          planResultDetails.push({
            result: {
              startedAt: orphanRun.startedAt,
              durationMs: 0,
              status: null,
              ok: false,
              statusText: '',
              headers: {},
              body: '',
              bodyKind: 'empty',
              error: lookup.error,
              url: '',
              method: '',
              authWarnings: [],
            },
            assertionResults: [],
            passed: false,
            requestName: 'Missing request',
            requestMethod: '—',
          });
          continue;
        }
        const request = lookup.request;
        const planScope: {
          envPriorityOrder?: readonly string[];
          planVariables?: ReadonlyArray<{ key: string; value: string }>;
        } = {
          envPriorityOrder: plan.envPriorityOrder.length > 0 ? plan.envPriorityOrder : undefined,
          planVariables: plan.variables && plan.variables.length > 0 ? plan.variables : undefined,
        };
        // For linked steps the request expects to resolve against the SOURCE
        // workspace's environments + folders (the consumer hasn't seen the
        // source's BASE_URL or its folder hierarchy). We pass a virtual synced
        // doc that uses the linked snapshot's environments + folders, while
        // keeping the consumer's secret vault. Without the folder swap, a
        // request whose `auth.type === 'inherit'` would walk up the consumer's
        // folder tree (which doesn't know about the source) and silently fall
        // back to no auth.
        const resolveSynced =
          step.linkedWorkspaceId && lookup.linkedEnvironments
            ? {
                ...synced,
                environments: lookup.linkedEnvironments,
                collections: {
                  ...synced.collections,
                  folders: lookup.linkedFolders ?? {},
                },
              }
            : synced;
        const resolved = await resolveRequest(request, resolveSynced, get().local, planScope);
        const result = await coreExecuteRequest(resolved, {
          resolveAttachment: attachmentResolver,
        });
        const assertionResults = withAssertions ? runAssertions(request.assertions, result) : [];
        const allPassed = result.ok && (!withAssertions || assertionResults.every((a) => a.passed));
        const requestRun = buildRequestRun(resolved, result, assertionResults);
        newRequestRuns.push(requestRun);
        stepRecords.push({ requestRunId: requestRun.id, passed: allPassed });
        planResultDetails.push({
          result,
          assertionResults,
          passed: allPassed,
          requestName: request.name,
          requestMethod: request.method,
        });

        // Carry extracted ctx vars into the rolling globalContext so the next
        // step's resolveRequest sees them. Linked-workspace steps still
        // contribute back to the consumer's local context — the value is what
        // matters, not which workspace produced it.
        if (request.extractions && request.extractions.length > 0) {
          const stepExtraction = extractContext(result, request.extractions);
          const liveLocal = get().local;
          if (liveLocal) {
            const merged: WorkspaceLocal = {
              ...liveLocal,
              globalContext: { ...liveLocal.globalContext, ...stepExtraction.extracted },
            };
            set({ local: merged });
          }
        }

        // Stop-on-assertion-failure: when the plan is launched
        // `withAssertions` AND `stopOnAssertionFailure` is on, any failed
        // step halts the loop. We persist the steps that already ran +
        // the partial verdict; the user sees the failure in the verdict
        // tally rather than a full-green sweep.
        if (stopOnFailure && !allPassed) break;
      }

      const planRun: PlanRun = {
        id: planRunId,
        planId,
        startedAt,
        durationMs: Date.now() - t0,
        withAssertions,
        steps: stepRecords,
      };

      set((s) => ({ lastPlanResults: { ...s.lastPlanResults, [planId]: planResultDetails } }));

      const persistLocal = get().local;
      if (persistLocal) {
        // Prepend newest-first: the last step to run sits at index 0 of the
        // history buffer (matches the convention executeActiveRequest uses
        // for single-request runs).
        const reversed = [...newRequestRuns].reverse();
        const trimmedRequestRuns = [...reversed, ...persistLocal.history.requestRuns].slice(
          0,
          MAX_REQUEST_RUNS,
        );
        const trimmedPlanRuns = [planRun, ...persistLocal.history.planRuns].slice(0, MAX_PLAN_RUNS);
        const nextLocal: WorkspaceLocal = {
          ...persistLocal,
          history: {
            ...persistLocal.history,
            requestRuns: trimmedRequestRuns,
            planRuns: trimmedPlanRuns,
          },
        };
        set({ local: nextLocal });
        void saveLocal(nextLocal);
      }
      return planRun;
    } finally {
      inflightPlanRuns.delete(planId);
    }
  },

  syncAttachments: async () => {
    const local = get().local;
    const synced = get().synced;
    if (!local || !synced) throw new Error('Workspace not ready');
    const branch = local.workingBranch;
    if (!branch) throw new Error('Create a working branch before syncing attachments');

    const slots = collectAttachmentSlots(synced);
    if (slots.length === 0) return { fetched: 0, alreadyPresent: 0, failed: 0 };

    const token = await decryptSessionToken(local);
    const client = new GitHubClient();
    let fetched = 0;
    let alreadyPresent = 0;
    let failed = 0;

    for (const slot of slots) {
      // Skip when local already has bytes whose sha256 matches the synced ref.
      const existing = await getAttachment(slot.slotId);
      if (existing && existing.sha256 === slot.sha256) {
        alreadyPresent++;
        continue;
      }
      try {
        const file = await client.getBinaryContents(
          token,
          branch.repoOwner,
          branch.repoName,
          `.apicircle/attachments/${slot.slotId}`,
          branch.name,
        );
        if (!file) {
          failed++;
          continue;
        }
        await putAttachment({
          slotId: slot.slotId,
          filename: slot.filename ?? slot.slotId,
          mimeType: slot.mimeType ?? 'application/octet-stream',
          size: file.bytes.length,
          // Trust the recorded sha256 for now; mismatch detection is a future
          // tightening (plan §7.6 mentions "surfaces tampering and corruption").
          sha256: slot.sha256 ?? (await sha256HexBytes(file.bytes)),
          savedAt: new Date().toISOString(),
          bytes: file.bytes,
        });
        fetched++;
      } catch {
        failed++;
      }
    }
    return { fetched, alreadyPresent, failed };
  },

  refreshWorkspace: async () => {
    const local = get().local;
    const synced = get().synced;
    if (!local || !synced) throw new Error('Workspace not ready');
    const branch = local.workingBranch;
    if (!branch) throw new Error('Create a working branch before refreshing');

    const token = await decryptSessionToken(local);
    const client = new GitHubClient();
    const file = await client.getContents(
      token,
      branch.repoOwner,
      branch.repoName,
      'workspace.json',
      branch.name,
    );
    if (file === null) {
      // Branch has no workspace.json yet — first push hasn't happened.
      return { status: 'no-remote' };
    }

    const remote = JSON.parse(file.content) as WorkspaceSynced;
    const base = local.sync.lastPulledSnapshot;
    const diff = computeThreeWayDiff(base, synced, remote);

    if (diff.entries.length === 0) {
      // Local + remote agree — nothing to merge, just refresh the snapshot.
      const next: WorkspaceLocal = {
        ...get().local!,
        sync: {
          ...local.sync,
          lastPulledSnapshot: remote,
          lastPulledSha: file.sha,
          lastPulledAt: new Date().toISOString(),
        },
      };
      set({ local: next });
      void saveLocal(next);
      return { status: 'up-to-date' };
    }

    if (diff.conflicts.length === 0) {
      // No conflicts — auto-merge.
      const merged = applyMerge(synced, remote, diff, {});
      await persistMerged(set, get, merged, file.sha);
      return { status: 'merged' };
    }

    // Conflicts — stash the diff and let the modal drive commitRefresh.
    set({ pendingRefresh: { diff, remote, remoteSha: file.sha } });
    return { status: 'conflicts', diff };
  },

  commitRefresh: async (resolutions) => {
    const pending = get().pendingRefresh;
    const synced = get().synced;
    if (!pending || !synced) throw new Error('No pending refresh to commit');
    const merged = applyMerge(synced, pending.remote, pending.diff, resolutions);
    await persistMerged(set, get, merged, pending.remoteSha);
    set({ pendingRefresh: null });
  },

  cancelRefresh: () => set({ pendingRefresh: null }),

  createPullRequest: async (args) => {
    const local = get().local;
    if (!local) throw new Error('Workspace not ready');
    const branch = local.workingBranch;
    if (!branch) throw new Error('Create a working branch first');
    if (!branch.lastPushedSha) {
      throw new Error('Push to save before opening a PR');
    }
    if (branch.openPrUrl) {
      throw new Error('A pull request is already open for this branch');
    }

    const token = await decryptSessionToken(local);
    const client = new GitHubClient();
    const pr = await client.createPullRequest(token, branch.repoOwner, branch.repoName, {
      title: args?.title?.trim() || 'APICircle workspace updates',
      body: args?.body ?? '',
      head: branch.name,
      base: branch.baseBranch,
      draft: args?.draft ?? false,
    });

    const updatedBranch: WorkingBranch = { ...branch, openPrUrl: pr.htmlUrl };
    const next: WorkspaceLocal = { ...get().local!, workingBranch: updatedBranch };
    set({ local: next });
    void saveLocal(next);
    return { number: pr.number, htmlUrl: pr.htmlUrl };
  },

  removeRequestRun: (runId) => {
    const local = get().local;
    if (!local) return;
    const next: WorkspaceLocal = {
      ...local,
      history: {
        ...local.history,
        requestRuns: local.history.requestRuns.filter((r) => r.id !== runId),
      },
    };
    set({ local: next });
    void saveLocal(next);
  },

  removePlanRun: (runId) => {
    const local = get().local;
    if (!local) return;
    const next: WorkspaceLocal = {
      ...local,
      history: {
        ...local.history,
        planRuns: local.history.planRuns.filter((r) => r.id !== runId),
      },
    };
    set({ local: next });
    void saveLocal(next);
  },

  clearRequestRuns: (predicate) => {
    const local = get().local;
    if (!local) return;
    const next: WorkspaceLocal = {
      ...local,
      history: {
        ...local.history,
        requestRuns: predicate ? local.history.requestRuns.filter(predicate) : [],
      },
    };
    set({ local: next });
    void saveLocal(next);
  },

  clearPlanRuns: (predicate) => {
    const local = get().local;
    if (!local) return;
    const next: WorkspaceLocal = {
      ...local,
      history: {
        ...local.history,
        planRuns: predicate ? local.history.planRuns.filter(predicate) : [],
      },
    };
    set({ local: next });
    void saveLocal(next);
  },

  executeActiveRequest: async () => {
    const state = get();
    const id = state.local?.ui.activeRequestId;
    const synced = state.synced;
    if (!id || !synced) return;
    const request = synced.collections.requests[id];
    if (!request) return;

    set((s) => ({ isExecuting: { ...s.isExecuting, [id]: true } }));
    try {
      const resolved = await resolveRequest(request, synced, get().local);
      const result = await coreExecuteRequest(resolved, {
        resolveAttachment: attachmentResolver,
      });
      const assertionResults = runAssertions(request.assertions, result);
      const run = buildRequestRun(resolved, result, assertionResults);
      // Apply the request's post-run extractions into local.globalContext.
      // Failures are logged as warnings but do not block the run.
      const extractionResult =
        request.extractions && request.extractions.length > 0
          ? extractContext(result, request.extractions)
          : { extracted: {}, warnings: [] };

      const local = get().local;
      if (local) {
        const trimmed = [run, ...local.history.requestRuns].slice(0, MAX_REQUEST_RUNS);
        const next: WorkspaceLocal = {
          ...local,
          history: { ...local.history, requestRuns: trimmed },
          globalContext: { ...local.globalContext, ...extractionResult.extracted },
        };
        set({ local: next });
        void saveLocal(next);
      }
      set((s) => ({ lastRun: { ...s.lastRun, [id]: result } }));
    } finally {
      set((s) => ({ isExecuting: { ...s.isExecuting, [id]: false } }));
    }
  },

  replayRequestRun: async (runId) => {
    const state = get();
    const local = state.local;
    const synced = state.synced;
    if (!local || !synced) return null;
    const run = local.history.requestRuns.find((r) => r.id === runId);
    if (!run) return null;
    const request = synced.collections.requests[run.requestId];
    // Source request was deleted — replay can't resolve a live request,
    // and replaying the recorded URL/headers/body wouldn't pick up env
    // changes. Surface as null; UI disables the button.
    if (!request) return null;

    set((s) => ({ isExecuting: { ...s.isExecuting, [request.id]: true } }));
    try {
      const resolved = await resolveRequest(request, synced, get().local);
      const result = await coreExecuteRequest(resolved, {
        resolveAttachment: attachmentResolver,
      });
      const assertionResults = runAssertions(request.assertions, result);
      const replayRun = buildRequestRun(resolved, result, assertionResults);
      const extractionResult =
        request.extractions && request.extractions.length > 0
          ? extractContext(result, request.extractions)
          : { extracted: {}, warnings: [] };
      const liveLocal = get().local;
      if (liveLocal) {
        const trimmed = [replayRun, ...liveLocal.history.requestRuns].slice(0, MAX_REQUEST_RUNS);
        const next: WorkspaceLocal = {
          ...liveLocal,
          history: { ...liveLocal.history, requestRuns: trimmed },
          globalContext: { ...liveLocal.globalContext, ...extractionResult.extracted },
        };
        set({ local: next });
        void saveLocal(next);
      }
      set((s) => ({ lastRun: { ...s.lastRun, [request.id]: result } }));
      return replayRun;
    } finally {
      set((s) => ({ isExecuting: { ...s.isExecuting, [request.id]: false } }));
    }
  },
}));

// Test-only window bridge. Lets Playwright specs seed otherwise hard-to-
// reach state (linked-workspace snapshots, secret-vault contents, GitHub
// session) without going through the full connect/refresh flow. Reading
// from the store via this hook is safe; writing is allowed but only
// expected from e2e specs.
if (typeof window !== 'undefined') {
  (window as unknown as { __apicircleStore?: typeof useWorkspaceStore }).__apicircleStore =
    useWorkspaceStore;
}

type SetState = (
  partial: Partial<WorkspaceStore> | ((state: WorkspaceStore) => Partial<WorkspaceStore>),
) => void;
type GetState = () => WorkspaceStore;

/**
 * Decrypt the active GitHub PAT via the master key. Throws when no session
 * exists or the encrypted payload is missing — both surface in the UI as
 * "no GitHub connection."
 */
/**
 * Persist a 3-way-merged synced doc + roll the sync snapshot forward.
 * Both the synced and local stores are touched in one transactional pair
 * — the sync snapshot is meaningless if the synced doc can't be saved.
 */
async function persistMerged(
  set: SetState,
  get: GetState,
  merged: WorkspaceSynced,
  remoteSha: string,
): Promise<void> {
  const local = get().local;
  if (!local) return;
  const nextLocal: WorkspaceLocal = {
    ...local,
    sync: {
      ...local.sync,
      lastPulledSnapshot: merged,
      lastPulledSha: remoteSha,
      lastPulledAt: new Date().toISOString(),
    },
  };
  set({ synced: merged, local: nextLocal });
  await Promise.all([saveSynced(merged), saveLocal(nextLocal)]);
}

/**
 * Shared link flow used by both `linkPrivateWorkspace` and
 * `linkPublicWorkspace`. Fetches the source's workspace.json, parses
 * it, builds the LinkedWorkspace entry, caches the source ledger, and
 * persists. Splitting this out keeps the action signatures clean while
 * the only difference between the two is `kind` + the optional
 * marketplace metadata.
 */
async function doLinkWorkspace(
  set: SetState,
  get: GetState,
  args: {
    repoFullName: string;
    branch: string;
    pinnedVersion?: string | null;
    kind: 'private' | 'public';
    marketplace?: { listedAs: string; tags: string[]; summary: string };
  },
): Promise<LinkedWorkspace> {
  const local = get().local;
  const synced = get().synced;
  if (!local || !synced) throw new Error('Workspace not ready');
  const trimmedRepo = args.repoFullName.trim();
  const trimmedBranch = args.branch.trim() || 'main';
  if (!trimmedRepo.includes('/')) {
    throw new Error('Repo must be `owner/name`');
  }
  const [owner, name] = trimmedRepo.split('/', 2);

  const token = await decryptSessionToken(local);
  const client = new GitHubClient();
  const file = await client.getContents(token, owner, name, 'workspace.json', trimmedBranch);
  if (file === null) {
    throw new Error(`workspace.json not found on ${trimmedRepo}@${trimmedBranch}`);
  }
  const parsed = parseLinkedWorkspaceJson(file.content);

  const id = generateId();
  const link: LinkedWorkspace = {
    id,
    kind: args.kind,
    name: parsed.workspaceName,
    source: { provider: 'github', repoFullName: trimmedRepo, branch: trimmedBranch },
    scope: ['collections', 'environments'],
    pinnedVersion: args.pinnedVersion ?? parsed.releases?.self?.currentVersion ?? null,
    updatePolicy: 'manual',
    linkedAt: new Date().toISOString(),
    requiredSecretKeyIds: [],
    ...(args.marketplace ? { marketplace: args.marketplace } : {}),
  };
  const cachedLedger: ReleaseHistory = parsed.releases?.self ?? {
    versions: [],
    currentVersion: null,
  };
  const next: WorkspaceSynced = {
    ...synced,
    linkedWorkspaces: { ...synced.linkedWorkspaces, [id]: link },
    releases: {
      ...synced.releases,
      perLink: { ...synced.releases.perLink, [id]: cachedLedger },
    },
    meta: { ...synced.meta, updatedAt: link.linkedAt },
  };
  // Cache the source's collections + environments locally so cross-
  // workspace plan steps and "use this linked workspace's request" paths
  // have the data without a network roundtrip. Only persist when the
  // source actually shipped these fields.
  const snapshot = buildLinkedSnapshot(parsed, link);
  const nextLocal = snapshot
    ? { ...local, linkedCollections: { ...local.linkedCollections, [id]: snapshot } }
    : local;
  set({ synced: next, ...(snapshot ? { local: nextLocal } : {}) });
  void saveSynced(next);
  if (snapshot) void saveLocal(nextLocal);
  return link;
}

/**
 * Resolve a plan step's `requestId` against either the local workspace
 * (when no linkedWorkspaceId is set) or the cached linked snapshot.
 * Returns the request + the source's environments when the step is
 * linked, plus a typed error message when the lookup fails.
 */
function lookupPlanStepRequest(
  step: { requestId: string; linkedWorkspaceId?: string },
  synced: WorkspaceSynced,
  local: WorkspaceLocal,
): {
  request: ApiRequest | null;
  linkedEnvironments?: WorkspaceSynced['environments'];
  // Folders from the source workspace's snapshot. The plan runner needs these
  // so that requests with `auth.type === 'inherit'` can walk up the source's
  // folder chain (not the consumer's, which doesn't know about the source).
  linkedFolders?: WorkspaceSynced['collections']['folders'];
  error?: string;
} {
  if (!step.linkedWorkspaceId) {
    const request = synced.collections.requests[step.requestId];
    return request
      ? { request }
      : { request: null, error: 'Request no longer exists in workspace' };
  }
  const link = synced.linkedWorkspaces[step.linkedWorkspaceId];
  if (!link) {
    return { request: null, error: 'Linked workspace was unlinked' };
  }
  const snapshot = local.linkedCollections[step.linkedWorkspaceId];
  if (!snapshot) {
    return {
      request: null,
      error: `No cached snapshot for "${link.name}" — refresh the link card first`,
    };
  }
  const baseRequest = snapshot.collections.requests[step.requestId];
  if (!baseRequest) {
    return {
      request: null,
      error: `Request not present in the cached snapshot of "${link.name}"`,
    };
  }
  // Apply consumer-side override patch on top of the linked snapshot.
  // Only the fields the user can override (headers, contextVars,
  // assertions, extractions) are merged — everything else is read straight
  // from the source workspace.
  const overrideKey = `${step.linkedWorkspaceId}:${step.requestId}`;
  const override = local.overrides.items[overrideKey];
  const request = override ? mergeRequestOverride(baseRequest, override.patch) : baseRequest;
  return {
    request,
    linkedEnvironments: snapshot.environments,
    linkedFolders: snapshot.collections.folders,
  };
}

function mergeRequestOverride(base: ApiRequest, patch: Record<string, unknown>): ApiRequest {
  const merged: ApiRequest = { ...base };
  if (Array.isArray(patch.headers)) {
    merged.headers = patch.headers as ApiRequest['headers'];
  }
  if (Array.isArray(patch.contextVars)) {
    merged.contextVars = patch.contextVars as ApiRequest['contextVars'];
  }
  if (Array.isArray(patch.assertions)) {
    merged.assertions = patch.assertions as ApiRequest['assertions'];
  }
  if (Array.isArray(patch.extractions)) {
    merged.extractions = patch.extractions as ApiRequest['extractions'];
  }
  return merged;
}

function buildLinkedSnapshot(
  parsed: LinkedWorkspaceProbe,
  link: LinkedWorkspace,
): LinkedSnapshot | null {
  if (!parsed.collections && !parsed.environments) return null;
  return {
    workspaceName: parsed.workspaceName,
    pulledAt: link.linkedAt,
    ref: link.pinnedVersion ? `v${link.pinnedVersion}` : `HEAD@${link.source.branch}`,
    collections: parsed.collections ?? {
      tree: { id: 'remote-root', type: 'root', children: [] },
      requests: {},
      folders: {},
    },
    environments: parsed.environments ?? {
      items: {},
      activeName: null,
      priorityOrder: [],
    },
  };
}

/**
 * Parse a linked workspace's `workspace.json`. Pulls workspaceName,
 * releases.self, and the collections + environments we want to cache
 * locally for cross-workspace plan steps (P5.8). Leniency on missing
 * keys: a partially-malformed remote can still be linked; the caller
 * checks each field before relying on it.
 */
interface LinkedWorkspaceProbe {
  workspaceName: string;
  releases?: { self?: ReleaseHistory | null };
  collections?: WorkspaceSynced['collections'];
  environments?: WorkspaceSynced['environments'];
}
function parseLinkedWorkspaceJson(text: string): LinkedWorkspaceProbe {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('Remote workspace.json is not valid JSON');
  }
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Remote workspace.json is not an object');
  }
  const obj = raw as Record<string, unknown>;
  const name = obj.workspaceName;
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error('Remote workspace.json missing workspaceName');
  }
  const releasesValue = obj.releases;
  const releases =
    typeof releasesValue === 'object' && releasesValue !== null
      ? (releasesValue as { self?: ReleaseHistory | null })
      : undefined;
  const collectionsValue = obj.collections;
  const collections =
    typeof collectionsValue === 'object' && collectionsValue !== null
      ? (collectionsValue as WorkspaceSynced['collections'])
      : undefined;
  const environmentsValue = obj.environments;
  const environments =
    typeof environmentsValue === 'object' && environmentsValue !== null
      ? (environmentsValue as WorkspaceSynced['environments'])
      : undefined;
  return { workspaceName: name, releases, collections, environments };
}

/**
 * SHA-256 fallback for attachment bytes when the synced doc lacks a
 * recorded sha256 (older workspaces from before P5). Same algorithm as
 * persistence/attachments.ts; duplicated rather than re-exported to keep
 * that module's API surface narrow.
 */
/**
 * Plan §7.6: warn at 10 MB, refuse at GitHub's 100 MB hard limit. The
 * hard refusal throws; the soft warn lands in console (a future
 * revision can lift this into a toast).
 */
const ATTACHMENT_SOFT_LIMIT_BYTES = 10 * 1024 * 1024;
const ATTACHMENT_HARD_LIMIT_BYTES = 100 * 1024 * 1024;

function enforceAttachmentSize(file: File): void {
  if (file.size > ATTACHMENT_HARD_LIMIT_BYTES) {
    const mb = (file.size / 1024 / 1024).toFixed(1);
    throw new Error(
      `Attachment "${file.name}" is ${mb} MB, which exceeds GitHub's 100 MB limit for blob uploads.`,
    );
  }
  if (file.size > ATTACHMENT_SOFT_LIMIT_BYTES) {
    console.warn(
      `Attachment "${file.name}" is ${(file.size / 1024 / 1024).toFixed(1)} MB — pushes will be slow and the GitHub diff will be unreviewable. Consider Git LFS for files > 10 MB.`,
    );
  }
}

async function sha256HexBytes(bytes: Uint8Array): Promise<string> {
  // TS 5.9's BufferSource constraint rejects Uint8Array<ArrayBufferLike>
  // because the buffer type isn't pinned to ArrayBuffer. Cast through
  // unknown to satisfy the parameter; same pattern used in
  // persistence/attachments.ts.
  const source = bytes as unknown as BufferSource;
  const digest = await crypto.subtle.digest('SHA-256', source);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Find the vault entry that provisions a given (linkId, keyId) pair, if
 * any. Used to rotate the ciphertext on re-provision and to clean up on
 * key removal.
 */
function findProvisionedSecretId(
  local: WorkspaceLocal,
  linkId: string,
  keyId: string,
): string | null {
  for (const entry of Object.values(local.secretIndex.entries)) {
    if (
      entry.origin === 'linked' &&
      entry.linkedWorkspaceId === linkId &&
      entry.linkedKeyId === keyId
    ) {
      return entry.id;
    }
  }
  return null;
}

async function decryptSessionToken(local: WorkspaceLocal): Promise<string> {
  const session = local.sessions.github;
  if (!session) throw new Error('No GitHub session — connect a PAT first');
  const payload = await getSecretPayload(session.tokenSecretId);
  if (!payload) throw new Error('Stored token is missing — reconnect to refresh');
  const masterKey = await getMasterKey();
  return decryptString(payload, masterKey);
}

function commitSynced(
  set: SetState,
  get: GetState,
  reducer: (s: WorkspaceSynced) => WorkspaceSynced,
): void {
  const synced = get().synced;
  if (!synced) return;
  const next = reducer(synced);
  if (next === synced) return;
  set({ synced: next });
  void saveSynced(next);
  // Refresh the secret usedIn map whenever synced state moves; aggregator
  // is O(refs × secrets) and a no-op when nothing the secrets reference
  // changed, so this is cheap to do unconditionally.
  const local = get().local;
  if (local && Object.keys(local.secretIndex.entries).length > 0) {
    const updatedLocal = recomputeUsedIn(next, local);
    if (updatedLocal !== local) {
      set({ local: updatedLocal });
      void saveLocal(updatedLocal);
    }
  }
}

/**
 * Mirror of commitSynced for reducers that touch only `local`. Used by
 * plan / overrides / history actions that don't bleed into the synced
 * doc. Returns nothing — the reducer is expected to return the same
 * reference when the change was a no-op.
 */
function commitLocal(
  set: SetState,
  get: GetState,
  reducer: (l: WorkspaceLocal) => WorkspaceLocal,
): void {
  const local = get().local;
  if (!local) return;
  const next = reducer(local);
  if (next === local) return;
  set({ local: next });
  void saveLocal(next);
}

/**
 * Apply variable substitution + secret decryption to a request before it
 * goes to the executor. URL, query params, headers, body content, and
 * (for json/text/xml/graphql) the raw body string are all resolved against
 * the workspace scope (context vars > active env > priority list > secrets).
 *
 * Encrypted env-var values are decrypted in this single pass — the master
 * key is fetched once, decryption runs in parallel for the variables that
 * need it, and the resulting plaintext-only env map feeds the resolver.
 */
async function resolveRequest(
  request: ApiRequest,
  synced: WorkspaceSynced,
  local: WorkspaceLocal | null,
  overrides?: {
    envPriorityOrder?: readonly string[];
    /**
     * Plan-level variables. Sit between request.contextVars and the env
     * priority list — they override an env value without mutating the
     * env. Last-wins on duplicate keys (consistent with env vars).
     */
    planVariables?: ReadonlyArray<{ key: string; value: string }>;
  },
): Promise<ApiRequest> {
  const vault = local ? await decryptVault(local) : { byLabel: {}, byId: {} };
  const envs = decryptEnvironments(synced.environments.items, vault.byId);
  const secrets = vault.byLabel;

  // contextVars layer ordering (lowest → highest priority):
  //   1. workspace globalContext (rolling extracted state across runs)
  //   2. plan-level variables (if this is a plan run; bind for the run)
  //   3. per-request contextVars (always last → wins on collision)
  // Below contextVars sits the env layer (priorityOrder), then secrets.
  const ctxMap: Record<string, string> = { ...(local?.globalContext ?? {}) };
  for (const v of overrides?.planVariables ?? []) {
    if (v.key) ctxMap[v.key] = v.value;
  }
  for (const v of request.contextVars) {
    if (v.key) ctxMap[v.key] = v.value;
  }
  const contextVars = Object.entries(ctxMap).map(([key, value]) => ({ key, value }));
  // Plan-level priority overrides the workspace's global order when the
  // plan supplied a non-empty list (plan §6 P6 + §11.1 inline guidance).
  const priorityOrder =
    overrides?.envPriorityOrder && overrides.envPriorityOrder.length > 0
      ? [...overrides.envPriorityOrder]
      : synced.environments.priorityOrder;
  const scope = buildScope({
    contextVars,
    environments: envs,
    // The "active env" concept is gone in favor of an ordered global layer —
    // priorityOrder is the sole list the resolver consults.
    activeEnvName: null,
    priorityOrder,
    secrets,
  });

  const url = resolveString(request.url, scope).value;
  const headers = request.headers.map((h) => ({
    ...h,
    key: resolveString(h.key, scope).value,
    value: resolveString(h.value, scope).value,
  }));
  const query = request.query.map((q) => ({
    ...q,
    key: resolveString(q.key, scope).value,
    value: resolveString(q.value, scope).value,
  }));

  let body: RequestBody = request.body;
  if (
    body.type === 'json' ||
    body.type === 'text' ||
    body.type === 'xml' ||
    body.type === 'graphql' ||
    body.type === 'urlencoded'
  ) {
    body = { ...body, content: resolveString(body.content, scope).value };
  } else if (body.type === 'form-data' && body.formRows) {
    body = {
      ...body,
      formRows: body.formRows.map((row) => {
        if (row.kind === 'text') {
          return {
            ...row,
            key: resolveString(row.key, scope).value,
            value: resolveString(row.value, scope).value,
          };
        }
        return { ...row, key: resolveString(row.key, scope).value };
      }),
    };
  }

  // Resolve folder-level inheritance: if request.auth.type === 'inherit',
  // walk up the folder chain and pick the first explicit auth. The resolver
  // returns the original auth unchanged for non-inherit types.
  const auth = resolveInheritedAuth({
    requestAuth: request.auth ?? { type: 'none' },
    folderId: request.folderId,
    folders: synced.collections.folders,
  });

  return { ...request, url, headers, query, body, auth };
}

/**
 * Decrypt every encrypted variable in the workspace's env map and return a
 * plaintext map keyed by env name. Plain (non-encrypted) values pass through
 * verbatim. Decryption failures fall back to the ciphertext literal so the
 * user can see something went wrong rather than silently sending garbage.
 */
/**
 * Decrypt every Secret Vault entry into a flat label → plaintext map. The
 * resolver scope's `secrets` layer reads from this. Decryption failures
 * (lost master key, tampered ciphertext) drop the entry — the resolver
 * falls back to leaving the placeholder verbatim, which surfaces the
 * problem to the user rather than silently sending an empty value.
 */
/**
 * Decrypt every vault entry available in this browser. Returns parallel
 * label→plaintext and id→plaintext maps so callers can resolve either
 * `{{LABEL}}` template references or `secretKeyId`-linked env variables in
 * the same pass.
 */
async function decryptVault(
  local: WorkspaceLocal,
): Promise<{ byLabel: Record<string, string>; byId: Record<string, string> }> {
  const ids = Object.keys(local.secretIndex.entries);
  const empty = { byLabel: {}, byId: {} };
  if (ids.length === 0) return empty;
  const key = await getMasterKey();
  const byLabel: Record<string, string> = {};
  const byId: Record<string, string> = {};
  for (const id of ids) {
    const entry = local.secretIndex.entries[id];
    const payload = await getSecretPayload(id);
    if (!payload) continue;
    try {
      const plaintext = await decryptString(payload, key);
      byLabel[entry.label] = plaintext;
      byId[id] = plaintext;
    } catch {
      // skip on decrypt failure
    }
  }
  return { byLabel, byId };
}

/**
 * One-shot migration: walk every environment variable; any row that carries
 * an `encrypted: true` flag without a `secretKeyId` is from the legacy
 * master-key flow. Decrypt it with the local master key and re-store as a
 * plaintext row (the new model only allows encryption via vault references).
 *
 * Returns the same `synced` reference unchanged when there's nothing to
 * migrate. Failures fall back to clearing the value so the row never blocks
 * the app on a stale cipher.
 */
async function migrateLegacyEncryptedEnvVars(synced: WorkspaceSynced): Promise<WorkspaceSynced> {
  const items = synced.environments.items;
  const candidates: Array<{ envName: string; index: number; cipher: string }> = [];
  for (const [envName, env] of Object.entries(items)) {
    env.variables.forEach((v, index) => {
      if (v.encrypted && !v.secretKeyId && v.value)
        candidates.push({ envName, index, cipher: v.value });
    });
  }
  if (candidates.length === 0) return synced;

  let masterKey: CryptoKey | null = null;
  try {
    masterKey = await getMasterKey();
  } catch {
    masterKey = null;
  }

  const decrypted = new Map<string, string>();
  for (const { cipher } of candidates) {
    if (decrypted.has(cipher)) continue;
    if (!masterKey) {
      decrypted.set(cipher, '');
      continue;
    }
    const payload = tryParsePayload(cipher);
    if (!payload) {
      decrypted.set(cipher, '');
      continue;
    }
    try {
      decrypted.set(cipher, await decryptString(payload, masterKey));
    } catch {
      decrypted.set(cipher, '');
    }
  }

  const nextItems: Record<string, Environment> = {};
  for (const [envName, env] of Object.entries(items)) {
    const nextVars = env.variables.map((v) => {
      if (v.encrypted && !v.secretKeyId && v.value) {
        return { key: v.key, value: decrypted.get(v.value) ?? '', encrypted: false };
      }
      return v;
    });
    nextItems[envName] = { ...env, variables: nextVars };
  }

  return {
    ...synced,
    environments: { ...synced.environments, items: nextItems },
    meta: { ...synced.meta, updatedAt: new Date().toISOString() },
  };
}

function decryptEnvironments(
  items: Record<string, Environment>,
  vaultById: Record<string, string>,
): Record<string, Record<string, string>> {
  // Legacy master-key blobs are migrated to plaintext during hydrate, so the
  // only encrypted rows we still have to translate are the new model:
  // `encrypted: true` + `secretKeyId` → look up the decrypted vault value by id.
  const out: Record<string, Record<string, string>> = {};
  for (const [name, env] of Object.entries(items)) {
    const flat: Record<string, string> = {};
    for (const v of env.variables) {
      if (!v.key) continue;
      if (v.encrypted && v.secretKeyId) {
        const fromVault = vaultById[v.secretKeyId];
        if (typeof fromVault === 'string') {
          flat[v.key] = fromVault;
          continue;
        }
        // Vault entry missing locally — leave the var unresolved so the
        // resolver flags it (and the editor can surface a warning).
        continue;
      }
      flat[v.key] = v.value;
    }
    out[name] = flat;
  }
  return out;
}
