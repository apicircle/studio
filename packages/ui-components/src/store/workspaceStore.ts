import type {
  AttachmentRef,
  Assertion,
  ConnectedRepo,
  Environment,
  EnvironmentVariableOverride,
  LinkedSnapshot,
  FormDataRow,
  GitHubSession,
  HttpMethod,
  LocalAttachmentCacheEntry,
  LinkedWorkspace,
  MockEndpoint,
  MockResponseBody,
  MockResponseConfig,
  MockServerSource,
  PanelId,
  PlanRun,
  ReleaseHistory,
  ContextExtraction,
  GlobalFileAsset,
  GlobalGraphQL,
  GlobalSchema,
  Request as ApiRequest,
  FontFamilyId,
  RequestAuth,
  RequestBody,
  RequestOverridePatch,
  EnvPriorityRef,
  RequestRun,
  RetiredBranch,
  SecretKeyMeta,
  ThemeId,
  WorkingBranch,
  WorkspaceLocal,
  WorkspaceSnapshotTrigger,
  WorkspaceSynced,
} from '@apicircle/shared';
import {
  type GitHubBranch,
  type GitHubRepo,
  BranchDivergedError,
  GitHubClient,
  MissingScopeError,
} from '@apicircle/git';
import {
  checkPrCapabilityFromScopes,
  probePrCapability,
  resolvePrCapability,
} from './githubPrCapability';
import { decideRetirement, probeBranchRetirement } from './branchRetirement';
import { applyFont } from '../theme/applyFont';
import { applyFontSize, clampFontSizePercent } from '../theme/applyFontSize';
import {
  DEFAULT_WORKSPACE_NAME,
  RUN_BODY_PREVIEW_LIMIT,
  envPriorityKey,
  generateId,
} from '@apicircle/shared';
import {
  type AttachmentResolver,
  type CollectFolderExportResult,
  type ExecutionResult,
  type LinkedUpdatePreview,
  type LinkedUpdateResolutionMap,
  type ParsedApicircleEnvironment,
  type ParsedApicircleFolderExport,
  type ParsedPostmanCollection,
  type ParsedPostmanEnvironment,
  type PublishReleaseArgs,
  type AuthApplyOptions,
  type ResolutionMap,
  type ResolutionScope,
  type ThreeWayDiff,
  applyLinkedUpdate as applyLinkedUpdateCore,
  applyMerge,
  applyMutation as coreApplyMutation,
  buildScope,
  collectAttachmentSlots,
  computeThreeWayDiff,
  decryptString,
  deprecateRelease as deprecateReleaseAction,
  deriveKeyFromSlotValue,
  encryptString,
  executeRequest as coreExecuteRequest,
  extractContext,
  generateSlotSalt,
  generateWorkingBranchName,
  collectFolderExport,
  parseCurl,
  parseSemver,
  previewLinkedUpdate as previewLinkedUpdateCore,
  publishRelease as publishReleaseAction,
  parseWorkspaceJson,
  redactForGit,
  assertNoPlaintextCredentials,
  RemoteWorkspaceParseError,
  resolveInheritedAuth,
  resolveString,
  runAssertions,
  serializePayload,
  serializeWorkspaceForGit,
  sortVersionsDesc,
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
import { initSecretCrypto, unlockSecretCrypto } from '../persistence/passphraseKey';
import {
  WorkspaceMismatchError,
  type WorkspaceRegistry,
  createWorkspace as createWorkspacePersisted,
  deleteWorkspace as deleteWorkspacePersisted,
  loadWorkspace,
  loadWorkspaceById,
  recoverPartialWorkspace,
  setActiveWorkspace as setActiveWorkspacePersisted,
  updateRegistryEntryName as updateRegistryEntryNamePersisted,
  resetWorkspace as resetWorkspaceStorage,
  saveSynced,
} from '../persistence/workspaceStorage';
// Hot-path persistence is coalesced through a 250ms debounce — `commitSynced`
// and the per-keystroke editor actions queue here instead of writing the
// whole workspace doc to IndexedDB on every keystroke. Sensitive transitions
// (git push, hydrate, workspace switch) call `flushPendingPersist()` to await
// the disk write before continuing.
import {
  flushPendingPersist,
  primeObservedWorkspace,
  queueSaveBoth,
  queueSaveLocal,
  queueSaveSynced,
} from '../persistence/debouncedPersist';
import { getDiskMirror } from '../persistence/diskMirror';
import { mergeSyncedFromDisk } from '../persistence/diskMirrorMerge';
import type { McpPanelSection, McpRefreshResult } from '../panels/mcp/mcpPanelTypes';
import { applyTheme } from '../theme/applyTheme';
import type { ToastRecord } from '../primitives/Toast';
import { bytesToBase64 } from './attachmentBlobs';
import type { TreeEntryInput } from '@apicircle/git';
import {
  addFolder as addFolderAction,
  addRequest as addRequestAction,
  collectRequestSlotIds,
  duplicateFolder as duplicateFolderAction,
  duplicateRequest as duplicateRequestAction,
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
  duplicateMockEndpoint as duplicateMockEndpointAction,
  duplicateMockServer as duplicateMockServerAction,
} from './mockActions';
import {
  importApicircleFolderInto,
  type ImportApicircleFolderResult,
} from './apicircleImportAction';
import {
  addGlobalFileAsset as addGlobalFileAssetAction,
  addGlobalGraphQL as addGlobalGraphQLAction,
  addGlobalSchema as addGlobalSchemaAction,
  attachmentRefFromGlobalFileAsset,
  formDataRowFromGlobalFileAsset,
  removeGlobalFileAsset as removeGlobalFileAssetAction,
  removeGlobalGraphQL as removeGlobalGraphQLAction,
  removeGlobalSchema as removeGlobalSchemaAction,
  updateGlobalFileAsset as updateGlobalFileAssetAction,
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
import { assertSecretsProtected } from '../persistence/platformSecretGate';

const attachmentResolver: AttachmentResolver = async (slotId) => {
  const record = await getAttachment(slotId);
  if (!record) return null;
  return { blob: materializeAttachment(record), filename: record.filename };
};

interface AttachmentSlotRefLike {
  slotId: string;
  sha256?: string;
  filename?: string;
  mimeType?: string;
  size?: number;
  requiredBy: Array<{ requestId: string; requestName: string }>;
}

export interface AttachmentDownloadPromptItem {
  slotId: string;
  sha256?: string;
  filename: string;
  mimeType: string;
  size?: number;
  source: 'workspace' | 'linked-workspace';
  linkedWorkspaceId?: string;
  requiredBy: Array<{ requestId: string; requestName: string }>;
  localPath?: string;
}

export interface AttachmentDownloadPromptState {
  id: string;
  title: string;
  detail: string;
  items: AttachmentDownloadPromptItem[];
  resolve: (accepted: boolean) => void;
}

interface ExecutionAttachmentRequestRef {
  request: ApiRequest;
  source: AttachmentDownloadPromptItem['source'];
  linkedWorkspaceId?: string;
}

function collectAttachmentSlotsFromCollections(
  collections: WorkspaceSynced['collections'],
): AttachmentSlotRefLike[] {
  const seen = new Map<string, AttachmentSlotRefLike>();
  for (const req of Object.values(collections.requests)) {
    collectBodyAttachmentSlots(req, req.body, seen);
  }
  return [...seen.values()];
}

function collectBodyAttachmentSlots(
  request: ApiRequest,
  body: RequestBody,
  seen: Map<string, AttachmentSlotRefLike>,
): void {
  if (body.type === 'form-data' && body.formRows) {
    for (const row of body.formRows) {
      if (row.kind === 'file' && row.slotId && !seen.has(row.slotId)) {
        seen.set(row.slotId, {
          slotId: row.slotId,
          sha256: row.sha256,
          filename: row.filename,
          mimeType: row.mimeType,
          size: row.size,
          requiredBy: [{ requestId: request.id, requestName: request.name }],
        });
      } else if (row.kind === 'file' && row.slotId) {
        addAttachmentRequiredBy(seen.get(row.slotId), request);
      }
    }
  }
  if (body.type === 'binary') {
    const ref = body.attachment;
    if (ref?.slotId && !seen.has(ref.slotId)) {
      seen.set(ref.slotId, {
        slotId: ref.slotId,
        sha256: ref.sha256,
        filename: ref.filename,
        mimeType: ref.mimeType,
        size: ref.size,
        requiredBy: [{ requestId: request.id, requestName: request.name }],
      });
    } else if (ref?.slotId) {
      addAttachmentRequiredBy(seen.get(ref.slotId), request);
    }
  }
}

function collectAttachmentSlotsFromRequest(request: ApiRequest): AttachmentSlotRefLike[] {
  const seen = new Map<string, AttachmentSlotRefLike>();
  collectBodyAttachmentSlots(request, request.body, seen);
  return [...seen.values()];
}

function collectAttachmentSlotsFromGlobalAssets(
  globalAssets: WorkspaceSynced['globalAssets'] | undefined,
): AttachmentSlotRefLike[] {
  return Object.values(globalAssets?.files ?? {}).map((file) => ({
    slotId: file.slotId,
    sha256: file.sha256,
    filename: file.filename,
    mimeType: file.mimeType,
    size: file.size,
    requiredBy: [],
  }));
}

function collectAttachmentSlotsFromMockServers(
  mockServers: WorkspaceSynced['mockServers'] | undefined,
): AttachmentSlotRefLike[] {
  const seen = new Map<string, AttachmentSlotRefLike>();
  for (const server of Object.values(mockServers ?? {})) {
    for (const endpoint of server.endpoints) {
      collectMockResponseAttachmentSlots(endpoint.defaultResponse, endpoint.name, seen);
      for (const rule of endpoint.requestValidation ?? []) {
        collectMockResponseAttachmentSlots(rule.failResponse, `${endpoint.name} validation`, seen);
      }
      for (const rule of endpoint.responseRules ?? []) {
        collectMockResponseAttachmentSlots(rule.response, `${endpoint.name} rule`, seen);
      }
    }
  }
  return [...seen.values()];
}

function collectMockResponseAttachmentSlots(
  response: MockResponseConfig | null | undefined,
  label: string,
  seen: Map<string, AttachmentSlotRefLike>,
): void {
  const body = response?.body;
  if (body?.type !== 'binary') return;
  const ref = body.attachment;
  if (!ref?.slotId) return;
  const requiredBy = {
    requestId: `mock:${label}:${ref.slotId}`,
    requestName: `Mock response: ${label}`,
  };
  if (!seen.has(ref.slotId)) {
    seen.set(ref.slotId, {
      slotId: ref.slotId,
      sha256: ref.sha256,
      filename: ref.filename,
      mimeType: ref.mimeType,
      size: ref.size,
      requiredBy: [requiredBy],
    });
    return;
  }
  const existing = seen.get(ref.slotId);
  if (
    existing &&
    !existing.requiredBy.some((item) => item.requestName === requiredBy.requestName)
  ) {
    existing.requiredBy.push(requiredBy);
  }
}

function dedupeAttachmentSlots(slots: AttachmentSlotRefLike[]): AttachmentSlotRefLike[] {
  const seen = new Map<string, AttachmentSlotRefLike>();
  for (const slot of slots) {
    const existing = seen.get(slot.slotId);
    if (!existing) {
      seen.set(slot.slotId, { ...slot, requiredBy: [...slot.requiredBy] });
      continue;
    }
    for (const required of slot.requiredBy) {
      if (!existing.requiredBy.some((item) => item.requestId === required.requestId)) {
        existing.requiredBy.push(required);
      }
    }
  }
  return [...seen.values()];
}

function addAttachmentRequiredBy(
  slot: AttachmentSlotRefLike | undefined,
  request: ApiRequest,
): void {
  if (!slot) return;
  if (!slot.requiredBy.some((item) => item.requestId === request.id)) {
    slot.requiredBy.push({ requestId: request.id, requestName: request.name });
  }
}

function isGlobalFileSlot(synced: WorkspaceSynced, slotId: string): boolean {
  return Object.values(synced.globalAssets.files ?? {}).some((file) => file.slotId === slotId);
}

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

/**
 * Map of in-flight AbortControllers, keyed by request id (for single-request
 * sends) or `plan:<planId>` (for plan runs). The store's `cancelExecuteRequest`
 * and `cancelExecutePlan` actions look the controller up here and call
 * `.abort()`. Lives outside the store state because AbortController is not
 * serialisable and should not be persisted/diffed.
 */
const inflightAbortControllers = new Map<string, AbortController>();

/**
 * Surface request / folder / environment counts for refresh-result toasts.
 * Keeping the helper close to `refreshFromDisk` since that's the only
 * caller — and the shape is intentionally narrow so it's cheap to compute
 * on every refresh without touching `synced.local` or attachments.
 */
function countsOf(synced: WorkspaceSynced): {
  requests: number;
  folders: number;
  environments: number;
} {
  return {
    requests: Object.keys(synced.collections.requests).length,
    folders: Object.keys(synced.collections.folders).length,
    environments: Object.keys(synced.environments.items).length,
  };
}

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
/**
 * Strip `user:pass@` userinfo from a URL before we persist it to a
 * `RequestRun` record. URLs like `https://leaked:secret@api.example.com/x`
 * are valid + sent as Basic auth on the wire, but they MUST NOT survive
 * into history (the run record is rendered in the History panel, can be
 * exported, and travels through git via plan-run records).
 *
 * Returns the URL unchanged when there's no userinfo, or when the URL
 * fails to parse (we don't want to break legitimate weirdness — the URL
 * field tolerates pre-resolution variables like `{{BASE}}/x`).
 */
function redactUrlCredentials(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) {
      parsed.username = '';
      parsed.password = '';
      return parsed.toString();
    }
  } catch {
    // Not a parseable URL — leave it alone.
  }
  return url;
}

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
    // Redact embedded user:pass@ from URLs before they enter history.
    // The live wire request still carries the credentials (Chromium
    // converts userinfo into a Basic auth header); we only strip them
    // from the persisted record. Audit P2.
    url: redactUrlCredentials(result.url),
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
  | { status: 'conflicts'; diff: ThreeWayDiff }
  // Remote branch HEAD was *not* a descendant of our last pushed commit —
  // typical of a force-push that rewrote history. We never silently merge
  // across this; the user must explicitly choose to adopt the remote or
  // keep local via the resolver modal.
  | { status: 'history-rewritten'; diff: ThreeWayDiff }
  // Refresh discovered the working branch is retired (PR merged, or branch
  // deleted on GitHub). The store has cleared `workingBranch` and set
  // `local.retiredBranch` so the UI can surface a banner; nothing else to do.
  | { status: 'retired'; retired: RetiredBranch };

/**
 * Tabs hosted by the right-side dock. Variables is read-mostly (filter +
 * copy `{{name}}`). Vault is the encrypted secrets + GitHub session
 * surface. Assets is the workspace-wide JSON Schema + GraphQL library.
 */
export type RightDockTab = 'variables' | 'vault' | 'assets';

/**
 * Sub-tab inside the Secret Vault dock panel. Lifted to store state so
 * callers outside the dock (e.g. "Manage session" / "Connect via Secret
 * Vault → Sessions" buttons on the Workspace panel) can land the user
 * directly on the right sub-tab — otherwise the dock always opened to
 * "vault" regardless of what the button copy promised.
 */
export type VaultSubtab = 'vault' | 'sessions';

/**
 * Pending refresh state staged after `refreshWorkspace` finishes the
 * remote read but before the merge lands. Discriminated so the
 * ConflictResolverModal renders the right view: classic conflicts vs.
 * a "remote history was rewritten" path that *requires* explicit user
 * intent — never silently merging across a force-push.
 */
interface PendingRefresh {
  diff: ThreeWayDiff;
  remote: WorkspaceSynced;
  remoteSha: string;
  /**
   * When true, the remote branch HEAD was *not* a descendant of our last
   * pushed commit — i.e. someone force-pushed and the histories diverged.
   * The modal must require explicit "Adopt remote" / "Keep local" / "Cancel"
   * rather than auto-merging.
   */
  historyRewritten?: boolean;
}

/**
 * Ephemeral UI state for the History panel. Filters + selected-run live here
 * so the sidebar (filters) and main area (run list + detail) stay in sync
 * without prop-drilling.
 */
export interface HistoryUiState {
  tab: 'requests' | 'plans' | 'snapshots';
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

/**
 * One unresolved encrypted-row binding produced by importApicircleEnvironment.
 * The ImportModal's second step renders one input per pending binding and
 * (when the user provides a value) addSecret + bindVariableToSecretKey it
 * onto the freshly-imported env.
 */
export interface ApicircleEnvironmentPendingBinding {
  /** The destination env name (post-collision-rename). */
  envName: string;
  /** The variable key in the env that needs binding. */
  varKey: string;
  /** Human label from the source export (or var key fallback). */
  label: string;
  /** True when the source export carried no `secret.label` and the label was synthesized. */
  labelFromFallback: boolean;
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
  /**
   * Right-side dock state. Hosts the workspace inspector tabs:
   * Variables (read-mostly reference list), Vault (secret + GitHub
   * sessions CRUD), and Assets (Global JSON Schemas + GraphQL).
   *
   * - `tab === null` collapses the dock entirely.
   * - `mode === 'overlay'` floats the dock above the main content (the
   *   default when first opened from the rail). Clicking the dock's
   *   pin/dock button switches to `mode === 'docked'`, which inserts the
   *   dock into the main `PanelGroup` so it claims real layout space and
   *   the user can drag-resize via the splitter.
   *
   * Width while docked is persisted by `react-resizable-panels` via
   * `autoSaveId`; the overlay uses a fixed default width.
   */
  rightDock: {
    tab: RightDockTab | null;
    mode: 'overlay' | 'docked';
    /** Sub-tab the Secret Vault panel renders. Owned by the store so
     *  callers can deep-link to "sessions" without the dock falling
     *  back to its default "vault" view. */
    vaultSubtab: VaultSubtab;
  };
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
   * Blocking execution prompt shown when a request/plan references file
   * attachments whose bytes are not cached on this machine yet.
   */
  attachmentDownloadPrompt: AttachmentDownloadPromptState | null;
  resolveAttachmentDownloadPrompt: (accepted: boolean) => void;
  /**
   * Surfaced after `createWorkingBranch` when the new branch already has
   * a `workspace.json` (i.e. the repo was pre-populated). The banner in
   * WorkspacePanel uses this to offer a "Pull first" path so the user
   * doesn't accidentally clobber upstream content with their local seed.
   * `null` once the user accepts or skips.
   */
  firstPullPrompt: { branchName: string; remoteSha: string } | null;
  acknowledgeFirstPull: () => void;
  /**
   * Ephemeral UI state for the History panel — not persisted. Lives on the
   * store so the sidebar (filters) and main area (run list + detail) can
   * share state without a parent prop drill.
   */
  historyUi: HistoryUiState;
  setHistoryUi: (next: Partial<HistoryUiState>) => void;
  /**
   * Active toasts (transient notifications). Ephemeral; not persisted. The
   * ToastViewport at App root renders these and dismisses each on its TTL
   * (or when the user clicks the close affordance). `pushToast` is the
   * surface for any code path that previously discarded an error via
   * `void asyncFn()`.
   */
  toasts: ReadonlyArray<ToastRecord>;
  pushToast: (toast: Omit<ToastRecord, 'id'>) => string;
  dismissToast: (id: string) => void;

  // --- Workspace passphrase (in-memory only — never persisted) -----------
  /**
   * The decrypted master key, if the workspace passphrase has been
   * unlocked this session. `null` means secrets are locked (or no
   * passphrase has been set yet). NEVER serialised to IDB / git.
   */
  secretKey: CryptoKey | null;
  /**
   * Discriminated lock state for the UI:
   *   - 'unset'   — workspace has no secretCrypto yet (no passphrase
   *                 ever set). Lazy: don't prompt unless the user
   *                 explicitly starts adding a secret.
   *   - 'locked'  — secretCrypto is set, key is in memory cleared
   *                 (post-restart or post-idle-lock). Prompt to unlock
   *                 before any secret operation.
   *   - 'unlocked' — key is held in `secretKey`; secret reads/writes
   *                 work transparently.
   */
  secretLockState: 'unset' | 'locked' | 'unlocked';
  /**
   * Timestamp (ms since epoch) of the last action that touched the
   * passphrase-derived key. Used by the 15-minute idle-lock timer.
   * `null` means "never used this session" — no idle pressure yet.
   */
  lastSecretActivityAt: number | null;
  /**
   * Which passphrase modal is open, if any. `null` means closed.
   * `'setup'` triggers the "create new passphrase" form; `'unlock'`
   * triggers "enter existing passphrase to decrypt". The Vault dock,
   * `assertSecretsProtected` callsites, and any future secret-aware
   * flow flip this to surface the modal — the gate at app root
   * renders it from a single source of truth.
   */
  passphraseModal: 'setup' | 'unlock' | null;
  /** Open the "set a new workspace passphrase" modal. No-op if the
   *  workspace already has a `secretCrypto` blob — caller should use
   *  `openPassphraseUnlock` instead. */
  openPassphraseSetup: () => void;
  /** Open the "enter passphrase to unlock secrets" modal. No-op if
   *  the workspace has no `secretCrypto` set or is already unlocked. */
  openPassphraseUnlock: () => void;
  /** Close whichever passphrase modal is open (cancel path). */
  closePassphraseModal: () => void;
  /**
   * Initialise the secret-crypto blob from a fresh passphrase. Writes
   * `synced.secretCrypto` and stashes the derived key in memory.
   * Returns the verifier so the modal can confirm success.
   */
  setupPassphrase: (passphrase: string) => Promise<{ ok: true } | { ok: false; reason: string }>;
  /**
   * Verify a passphrase against `synced.secretCrypto.verifier`. On match,
   * stash the derived key in memory (state goes to 'unlocked'). On
   * mismatch, return the reason so the modal can render it.
   */
  unlockWithPassphrase: (
    passphrase: string,
  ) => Promise<{ ok: true } | { ok: false; reason: string }>;
  /**
   * Drop the in-memory key. Called by the 15-min idle lock and by an
   * explicit user "Lock now" affordance.
   */
  lockSecrets: () => void;
  /**
   * Note that the user just did something that touched secret-aware
   * state. Resets the idle-lock countdown. Called from any flow that
   * reads or writes encrypted values.
   */
  noteSecretActivity: () => void;
  /**
   * Encrypted env vars whose decryption couldn't complete on the latest
   * resolver pass. Populated by `buildResolverScope` after every
   * request-execute / preview / autocomplete refresh. `missing-slot-value`
   * is the common "post-pull, slot not provisioned yet" state and is
   * already covered by the Vault's `ProvideMissingSlotsGate`. The new
   * signal is `decrypt-failed` — slot was provided but its plaintext
   * doesn't decrypt the row's ciphertext (most often: re-keyed slot,
   * passphrase drift, or a value typo). Empty array means "everything
   * decrypted last time we tried".
   */
  envDecryptFailures: EnvDecryptFailure[];
  /**
   * Clear the decryption-failure list. Called by the Environments panel
   * banner's "dismiss" button — the failures will rebuild on the next
   * resolver run if they're still real.
   */
  clearEnvDecryptFailures: () => void;
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

  // --- Multi-workspace registry (B.6) ---------------------------------
  /** Snapshot of every registered workspace + which one is currently active. */
  workspaceRegistry: WorkspaceRegistry | null;
  /**
   * Switch the active workspace. Persists to the registry, then loads
   * the selected workspace's synced + local records and replaces the
   * in-memory state. Throws if the id isn't in the registry.
   */
  switchWorkspace: (workspaceId: string) => Promise<void>;
  /**
   * Create a fresh workspace + register it. The new workspace becomes
   * active. Returns the new workspace's id.
   */
  createNewWorkspace: (name: string) => Promise<string>;
  /**
   * Delete a workspace. If it was the active one, switches to the
   * most-recently-opened remaining workspace; if it was the last,
   * seeds a fresh empty workspace.
   */
  deleteWorkspaceById: (workspaceId: string) => Promise<void>;

  setActivePanel: (panel: PanelId) => void;
  setActiveRequestId: (id: string | null) => void;
  toggleSidebarSection: (section: string) => void;
  setThemeId: (themeId: ThemeId) => void;
  /**
   * Set the workspace-bound font family. Persists via `local.ui.fontId`
   * so switching workspaces re-applies whichever font that workspace
   * had selected (parity with theme).
   */
  setFontId: (fontId: FontFamilyId) => void;
  /**
   * Set the workspace-bound UI text-size percentage. The store clamps
   * to `[FONT_SIZE_PERCENT_MIN, FONT_SIZE_PERCENT_MAX]` and snaps to
   * `FONT_SIZE_PERCENT_STEP`, then applies via `applyFontSize` and
   * persists on `local.ui.fontSizePercent`.
   */
  setFontSizePercent: (percent: number) => void;
  /**
   * Rename the active workspace. The name is registry-only (never
   * pushed to git) so two machines backed by the same repo can each
   * label their local copy independently.
   */
  setWorkspaceName: (name: string) => void;
  /** Toggle the pre-send validation panel (local.settings.validateOnSend). */
  setValidateOnSend: (value: boolean) => void;
  /**
   * Toggle whether Monaco editors consume mouse-wheel events. When false
   * (default), wheel events bubble so the page can scroll past the editor.
   */
  setMonacoConsumesWheel: (value: boolean) => void;
  /**
   * Capture a snapshot of the current `synced` doc into the local
   * snapshot ledger. Used both by destructive ops (push, merge, linked
   * update, yank, deprecate) and by the user via the History panel
   * "Take snapshot" button.
   */
  captureSnapshot: (args?: { trigger?: WorkspaceSnapshotTrigger; note?: string }) => string | null;
  /** Restore the synced doc from a snapshot in the ledger. Returns true if found. */
  restoreSnapshot: (id: string) => boolean;
  /** Drop a snapshot from the ledger. */
  deleteSnapshot: (id: string) => void;
  /**
   * Update the snapshot ring-buffer cap. Lowering the cap evicts entries
   * until the total fits.
   */
  setSnapshotMaxBytes: (maxBytes: number) => void;

  /** Remove a mock definition from the workspace. No runtime side effect. */
  removeMockServer: (id: string) => void;
  /**
   * Create a new mock definition in `synced.mockServers`. The `source`
   * union discriminates between manual-CRUD endpoints and pasted spec
   * blobs (OpenAPI / Postman / Insomnia). Spec blobs are stored
   * verbatim with `endpoints: []` — the runtime (Desktop / CLI) parses
   * the blob at Start time. The web UI never invokes a parser, so it
   * can create any mock kind regardless of platform.
   */
  createMockServer: (args: { name: string; source: MockServerSource }) => string;
  /** Rename a mock definition. */
  setMockServerName: (id: string, name: string) => void;
  /**
   * Update CORS config on a mock server. CORS is off by default (the runtime
   * is meant for same-origin probing); turning it on with an origin list is
   * what lets browser-side apps hit the running mock from a different port.
   */
  setMockServerCors: (id: string, cors: { enabled: boolean; origins: string[] }) => void;
  /** Replace a mock's endpoints (used by manual-mode editor). */
  setMockServerEndpoints: (id: string, endpoints: MockEndpoint[]) => void;
  /** Add a new endpoint to a manual-mode mock server. Returns the new endpoint id. */
  addMockEndpoint: (serverId: string) => string;
  /** Replace fields on a single endpoint. */
  updateMockEndpoint: (serverId: string, endpointId: string, patch: Partial<MockEndpoint>) => void;
  /** Remove an endpoint from a server. */
  removeMockEndpoint: (serverId: string, endpointId: string) => void;
  /**
   * Clone a mock server with all of its endpoints + nested rules. Every
   * cloned entity gets a fresh id; the legacy `overrides` map is reset
   * since it keys by old endpoint ids. Returns the new server's id, or
   * null when the source doesn't exist.
   */
  duplicateMockServer: (id: string) => string | null;
  /**
   * Clone an endpoint inside the same server. Validation rules,
   * response rules (and their clauses), and response multipliers all
   * get fresh ids. Returns the new endpoint's id, or null when the
   * source doesn't exist.
   */
  duplicateMockEndpoint: (serverId: string, endpointId: string) => string | null;
  /** Active endpoint id (drives the mock editor pane). Per-workspace transient state. */
  activeMockServerId: string | null;
  activeMockEndpointId: string | null;
  setActiveMockEndpoint: (args: { serverId: string; endpointId: string | null }) => void;
  /** Whether the "Create mock server" modal is open. */
  mocksCreateModalOpen: boolean;
  openMocksCreateModal: () => void;
  closeMocksCreateModal: () => void;
  /**
   * Attach a file to a mock endpoint's binary response body. Stores the
   * blob in the same Global-Assets attachment store the request editor
   * uses (slotId-based; SHA-256 cached on the synced doc). Returns the
   * attachment ref written into `defaultResponse.body.attachment`.
   */
  attachMockResponseFile: (
    serverId: string,
    endpointId: string,
    file: File,
  ) => Promise<AttachmentRef>;
  /** Point a mock endpoint binary response at a reusable Global Assets file. */
  setMockResponseGlobalFileAsset: (
    serverId: string,
    endpointId: string,
    fileAssetId: string | null,
  ) => Promise<void>;
  /** Drop the attachment for a mock endpoint's response body. */
  detachMockResponseFile: (serverId: string, endpointId: string) => Promise<void>;

  /**
   * Open a tab in the right-side dock. If the dock was closed, opens it.
   * For the Vault tab specifically, callers can pre-select the
   * Vault-vs-Sessions sub-tab via `opts.vaultSubtab` — used by the
   * "Connect via Secret Vault → Sessions" / "Manage session" buttons
   * on the Workspace panel.
   */
  openRightDockTab: (tab: RightDockTab, opts?: { vaultSubtab?: VaultSubtab }) => void;
  /** Close the dock entirely. */
  closeRightDock: () => void;
  /** Switch the active tab without changing dock visibility. No-op if the dock is closed. */
  setRightDockTab: (tab: RightDockTab) => void;
  /** Switch the Secret Vault dock's sub-tab. */
  setVaultSubtab: (subtab: VaultSubtab) => void;
  /**
   * Toggle helper for the right-edge rail icons: clicking the same tab
   * twice closes the dock; clicking a different tab while open just
   * switches.
   */
  toggleRightDockTab: (tab: RightDockTab) => void;
  /**
   * Switch between the floating overlay and the docked layout. The
   * choice is sticky — re-opening the dock preserves the last mode.
   */
  setRightDockMode: (mode: 'overlay' | 'docked') => void;

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
   * Clone a request inside the same folder, with fresh id + timestamps
   * and a uniquified `(copy)` name. Returns the new request id, or null
   * when the source id doesn't exist.
   */
  duplicateRequest: (id: string) => string | null;
  /**
   * Clone a folder along with every descendant folder + request,
   * generating fresh ids for everything. Returns the new top-level
   * folder id, or null when the source id doesn't exist.
   */
  duplicateFolder: (id: string) => string | null;
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
  /**
   * Import a parsed API Circle environment export (the `apicircleEnvironment: 1`
   * envelope produced by `exportEnvironment` / the MCP `environment.export`
   * tool).
   *
   * Returns:
   *   - `name`: the final env name (uniquified when it collided)
   *   - `pendingBindings`: encrypted rows that couldn't be resolved
   *     against the destination's vault — the caller (ImportModal)
   *     surfaces a second step prompting the user to provide values
   *   - `warnings`: pass-through from the parser
   *
   * Hint resolution order, per encrypted row:
   *   1. `originSecretKeyId` matches a slot in `synced.secretKeys` →
   *      reuse that slot, keep the binding intact (same-workspace
   *      re-import path).
   *   2. `label` matches a slot's label → re-point `secretKeyId` to the
   *      matched slot and keep the binding (cross-workspace match).
   *   3. No match → keep the row encrypted with the source's id (so the
   *      env-panel chip renders something) and emit a `pendingBinding`.
   *
   * `null` when no synced doc is loaded.
   */
  importApicircleEnvironment: (parsed: ParsedApicircleEnvironment) => {
    name: string;
    pendingBindings: ApicircleEnvironmentPendingBinding[];
    warnings: string[];
  } | null;
  /**
   * Build the `apicircle.folder/v1` export envelope for a folder + a
   * human-readable dependency report. Returns `null` when `folderId`
   * doesn't exist or the workspace isn't loaded — UI callers should
   * treat that as a no-op (the source folder was deleted between menu
   * open and click). Read-only — does NOT mutate the workspace.
   */
  buildFolderExport: (folderId: string) => CollectFolderExportResult | null;
  /**
   * Graft a parsed API Circle folder export into the active workspace
   * under `parentFolderId` (null = at root). The parser side
   * (`@apicircle/core`) already minted fresh ids and warnings; this
   * action de-dupes captured global assets against the destination
   * workspace's library so re-imports don't pile up duplicates.
   */
  importApicircleFolder: (
    parsed: ParsedApicircleFolderExport,
    parentFolderId?: string | null,
  ) => ImportApicircleFolderResult | null;
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
  addGlobalFileAsset: (
    file: File,
    init?: { name?: string; description?: string },
  ) => Promise<string>;
  updateGlobalFileAsset: (
    id: string,
    patch: Partial<Omit<GlobalFileAsset, 'id' | 'createdAt' | 'slotId' | 'sha256'>>,
  ) => void;
  removeGlobalFileAsset: (id: string) => Promise<void>;
  setFormRowGlobalFileAsset: (
    requestId: string,
    rowIndex: number,
    fileAssetId: string | null,
  ) => Promise<void>;
  setBinaryGlobalFileAsset: (requestId: string, fileAssetId: string | null) => Promise<void>;

  /**
   * Open/close the Import modal. Driven from sidebar kebab menus (Editor and
   * Environments) so the kebab can live in the shared Sidebar header without
   * needing to share local React state with the panel-specific sidebar.
   */
  importModalOpen: boolean;
  openImportModal: () => void;
  closeImportModal: () => void;

  /**
   * Pending name-first create flow in the Editor sidebar. Set by the sidebar
   * header kebab ("New Request" / "New Folder"), consumed by EditorSidebar to
   * render an inline name input row. Reset to `null` after commit/cancel.
   */
  editorPendingCreate: { kind: 'request' | 'folder'; parentId: string | null } | null;
  setEditorPendingCreate: (
    value: { kind: 'request' | 'folder'; parentId: string | null } | null,
  ) => void;

  /**
   * Pending environment-add flow in the Environments sidebar. `true` shows the
   * inline name input; `false` hides it. Set by the sidebar header kebab.
   */
  envAdding: boolean;
  setEnvAdding: (value: boolean) => void;

  /** Help Center: search query + selected section id, shared between
   * HelpSidebar (search input + section list) and HelpPanel (article view). */
  helpQuery: string;
  helpSectionId: string | null;
  setHelpQuery: (value: string) => void;
  setHelpSectionId: (value: string | null) => void;

  /** MCP panel: which top-level section is active. The panel renders one
   *  section at a time (Connection / Prompts); the sidebar lists the two. */
  mcpActiveSection: McpPanelSection;
  setMcpActiveSection: (value: McpPanelSection) => void;
  /** MCP Connection sub-state: which AI client's snippet is in the setup
   *  picker. `null` means the picker hasn't been touched yet — the block
   *  defaults to Claude Desktop in that case. */
  mcpHowToConnectClient: string | null;
  setMcpHowToConnectClient: (value: string | null) => void;
  /**
   * MCP "Connection" refresh: re-read `workspace.synced.json` from disk
   * and, if it's newer than the in-memory copy, hydrate the store with
   * it. Returns a result discriminator so the caller can render a toast
   * describing what happened. No-op (returns 'no-mirror') on web.
   */
  refreshFromDisk: () => Promise<McpRefreshResult>;

  /**
   * Re-read `<root>/registry.json` from disk and push the result into
   * `workspaceRegistry`. Used by the file-watcher subscription when an
   * external writer (apicircle CLI `workspaces create`, MCP server) adds
   * or renames workspaces — without this the desktop's workspace
   * switcher would stay stuck on its boot-time snapshot.
   *
   * Returns the count of newly-visible workspaces (entries present on
   * disk that weren't in the in-memory registry), or `null` when the
   * mirror is unavailable (web build).
   */
  refreshRegistryFromDisk: () => Promise<
    { kind: 'no-mirror' } | { kind: 'updated'; added: number }
  >;

  // --- Linked-content overrides ---------------------------------------
  /**
   * Replace (or merge into) the override patch for a linked workspace's
   * request. Patch is a delta — every field is optional, present ⇒
   * replaces source value, absent ⇒ inherits from snapshot. Stored on
   * `synced.linkedOverrides.requests` so it round-trips through Git.
   *
   * Pass an empty `patch` to clear (equivalent to clearLinkedRequestOverride).
   */
  setLinkedRequestOverride: (
    linkedWorkspaceId: string,
    itemId: string,
    patch: RequestOverridePatch,
  ) => void;
  /** Drop the override for a linked workspace's request, restoring source content. */
  clearLinkedRequestOverride: (linkedWorkspaceId: string, itemId: string) => void;
  /**
   * Drop a single field from the override patch (e.g. just `url`), restoring
   * that one field to source while keeping other locally-modified fields. If
   * removing the last field, the whole override row is collapsed.
   */
  clearLinkedRequestOverrideField: (
    linkedWorkspaceId: string,
    itemId: string,
    field: keyof RequestOverridePatch,
  ) => void;

  /**
   * Set or update a per-variable override on a linked workspace's
   * environment. Stored on `synced.linkedOverrides.environmentVars`.
   * The `varKey` may or may not exist in the source's env; in either
   * case the override row carries the consumer's intent. Pass
   * `removed: true` to soft-delete a source variable for this consumer.
   */
  setLinkedEnvVarOverride: (
    linkedWorkspaceId: string,
    envName: string,
    varKey: string,
    patch: Pick<EnvironmentVariableOverride, 'value' | 'encrypted' | 'secretKeyId' | 'removed'>,
  ) => void;
  clearLinkedEnvVarOverride: (linkedWorkspaceId: string, envName: string, varKey: string) => void;

  /**
   * Drop every override (request + env-var) for one linked workspace.
   * Wires the "Discard all my modifications" affordance on the link card.
   */
  clearLinkedOverridesFor: (linkedWorkspaceId: string) => void;

  /** Currently-viewed linked request, if any. Drives LinkedRequestEditor. */
  activeLinkedRequest: { linkedWorkspaceId: string; itemId: string } | null;
  setActiveLinkedRequest: (id: { linkedWorkspaceId: string; itemId: string } | null) => void;

  /**
   * Execute the linked request currently open in the LinkedRequestEditor.
   * Resolves variables against the source workspace's environments (with
   * the consumer's env-var overrides applied) and walks the source folder
   * chain for `auth.type === 'inherit'` resolution. Run history is recorded
   * in the consumer's `local.history.requestRuns` keyed by the linked
   * request's id (same id space as owned requests; the run tags the
   * source via its `requestName`).
   */
  executeLinkedActiveRequest: () => Promise<void>;

  // --- Linked-workspace update / preview ------------------------------
  /**
   * Active update preview for one linked workspace. Set by
   * `previewLinkedUpdateForLink`; cleared by `clearLinkedUpdatePreview`
   * or after a successful `applyLinkedUpdateForLink`. Drives
   * UpdatePreviewModal.
   */
  activeLinkedUpdate: {
    linkedWorkspaceId: string;
    preview: LinkedUpdatePreview;
  } | null;
  /** Fetch the source workspace.json at HEAD@branch and classify changes against the consumer's pinned snapshot. */
  previewLinkedUpdateForLink: (linkedWorkspaceId: string) => Promise<void>;
  clearLinkedUpdatePreview: () => void;
  /**
   * Apply the active update: bumps `pinnedVersion` to source's current,
   * replaces the cached snapshot, and rewrites `synced.linkedOverrides`
   * per the user's resolutions (drop accepted-source, keep accepted-
   * mine, drop orphans by default).
   */
  applyLinkedUpdateForLink: (resolutions: LinkedUpdateResolutionMap) => Promise<void>;
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
  setPriorityOrder: (order: EnvPriorityRef[]) => void;
  setVariables: (envName: string, variables: Environment['variables']) => void;
  addVariableRow: (envName: string) => void;
  /**
   * Set a variable's plaintext value. If the row is already bound to a
   * secret-key slot, the value is re-encrypted under that slot's derived
   * key and stored as `enc:v1:` ciphertext. Plain rows just store the value
   * verbatim. Async because encryption is.
   */
  setVariableValue: (envName: string, index: number, value: string) => Promise<void>;
  /**
   * Bind an environment variable to a vault secret-key slot. Encrypts the
   * row's current plaintext under the slot's derived key (PBKDF2 over the
   * slot's salt + the user-supplied value) and stores the resulting
   * ciphertext in `value`. Resolves to `false` when binding is impossible
   * (slot value missing on this device — caller should prompt the user).
   */
  bindVariableToSecretKey: (
    envName: string,
    index: number,
    secretKeyId: string,
  ) => Promise<boolean>;
  /**
   * Reverse of bindVariableToSecretKey: decrypt the ciphertext back to
   * plaintext under the slot's derived key, drop secretKeyId, set
   * encrypted=false. Resolves to `false` when the slot value is missing
   * locally and the row can't be safely unbound (we'd be wiping the value).
   *
   * Pass `{ force: true }` to unbind regardless of decrypt result — the row's
   * value will be cleared to `''` and the caller is expected to have
   * confirmed with the user first (the value is unrecoverable from this
   * device). The decrypt-success path still recovers the plaintext.
   */
  unbindVariableSecretKey: (
    envName: string,
    index: number,
    opts?: { force?: boolean },
  ) => Promise<boolean>;
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
  /**
   * First-time slot value entry on a fresh device — assumes the value
   * matches what existing env-var ciphertext was originally encrypted
   * under, so it does NOT attempt re-encryption. Use `setSecretValue`
   * to rotate a value that was previously set.
   */
  provideSlotValue: (id: string, value: string) => Promise<boolean>;
  /**
   * Slot ids referenced by `synced.secretKeys` whose plaintext value is
   * missing in the local IDB vault on this device. Drives the onboarding
   * "Provide values" gate in the Secret Vault dock.
   */
  listMissingSlots: () => Promise<SecretKeyMeta[]>;
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
   * Kick off GitHub's OAuth Device Flow. Returns the user-facing code +
   * verification URL immediately so the UI can render them; the
   * promise resolves to the final `GitHubSession` once the user
   * completes the flow on github.com/login/device. The caller passes
   * progress callbacks to render the polling state and a signal so the
   * UI can cancel mid-flow.
   *
   * Browser-only: GitHub's OAuth public-client path is device flow
   * (no client_secret involved). The API Circle Studio OAuth App's client
   * id is bundled at build time; override via `VITE_GITHUB_OAUTH_CLIENT_ID`
   * to point a fork at its own OAuth App. "Enable Device Flow" must be
   * turned on in the App's GitHub settings.
   */
  connectGitHubSessionViaDeviceFlow: (args: {
    onCodeReady: (info: { userCode: string; verificationUri: string; expiresAt: number }) => void;
    signal?: AbortSignal;
  }) => Promise<GitHubSession>;
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
   * Seed the very first commit on a freshly-created empty repo. Writes a
   * minimal scaffold `workspace.json` (current workspaceId + empty content
   * arrays) onto `connectedRepo.defaultBranch` via the Contents API (the
   * only endpoint that bootstraps an empty git database). The workspace
   * name is intentionally absent — names are per-machine and live on the
   * local registry, not in the git-tracked doc.
   * Idempotent: if a workspace.json already exists on the default branch,
   * skips the write and reuses that blob sha — handles cases where a prior
   * attempt partially landed or `listBranches` lagged behind a recent write.
   *
   * The returned `scaffoldSha` is also persisted to `local.seededWorkspaceSha`
   * so the next `createWorkingBranch` can recognise its own scaffold on the
   * new branch and suppress the "remote already has content" first-pull
   * prompt — that prompt only makes sense for genuinely pre-populated remote
   * content, not the empty seed we just wrote ourselves.
   */
  seedInitialCommit: () => Promise<{ branchName: string; scaffoldSha: string }>;
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
   * the first commit. Defaults: title "API Circle workspace updates",
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
  /**
   * Clear `local.retiredBranch` after the user has acknowledged the
   * retirement banner (typically by clicking "Create new branch" or the
   * dismiss X). Idempotent — safe to call when nothing is set.
   */
  dismissRetiredBranch: () => void;
  /**
   * Re-probe a retired branch's GitHub state. If the branch is alive
   * again (someone reopened the PR or restored the deleted branch),
   * reconstruct `workingBranch` from the probe and clear `retiredBranch`.
   *
   * Returns a discriminated result so the UI can show the right toast:
   *   - `restored` — banner clears + the user is back on the working branch
   *   - `still-retired` — nothing changed; banner stays
   *   - `error` — transient probe failure; banner stays
   */
  recheckRetiredBranch: () => Promise<
    | { status: 'restored'; branchName: string; headSha: string }
    | { status: 'still-retired'; reason: 'merged' | 'deleted' | 'inconclusive' }
    | { status: 'error'; message: string }
  >;

  // --- Releases (workspace-self) ---------------------------------------
  /**
   * Append a new entry to `synced.releases.self.versions` and bump
   * `currentVersion`. The snapshot SHA is computed over the canonical
   * pre-publish workspace.json (plan §5.1). Throws on invalid semver or
   * duplicate version.
   */
  publishRelease: (args: PublishReleaseArgs) => Promise<{ commitSha?: string }>;
  /** Flip `deprecated: true` on a published version. */
  deprecateRelease: (version: string) => void;
  /** Flip `yanked: true` on a published version. Soft destructive. */
  yankRelease: (version: string) => void;

  /**
   * Create a Git tag on the connected repo's base branch (`main` or the
   * configured default), pointing at the base branch's current HEAD.
   *
   * Decoupled from `publishRelease` — release publishing only writes the
   * workspace ledger and pushes to the working branch. Tagging happens
   * later, against `main`, once the ledger entry has been merged. This
   * keeps tags from ever pointing at unmerged working-branch commits.
   *
   * Honors `override: true` to delete + recreate an existing tag.
   * Without `override` and an existing same-named tag, throws so the UI
   * can surface a confirmation toggle. Optionally creates a matching
   * GitHub Release.
   */
  tagReleaseVersion: (args: {
    version: string;
    notes?: string;
    createGitHubRelease?: boolean;
    override?: boolean;
  }) => Promise<{ tagRef: string; sha: string; releaseUrl?: string }>;

  /**
   * Read the current set of GitHub topics on the connected repo. Topics
   * power marketplace discoverability — public API Circle workspaces
   * include `apicircle` plus user-chosen category topics.
   */
  listRepoTopics: () => Promise<string[]>;
  /**
   * Replace the connected repo's topic list. GitHub's PUT /topics is a
   * full replace, so callers pass the complete desired list. Returns
   * the persisted list.
   */
  setRepoTopics: (topics: string[]) => Promise<string[]>;
  /**
   * Fetch the latest published release version from `main`'s
   * `workspace.json` that doesn't yet have a matching Git tag. Used by
   * the Release & topics modal to populate the version field. Returns
   * `null` when every published version is already tagged or no
   * versions exist.
   */
  loadLatestUntaggedRelease: () => Promise<{
    version: string;
    notes: string;
    existingTagSha: string | null;
  } | null>;

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
    /**
     * Which session credentials this link uses for source fetches.
     * Defaults to `'workspace'` (reuses the workspace session). Pass
     * `'dedicated'` together with `linkSessionToken` to bind a separate
     * PAT to this specific link — required when the source repo isn't
     * reachable from the workspace session's account.
     */
    sessionMode?: 'workspace' | 'dedicated';
    linkSessionToken?: string;
    /**
     * Optional plaintext values for the source's required secret-key
     * slots, keyed by `secretKeyId`. The link wizard collects these so
     * users can supply values at link-time instead of having to scroll
     * down on the link card after the link lands. Empty values are
     * skipped — the slot stays "missing" until provisioned later.
     */
    secretValues?: Record<string, string>;
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
    sessionMode?: 'workspace' | 'dedicated';
    linkSessionToken?: string;
    marketplace?: { listedAs: string; tags: string[]; summary: string };
    secretValues?: Record<string, string>;
  }) => Promise<LinkedWorkspace>;

  /**
   * Add or rotate the dedicated linking session bound to a given link.
   * Verifies the token, encrypts it under the local master key, and
   * stores it under `local.sessions.github.links[linkedWorkspaceId]`.
   * Also flips `link.source.sessionMode` to `'dedicated'`. Returns the
   * resolved session metadata (login, scopes, etc).
   */
  addLinkSession: (linkedWorkspaceId: string, token: string) => Promise<GitHubSession>;

  /**
   * Drop the dedicated session for a link. The link's `sessionMode` is
   * NOT auto-flipped to `'workspace'` — that's a user choice. Instead,
   * the link card reports "session removed — remap" so the user can
   * either pick `'workspace'` mode or re-add a dedicated session.
   * Idempotent: no-op when the link has no dedicated session.
   */
  removeLinkSession: (linkedWorkspaceId: string) => Promise<void>;

  /**
   * Switch a link between sessionMode `'workspace'` and `'dedicated'`.
   * Switching to `'dedicated'` requires a session to already exist
   * under that link id (use `addLinkSession` first). Switching to
   * `'workspace'` does not delete any existing dedicated session —
   * it stays under the link id, available for re-binding later.
   */
  setLinkSessionMode: (linkedWorkspaceId: string, mode: 'workspace' | 'dedicated') => Promise<void>;

  /**
   * List repositories accessible to a GitHub session. Defaults to the
   * workspace session. Pass `tokenOverride` to use a dedicated linking
   * PAT mid-link-wizard before the per-link session has been persisted —
   * lets the repo browser surface repos that only the dedicated session
   * can reach.
   */
  listAccessibleRepos: (opts?: { tokenOverride?: string }) => Promise<GitHubRepo[]>;

  /**
   * List branches on a repo. Defaults to the workspace session;
   * `tokenOverride` lets the link wizard reuse the in-progress dedicated
   * PAT for the same reason as `listAccessibleRepos`.
   */
  listRepoBranches: (
    owner: string,
    name: string,
    opts?: { tokenOverride?: string },
  ) => Promise<GitHubBranch[]>;

  /**
   * Probe a candidate source repo's `workspace.json` for its
   * published-version list. Defaults to the workspace session; the
   * link wizard supplies `tokenOverride` when binding a dedicated
   * session so the probe runs through the right credentials.
   *
   * `repoFullName` (`owner/name`) is echoed back so the wizard can show
   * the source identity; the workspace's display name itself is no
   * longer carried in the synced doc.
   */
  probeLinkedRepoVersions: (
    owner: string,
    name: string,
    branch: string,
    opts?: { tokenOverride?: string },
  ) => Promise<{
    repoFullName: string;
    versions: string[];
    currentVersion: string | null;
    /**
     * Slot metadata the source declares AND is actually referenced by at
     * least one encrypted env variable. Surfaced by the link wizard so
     * users can pre-fill values at link-time. Slots declared but unused
     * are filtered out — no point asking for values nothing depends on.
     */
    requiredSecretKeys: SecretKeyMeta[];
  } | null>;

  /**
   * Search GitHub for public API Circle workspaces — repos tagged
   * `topic:apicircle` — narrowed by the user-supplied query. Returns at
   * most 30 results.
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
  setPlanEnvPriority: (planId: string, priorityOrder: readonly EnvPriorityRef[]) => void;
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
  /**
   * Abort the in-flight execution for `requestId`. No-op when nothing is
   * running for that request. The aborted execution settles with an
   * `error` of "Request aborted." in `lastRun`, so the response viewer
   * shows the cancellation state instead of looking frozen.
   */
  cancelExecuteRequest: (requestId: string) => void;
  /**
   * Abort the in-flight plan run for `planId`. The plan finalizes with the
   * steps that already completed and an "aborted" marker on the partial
   * results. Subsequent steps are not started.
   */
  cancelExecutePlan: (planId: string) => void;
  /**
   * Re-run a single step of a plan in isolation. Used by the per-step
   * "Retry" affordance in PlanRunDetails so the user doesn't have to
   * re-execute the entire plan when a single step failed transiently.
   * Returns the new ExecutionResult for the step. No-op when the plan
   * or step can't be resolved (returns null).
   */
  retryPlanStep: (planId: string, stepIndex: number) => Promise<void>;
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
  toasts: [],
  pushToast: (toast) => {
    const id = generateId();
    set((s) => ({ toasts: [...s.toasts, { ...toast, id }] }));
    return id;
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  secretKey: null,
  secretLockState: 'unset',
  lastSecretActivityAt: null,
  passphraseModal: null,

  openPassphraseSetup: () => {
    if (get().synced?.secretCrypto) return;
    set({ passphraseModal: 'setup' });
  },
  openPassphraseUnlock: () => {
    const s = get();
    if (!s.synced?.secretCrypto) return;
    if (s.secretLockState === 'unlocked') return;
    set({ passphraseModal: 'unlock' });
  },
  closePassphraseModal: () => set({ passphraseModal: null }),

  setupPassphrase: async (passphrase) => {
    const synced = get().synced;
    if (!synced) return { ok: false, reason: 'Workspace not ready' };
    if (synced.secretCrypto) {
      // Already set up — caller should be using unlockWithPassphrase.
      return { ok: false, reason: 'Workspace already has a passphrase set.' };
    }
    try {
      const { crypto: blob, key } = await initSecretCrypto(passphrase);
      const next: WorkspaceSynced = { ...synced, secretCrypto: blob };
      set({
        synced: next,
        secretKey: key,
        secretLockState: 'unlocked',
        lastSecretActivityAt: Date.now(),
        passphraseModal: null,
      });
      await saveSynced(next);
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : 'Setup failed' };
    }
  },

  unlockWithPassphrase: async (passphrase) => {
    const synced = get().synced;
    if (!synced?.secretCrypto) {
      return { ok: false, reason: 'No passphrase has been set on this workspace yet.' };
    }
    const result = await unlockSecretCrypto(passphrase, synced.secretCrypto);
    if (!result.ok) return result;
    set({
      secretKey: result.key,
      secretLockState: 'unlocked',
      lastSecretActivityAt: Date.now(),
      passphraseModal: null,
    });
    return { ok: true };
  },

  lockSecrets: () => {
    const synced = get().synced;
    set({
      secretKey: null,
      secretLockState: synced?.secretCrypto ? 'locked' : 'unset',
      lastSecretActivityAt: null,
    });
  },

  noteSecretActivity: () => {
    if (get().secretLockState !== 'unlocked') return;
    set({ lastSecretActivityAt: Date.now() });
  },
  envDecryptFailures: [],
  clearEnvDecryptFailures: () => set({ envDecryptFailures: [] }),
  activePanel: readStoredPanel(),
  rightDock: { tab: null, mode: 'overlay', vaultSubtab: 'vault' },
  importModalOpen: false,
  editorPendingCreate: null,
  envAdding: false,
  helpQuery: '',
  helpSectionId: null,
  mcpActiveSection: 'connection',
  mcpHowToConnectClient: null,
  activeLinkedRequest: null,
  pendingRefresh: null,
  missingScopePrompt: null,
  attachmentDownloadPrompt: null,
  resolveAttachmentDownloadPrompt: (accepted) => {
    const prompt = get().attachmentDownloadPrompt;
    if (!prompt) return;
    set({ attachmentDownloadPrompt: null });
    prompt.resolve(accepted);
  },
  firstPullPrompt: null,
  acknowledgeFirstPull: () => set({ firstPullPrompt: null }),
  activePlanId: null,
  lastRun: {},
  lastPlanResults: {},
  isExecuting: {},
  envFocus: null,

  workspaceRegistry: null,

  hydrate: async () => {
    try {
      const { synced, local, registry } = await loadWorkspace();
      applyTheme(local.ui.themeId);
      applyFont(local.ui.fontId);
      applyFontSize(local.ui.fontSizePercent);
      const migrated = await migrateLegacyEncryptedEnvVars(synced);
      if (migrated !== synced) {
        try {
          await saveSynced(migrated);
        } catch (saveErr) {
          console.error('[workspace.hydrate] legacy env-var migration could not persist', saveErr);
        }
      }
      // Bridge IDB ↔ on-disk multi-workspace mirror. The desktop main
      // process owns `<root>/registry.json` + per-id subdirectories; on
      // web this is a no-op so the renderer can drive it unconditionally.
      //
      // Boot-time outcomes for the active workspace:
      //
      //   1. No bridge (web)               → no-op.
      //   2. Disk has a DIFFERENT workspaceId → one-time merge (legacy
      //      migration trail; IDB wins on collision).
      //   3. Disk has the SAME workspaceId AND disk is newer than IDB →
      //      adopt the disk doc. This is the path that catches MCP / CLI
      //      writes made while the desktop wasn't running; without this
      //      branch the boot-time IDB→disk write below would silently
      //      clobber them.
      //   4. Disk has the SAME workspaceId AND IDB is newer-or-equal →
      //      write IDB through to disk so the MCP / CLI see the same doc.
      //
      // Mirror also fans out every OTHER IDB-registered workspace through
      // its own disk write so multi-workspace state lives on disk from
      // the moment the desktop boots — not just on first edit per id.
      let finalSynced = migrated;
      const finalLocal = local;
      const mirror = getDiskMirror();
      // Whether the boot-time IDB→disk write below would overwrite a
      // newer on-disk doc. When true we skip the queued write so the
      // disk wins; the in-memory store still reflects disk so the user
      // sees the correct content immediately.
      let adoptedFromDisk = false;
      if (mirror.isAvailable()) {
        try {
          await mirror.init();
          const onDisk = await mirror.readWorkspace(migrated.workspaceId);
          if (onDisk && onDisk.synced.workspaceId !== migrated.workspaceId) {
            const { merged, importedRequestIds, importedFolderIds } = mergeSyncedFromDisk(
              migrated,
              onDisk.synced,
            );
            if (importedRequestIds.length + importedFolderIds.length > 0) {
              console.warn(
                `[workspace.hydrate] one-time disk merge: imported ${importedRequestIds.length} request(s) + ${importedFolderIds.length} folder(s) from on-disk workspace ${onDisk.synced.workspaceId}`,
              );
            }
            finalSynced = merged;
            try {
              await saveSynced(merged);
            } catch (saveErr) {
              console.error('[workspace.hydrate] disk-merge persist failed', saveErr);
              finalSynced = migrated;
            }
          } else if (onDisk && onDisk.synced.workspaceId === migrated.workspaceId) {
            // Same workspaceId — compare `meta.updatedAt`. If disk is
            // newer, an external writer (MCP server, CLI) updated the file
            // while the desktop was closed; adopt it instead of letting
            // the boot-time IDB→disk write overwrite their changes.
            const diskUpdatedAt = Date.parse(onDisk.synced.meta.updatedAt);
            const idbUpdatedAt = Date.parse(migrated.meta.updatedAt);
            if (Number.isFinite(diskUpdatedAt) && diskUpdatedAt > idbUpdatedAt) {
              console.warn(
                `[workspace.hydrate] disk newer than IDB for workspace ${migrated.workspaceId} (disk=${onDisk.synced.meta.updatedAt}, idb=${migrated.meta.updatedAt}) — adopting disk state`,
              );
              finalSynced = onDisk.synced;
              adoptedFromDisk = true;
              try {
                // Mirror disk → IDB so the next boot starts from the same
                // place even if the mirror is later disabled.
                await saveSynced(onDisk.synced);
              } catch (saveErr) {
                console.error(
                  '[workspace.hydrate] could not persist disk-adopted state to IDB',
                  saveErr,
                );
              }
            }
          }
          // Register every IDB workspace with the on-disk registry so the
          // CLI / MCP discover them. Idempotent — `registerWorkspace`
          // upserts. We do this BEFORE the initial write so the registry
          // is in lockstep before the first per-id pair lands.
          for (const w of registry.workspaces) {
            await mirror.registerWorkspace({
              id: w.id,
              name: w.name,
              createdAt: w.createdAt,
              lastOpenedAt: w.lastOpenedAt,
            });
          }
          await mirror.setActiveWorkspace(registry.activeWorkspaceId ?? migrated.workspaceId);
        } catch (mirrorErr) {
          // A disk-mirror failure must NEVER block hydration of the
          // IDB-backed UI. Log and continue with whatever IDB had.
          console.error('[workspace.hydrate] disk mirror init failed', mirrorErr);
        }
        // Seed the debounced-persist observer with the full pair so the
        // first mutation (which may only touch one half) still produces a
        // complete disk-mirror write. Skip the initial IDB→disk write
        // when we just adopted disk's newer content — re-writing it would
        // be a no-op at best, and a race-with-the-watcher trigger at
        // worst.
        primeObservedWorkspace(finalSynced, finalLocal);
        if (!adoptedFromDisk) {
          queueSaveBoth(finalSynced, finalLocal);
        }
      } else {
        primeObservedWorkspace(finalSynced, finalLocal);
      }
      set({
        ready: true,
        hydrationError: null,
        synced: finalSynced,
        local: finalLocal,
        workspaceRegistry: registry,
        // Derive the secret-lock state from the freshly-loaded workspace:
        // a workspace with `secretCrypto` boots `locked` (no key in memory
        // yet); one without is `unset`. The in-memory key never survives a
        // hydrate, so always clear it.
        secretKey: null,
        secretLockState: finalSynced.secretCrypto ? 'locked' : 'unset',
        lastSecretActivityAt: null,
      });
    } catch (err) {
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

  switchWorkspace: async (workspaceId) => {
    const registry = get().workspaceRegistry;
    if (!registry) throw new Error('Registry not loaded');
    if (workspaceId === registry.activeWorkspaceId) return;
    // Flush any pending writes for the OUTGOING workspace before switching,
    // otherwise a late-firing debounce would write the previous workspace's
    // in-memory state on top of the freshly-loaded incoming state. The
    // disk mirror also drains here so the on-disk file matches whatever
    // the outgoing workspace last queued before we overwrite it with the
    // incoming one's content below.
    await flushPendingPersist();
    const updatedRegistry = await setActiveWorkspacePersisted(registry, workspaceId);
    // Mirror the active-id flip to disk so CLI / MCP consumers (including
    // anything pointing at the workspaces root) observe the same active
    // workspace after the user switches in the UI. Best-effort — a disk
    // failure here must not block the IDB-backed switch.
    await getDiskMirror().setActiveWorkspace(workspaceId);
    const result = await loadWorkspaceById(workspaceId, updatedRegistry);
    applyTheme(result.local.ui.themeId);
    applyFont(result.local.ui.fontId);
    applyFontSize(result.local.ui.fontSizePercent);
    // Re-seed the disk-mirror observer with the incoming workspace's
    // full pair AND queue an immediate write so the on-disk file reflects
    // the new active workspace even before the user mutates anything.
    // No-op on web (mirror is unavailable).
    primeObservedWorkspace(result.synced, result.local);
    if (getDiskMirror().isAvailable()) {
      queueSaveBoth(result.synced, result.local);
    }
    set({
      ready: true,
      hydrationError: null,
      synced: result.synced,
      local: result.local,
      workspaceRegistry: result.registry,
      // The incoming workspace has its own secret-lock state — derive it
      // from `secretCrypto` and drop the outgoing workspace's in-memory key.
      secretKey: null,
      secretLockState: result.synced.secretCrypto ? 'locked' : 'unset',
      lastSecretActivityAt: null,
      // Reset transient panel state so the new workspace boots clean.
      pendingRefresh: null,
      activePlanId: null,
      lastRun: {},
      lastPlanResults: {},
      isExecuting: {},
      activeLinkedUpdate: null,
    });
  },

  createNewWorkspace: async (name) => {
    const registry = get().workspaceRegistry;
    if (!registry) throw new Error('Registry not loaded');
    const result = await createWorkspacePersisted(registry, name);
    applyTheme(result.local.ui.themeId);
    applyFont(result.local.ui.fontId);
    applyFontSize(result.local.ui.fontSizePercent);
    // Mirror the new workspace + registry entry to disk so CLI / MCP can
    // see it before the user makes any edit. Best-effort.
    const mirror = getDiskMirror();
    const created = result.registry.workspaces.find((w) => w.id === result.synced.workspaceId);
    if (mirror.isAvailable() && created) {
      await mirror.writeWorkspace({
        workspaceId: result.synced.workspaceId,
        synced: result.synced,
        local: result.local,
      });
      await mirror.registerWorkspace({
        id: created.id,
        name: created.name,
        createdAt: created.createdAt,
        lastOpenedAt: created.lastOpenedAt,
      });
      await mirror.setActiveWorkspace(result.synced.workspaceId);
    }
    primeObservedWorkspace(result.synced, result.local);
    set({
      ready: true,
      hydrationError: null,
      synced: result.synced,
      local: result.local,
      workspaceRegistry: result.registry,
      pendingRefresh: null,
      activePlanId: null,
      lastRun: {},
      lastPlanResults: {},
      isExecuting: {},
      activeLinkedUpdate: null,
    });
    return result.synced.workspaceId;
  },

  deleteWorkspaceById: async (workspaceId) => {
    const registry = get().workspaceRegistry;
    if (!registry) throw new Error('Registry not loaded');
    // Flush in case the workspace being deleted has pending writes — they'd
    // otherwise race the delete and resurrect a partial record.
    await flushPendingPersist();
    const result = await deleteWorkspacePersisted(registry, workspaceId);
    applyTheme(result.local.ui.themeId);
    applyFont(result.local.ui.fontId);
    applyFontSize(result.local.ui.fontSizePercent);
    // Mirror the delete to disk so the CLI / MCP stop seeing the workspace
    // immediately. Best-effort — a disk failure here doesn't roll back IDB.
    await getDiskMirror().deleteWorkspace(workspaceId);
    primeObservedWorkspace(result.synced, result.local);
    set({
      ready: true,
      hydrationError: null,
      synced: result.synced,
      local: result.local,
      workspaceRegistry: result.registry,
      pendingRefresh: null,
      activePlanId: null,
      lastRun: {},
      lastPlanResults: {},
      isExecuting: {},
      activeLinkedUpdate: null,
    });
  },

  resetWorkspace: async () => {
    const result = await resetWorkspaceStorage();
    applyTheme(result.local.ui.themeId);
    applyFont(result.local.ui.fontId);
    applyFontSize(result.local.ui.fontSizePercent);
    set({
      ready: true,
      hydrationError: null,
      synced: result.synced,
      local: result.local,
      workspaceRegistry: result.registry,
    });
  },

  recoverPartialWorkspace: async () => {
    const result = await recoverPartialWorkspace();
    if (!result) return 'no-data';
    applyTheme(result.local.ui.themeId);
    applyFont(result.local.ui.fontId);
    applyFontSize(result.local.ui.fontSizePercent);
    set({
      ready: true,
      hydrationError: null,
      synced: result.synced,
      local: result.local,
      workspaceRegistry: result.registry,
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
    queueSaveLocal(next);
    // Workspace + linked active are mutually exclusive in the editor —
    // setting one clears the other so the merged-view selector doesn't
    // get a confused "both set" state. (Setting id to null intentionally
    // doesn't touch the linked-active so back-button paths from a linked
    // request keep the linked context intact.)
    if (id !== null && get().activeLinkedRequest !== null) {
      set({ activeLinkedRequest: null });
    }
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
    queueSaveLocal(next);
  },

  setThemeId: (themeId) => {
    const local = get().local;
    if (!local) return;
    const next: WorkspaceLocal = { ...local, ui: { ...local.ui, themeId } };
    applyTheme(themeId);
    set({ local: next });
    queueSaveLocal(next);
  },

  setFontId: (fontId) => {
    const local = get().local;
    if (!local) return;
    const next: WorkspaceLocal = { ...local, ui: { ...local.ui, fontId } };
    applyFont(fontId);
    set({ local: next });
    queueSaveLocal(next);
  },

  setFontSizePercent: (percent) => {
    const local = get().local;
    if (!local) return;
    const clamped = clampFontSizePercent(percent);
    if (clamped === local.ui.fontSizePercent) return;
    const next: WorkspaceLocal = {
      ...local,
      ui: { ...local.ui, fontSizePercent: clamped },
    };
    applyFontSize(clamped);
    set({ local: next });
    queueSaveLocal(next);
  },

  setValidateOnSend: (value) => {
    const local = get().local;
    if (!local) return;
    const next: WorkspaceLocal = {
      ...local,
      settings: { ...local.settings, validateOnSend: value },
    };
    set({ local: next });
    queueSaveLocal(next);
  },

  setMonacoConsumesWheel: (value) => {
    const local = get().local;
    if (!local) return;
    const next: WorkspaceLocal = {
      ...local,
      settings: { ...local.settings, monacoConsumesWheel: value },
    };
    set({ local: next });
    queueSaveLocal(next);
  },

  captureSnapshot: (args) => {
    const synced = get().synced;
    const local = get().local;
    if (!synced || !local) return null;
    const result = coreApplyMutation(
      { synced, local },
      {
        kind: 'snapshot.capture',
        trigger: args?.trigger ?? 'manual',
        note: args?.note,
      },
    );
    set({ local: result.next.local });
    queueSaveLocal(result.next.local);
    // The first id in changedIds is the new snapshot's id; later entries
    // are evicted ids. Return the new snapshot id so callers can scroll
    // to it in the History panel.
    return result.changedIds[0] ?? null;
  },

  restoreSnapshot: (id) => {
    const synced = get().synced;
    const local = get().local;
    if (!synced || !local) return false;
    const result = coreApplyMutation({ synced, local }, { kind: 'snapshot.restore', id });
    if (result.changedIds.length === 0) return false;
    set({ synced: result.next.synced, local: result.next.local });
    queueSaveSynced(result.next.synced);
    queueSaveLocal(result.next.local);
    return true;
  },

  deleteSnapshot: (id) => {
    const synced = get().synced;
    const local = get().local;
    if (!synced || !local) return;
    const result = coreApplyMutation({ synced, local }, { kind: 'snapshot.delete', id });
    if (result.changedIds.length === 0) return;
    set({ local: result.next.local });
    queueSaveLocal(result.next.local);
  },

  setSnapshotMaxBytes: (maxBytes) => {
    const synced = get().synced;
    const local = get().local;
    if (!synced || !local) return;
    const result = coreApplyMutation(
      { synced, local },
      { kind: 'snapshot.set_max_bytes', maxBytes },
    );
    set({ local: result.next.local });
    queueSaveLocal(result.next.local);
  },

  setWorkspaceName: (name) => {
    const registry = get().workspaceRegistry;
    const activeId = registry?.activeWorkspaceId ?? get().synced?.workspaceId ?? null;
    if (!registry || !activeId) return;
    // The registry is the single source of truth for the workspace's
    // display name — git never sees it. Reflect the rename in-memory so
    // the switcher / TopBar update synchronously; the IDB write below
    // is fire-and-forget on the latest in-memory state. We deliberately
    // do NOT round-trip the persisted result back into store state:
    // typing fires this action on every keystroke, and async writes can
    // resolve out of order, so the last in-memory state always wins.
    const optimistic: WorkspaceRegistry = {
      ...registry,
      workspaces: registry.workspaces.map((w) => (w.id === activeId ? { ...w, name } : w)),
    };
    set({ workspaceRegistry: optimistic });
    // Persist only when the name is a non-empty non-clashing string.
    // The action fires on every keystroke, so a transient empty input
    // or a typed-in collision should NOT throw — it should just skip
    // the IDB write. The optimistic in-memory state above keeps the
    // input field consistent with what the user typed; the next valid
    // keystroke will flush.
    const trimmed = name.trim();
    if (!trimmed) return;
    const trimmedLower = trimmed.toLowerCase();
    const clash = optimistic.workspaces.some(
      (w) => w.id !== activeId && w.name.toLowerCase() === trimmedLower,
    );
    if (clash) return;
    updateRegistryEntryNamePersisted(optimistic, activeId, name).catch((err) => {
      console.error('[workspace.setWorkspaceName] persist failed', err);
    });
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
    queueSaveSynced(nextSynced);
  },

  createMockServer: ({ name, source }) => {
    const synced = get().synced;
    if (!synced) throw new Error('Workspace not ready');
    const trimmed = name.trim();
    if (!trimmed) throw new Error('Mock server name is required');
    const collision = Object.values(synced.mockServers).some(
      (m) => m.name.trim().toLowerCase() === trimmed.toLowerCase(),
    );
    if (collision) throw new Error(`A mock named "${trimmed}" already exists`);
    const id = generateId();
    // Manual-mode mocks carry their endpoints inline. Spec-blob mocks
    // store the raw text and defer parsing to the runtime (Desktop or
    // CLI), so the web app can create them without a Node-side parser.
    const endpoints = source.kind === 'manual' ? source.endpoints : [];
    const now = new Date().toISOString();
    const newServer = {
      id,
      name: trimmed,
      source,
      endpoints,
      defaultPort: null,
      cors: { enabled: false, origins: [] as string[] },
      createdAt: now,
      updatedAt: now,
    };
    const nextSynced: WorkspaceSynced = {
      ...synced,
      mockServers: { ...synced.mockServers, [id]: newServer },
      meta: { ...synced.meta, updatedAt: now },
    };
    set({ synced: nextSynced });
    queueSaveSynced(nextSynced);
    return id;
  },

  setMockServerName: (id, name) => {
    const synced = get().synced;
    if (!synced) return;
    const existing = synced.mockServers[id];
    if (!existing) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    const now = new Date().toISOString();
    const next = { ...existing, name: trimmed, updatedAt: now };
    const nextSynced: WorkspaceSynced = {
      ...synced,
      mockServers: { ...synced.mockServers, [id]: next },
      meta: { ...synced.meta, updatedAt: now },
    };
    set({ synced: nextSynced });
    queueSaveSynced(nextSynced);
  },

  setMockServerCors: (id, cors) => {
    const synced = get().synced;
    if (!synced) return;
    const existing = synced.mockServers[id];
    if (!existing) return;
    // Defensive: trim/dedupe origins so the saved shape stays canonical and
    // empty strings don't sneak through and trip the runtime's allow-list.
    const origins = Array.from(
      new Set(cors.origins.map((o) => o.trim()).filter((o) => o.length > 0)),
    );
    const now = new Date().toISOString();
    const next = {
      ...existing,
      cors: { enabled: cors.enabled, origins },
      updatedAt: now,
    };
    const nextSynced: WorkspaceSynced = {
      ...synced,
      mockServers: { ...synced.mockServers, [id]: next },
      meta: { ...synced.meta, updatedAt: now },
    };
    set({ synced: nextSynced });
    queueSaveSynced(nextSynced);
  },

  setMockServerEndpoints: (id, endpoints) => {
    const synced = get().synced;
    if (!synced) return;
    const existing = synced.mockServers[id];
    if (!existing) return;
    const now = new Date().toISOString();
    // For manual-mode mocks, mirror the new endpoints into the source
    // union so the runtime sees the same array regardless of which
    // field it reads.
    const source =
      existing.source.kind === 'manual' ? { kind: 'manual' as const, endpoints } : existing.source;
    const next = { ...existing, source, endpoints, updatedAt: now };
    const nextSynced: WorkspaceSynced = {
      ...synced,
      mockServers: { ...synced.mockServers, [id]: next },
      meta: { ...synced.meta, updatedAt: now },
    };
    set({ synced: nextSynced });
    queueSaveSynced(nextSynced);
  },

  addMockEndpoint: (serverId) => {
    const synced = get().synced;
    if (!synced) return '';
    const existing = synced.mockServers[serverId];
    if (!existing) return '';
    const id = generateId();
    const newEndpoint: MockEndpoint = {
      id,
      name: 'New endpoint',
      method: 'GET',
      pathPattern: '/path',
      requestSchema: { pathParams: [], queryParams: [], headers: [], cookies: [] },
      requestValidation: [],
      responseRules: [],
      defaultResponse: {
        status: 200,
        headers: [{ key: 'Content-Type', value: 'application/json', enabled: true }],
        body: { type: 'json', content: '{\n  "ok": true\n}' },
      },
    };
    const nextEndpoints = [...existing.endpoints, newEndpoint];
    const source =
      existing.source.kind === 'manual'
        ? { kind: 'manual' as const, endpoints: nextEndpoints }
        : existing.source;
    const now = new Date().toISOString();
    const nextSynced: WorkspaceSynced = {
      ...synced,
      mockServers: {
        ...synced.mockServers,
        [serverId]: { ...existing, source, endpoints: nextEndpoints, updatedAt: now },
      },
      meta: { ...synced.meta, updatedAt: now },
    };
    set({ synced: nextSynced, activeMockServerId: serverId, activeMockEndpointId: id });
    queueSaveSynced(nextSynced);
    return id;
  },

  updateMockEndpoint: (serverId, endpointId, patch) => {
    const synced = get().synced;
    if (!synced) return;
    const existing = synced.mockServers[serverId];
    if (!existing) return;
    const idx = existing.endpoints.findIndex((e) => e.id === endpointId);
    if (idx === -1) return;
    const nextEndpoint = { ...existing.endpoints[idx], ...patch };
    const nextEndpoints = [...existing.endpoints];
    nextEndpoints[idx] = nextEndpoint;
    const source =
      existing.source.kind === 'manual'
        ? { kind: 'manual' as const, endpoints: nextEndpoints }
        : existing.source;
    const now = new Date().toISOString();
    const nextSynced: WorkspaceSynced = {
      ...synced,
      mockServers: {
        ...synced.mockServers,
        [serverId]: { ...existing, source, endpoints: nextEndpoints, updatedAt: now },
      },
      meta: { ...synced.meta, updatedAt: now },
    };
    set({ synced: nextSynced });
    queueSaveSynced(nextSynced);
  },

  removeMockEndpoint: (serverId, endpointId) => {
    const synced = get().synced;
    if (!synced) return;
    const existing = synced.mockServers[serverId];
    if (!existing) return;
    const nextEndpoints = existing.endpoints.filter((e) => e.id !== endpointId);
    const source =
      existing.source.kind === 'manual'
        ? { kind: 'manual' as const, endpoints: nextEndpoints }
        : existing.source;
    const now = new Date().toISOString();
    const nextSynced: WorkspaceSynced = {
      ...synced,
      mockServers: {
        ...synced.mockServers,
        [serverId]: { ...existing, source, endpoints: nextEndpoints, updatedAt: now },
      },
      meta: { ...synced.meta, updatedAt: now },
    };
    const nextActive =
      get().activeMockEndpointId === endpointId ? { activeMockEndpointId: null } : {};
    set({ synced: nextSynced, ...nextActive });
    queueSaveSynced(nextSynced);
  },

  duplicateMockServer: (id) => {
    const synced = get().synced;
    if (!synced) return null;
    const { synced: nextSynced, server } = duplicateMockServerAction(synced, id);
    if (!server) return null;
    set({ synced: nextSynced, activeMockServerId: server.id, activeMockEndpointId: null });
    queueSaveSynced(nextSynced);
    return server.id;
  },

  duplicateMockEndpoint: (serverId, endpointId) => {
    const synced = get().synced;
    if (!synced) return null;
    const { synced: nextSynced, endpoint } = duplicateMockEndpointAction(
      synced,
      serverId,
      endpointId,
    );
    if (!endpoint) return null;
    set({ synced: nextSynced, activeMockServerId: serverId, activeMockEndpointId: endpoint.id });
    queueSaveSynced(nextSynced);
    return endpoint.id;
  },

  activeMockServerId: null,
  activeMockEndpointId: null,
  setActiveMockEndpoint: ({ serverId, endpointId }) => {
    set({ activeMockServerId: serverId, activeMockEndpointId: endpointId });
  },

  mocksCreateModalOpen: false,
  openMocksCreateModal: () => set({ mocksCreateModalOpen: true }),
  closeMocksCreateModal: () => set({ mocksCreateModalOpen: false }),

  attachMockResponseFile: async (serverId, endpointId, file) => {
    enforceAttachmentSize(file);
    const synced = get().synced;
    if (!synced) throw new Error('Workspace not ready');
    const server = synced.mockServers[serverId];
    if (!server) throw new Error(`Mock server ${serverId} not found`);
    const endpoint = server.endpoints.find((e) => e.id === endpointId);
    if (!endpoint) throw new Error(`Endpoint ${endpointId} not found`);
    const previousSlot =
      endpoint.defaultResponse.body.type === 'binary' &&
      !endpoint.defaultResponse.body.attachment?.globalFileAssetId
        ? (endpoint.defaultResponse.body.attachment?.slotId ?? null)
        : null;
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
    const nextBody: MockResponseBody = {
      type: 'binary',
      content: '',
      attachment: ref,
    };
    get().updateMockEndpoint(serverId, endpointId, {
      defaultResponse: { ...endpoint.defaultResponse, body: nextBody },
    });
    if (previousSlot) await deleteAttachment(previousSlot);
    return ref;
  },

  setMockResponseGlobalFileAsset: async (serverId, endpointId, fileAssetId) => {
    const synced = get().synced;
    if (!synced) throw new Error('Workspace not ready');
    const server = synced.mockServers[serverId];
    if (!server) throw new Error(`Mock server ${serverId} not found`);
    const endpoint = server.endpoints.find((e) => e.id === endpointId);
    if (!endpoint) throw new Error(`Endpoint ${endpointId} not found`);
    const previousSlot =
      endpoint.defaultResponse.body.type === 'binary' &&
      !endpoint.defaultResponse.body.attachment?.globalFileAssetId
        ? (endpoint.defaultResponse.body.attachment?.slotId ?? null)
        : null;
    const asset = fileAssetId ? synced.globalAssets.files?.[fileAssetId] : null;
    const nextBody: MockResponseBody = asset
      ? { type: 'binary', content: '', attachment: attachmentRefFromGlobalFileAsset(asset) }
      : { type: 'binary', content: '' };
    get().updateMockEndpoint(serverId, endpointId, {
      defaultResponse: { ...endpoint.defaultResponse, body: nextBody },
    });
    if (previousSlot && !isGlobalFileSlot(synced, previousSlot))
      await deleteAttachment(previousSlot);
  },

  detachMockResponseFile: async (serverId, endpointId) => {
    const synced = get().synced;
    if (!synced) return;
    const server = synced.mockServers[serverId];
    if (!server) return;
    const endpoint = server.endpoints.find((e) => e.id === endpointId);
    if (!endpoint || endpoint.defaultResponse.body.type !== 'binary') return;
    const previousSlot = endpoint.defaultResponse.body.attachment?.globalFileAssetId
      ? null
      : (endpoint.defaultResponse.body.attachment?.slotId ?? null);
    const nextBody: MockResponseBody = {
      type: 'binary',
      content: '',
    };
    get().updateMockEndpoint(serverId, endpointId, {
      defaultResponse: { ...endpoint.defaultResponse, body: nextBody },
    });
    if (previousSlot) await deleteAttachment(previousSlot);
  },

  openRightDockTab: (tab, opts) =>
    set((s) => ({
      rightDock: {
        ...s.rightDock,
        tab,
        // Update the sub-tab when caller asks for one. Otherwise keep
        // the existing value — the user's manual sub-tab pick during
        // a session shouldn't get clobbered by re-opening the dock.
        ...(opts?.vaultSubtab ? { vaultSubtab: opts.vaultSubtab } : {}),
      },
    })),
  closeRightDock: () => set((s) => ({ rightDock: { ...s.rightDock, tab: null } })),
  setRightDockTab: (tab) =>
    set((s) => (s.rightDock.tab === null ? s : { rightDock: { ...s.rightDock, tab } })),
  setVaultSubtab: (subtab) => set((s) => ({ rightDock: { ...s.rightDock, vaultSubtab: subtab } })),
  toggleRightDockTab: (tab) =>
    set((s) => ({
      rightDock: { ...s.rightDock, tab: s.rightDock.tab === tab ? null : tab },
    })),
  setRightDockMode: (mode) => set((s) => ({ rightDock: { ...s.rightDock, mode } })),

  surfaceMissingScope: (scopes) => set({ missingScopePrompt: scopes }),
  dismissMissingScope: () => set({ missingScopePrompt: null }),

  addRequest: (parentFolderId, name) => {
    const synced = get().synced;
    if (!synced) return '';
    const { synced: nextSynced, request } = addRequestAction(synced, parentFolderId, name);
    set({ synced: nextSynced });
    queueSaveSynced(nextSynced);
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
    queueSaveSynced(seeded);
    get().setActiveRequestId(request.id);
    return { id: request.id, warnings: parsed.warnings };
  },

  addFolder: (parentFolderId, name) => {
    const synced = get().synced;
    if (!synced) return '';
    const { synced: nextSynced, folder } = addFolderAction(synced, parentFolderId, name);
    set({ synced: nextSynced });
    queueSaveSynced(nextSynced);
    return folder.id;
  },

  duplicateRequest: (id) => {
    const synced = get().synced;
    if (!synced) return null;
    const { synced: nextSynced, request } = duplicateRequestAction(synced, id);
    if (!request) return null;
    set({ synced: nextSynced });
    queueSaveSynced(nextSynced);
    // Drop the user into the duplicate so they can immediately edit.
    get().setActiveRequestId(request.id);
    return request.id;
  },

  duplicateFolder: (id) => {
    const synced = get().synced;
    if (!synced) return null;
    const { synced: nextSynced, folder } = duplicateFolderAction(synced, id);
    if (!folder) return null;
    set({ synced: nextSynced });
    queueSaveSynced(nextSynced);
    return folder.id;
  },

  removeFolder: (id) => {
    const synced = get().synced;
    if (!synced) return;
    const { synced: next, deletedRequestIds } = removeFolderAction(synced, id);
    if (next === synced) return;
    set({ synced: next });
    queueSaveSynced(next);
    // Free attachments of every cascaded request, mirroring removeRequest.
    const slotIds: string[] = [];
    for (const rid of deletedRequestIds) {
      const original = synced.collections.requests[rid];
      if (original) slotIds.push(...collectRequestSlotIds(original));
    }
    const ownedSlotIds = slotIds.filter((slotId) => !isGlobalFileSlot(synced, slotId));
    if (ownedSlotIds.length > 0) void deleteManyAttachments(ownedSlotIds);
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
    queueSaveSynced(next);
    if (existing) {
      const slotIds = collectRequestSlotIds(existing).filter(
        (slotId) => !isGlobalFileSlot(synced, slotId),
      );
      if (slotIds.length > 0) void deleteManyAttachments(slotIds);
    }
    if (get().local?.ui.activeRequestId === id) get().setActiveRequestId(null);
  },

  renameRequest: (id, name) => {
    if (routeLinkedField(get, set, id, 'name', name)) return;
    commitSynced(set, get, (s) => renameRequestAction(s, id, name));
  },
  renameFolder: (id, name) => commitSynced(set, get, (s) => renameFolderAction(s, id, name)),
  setRequestMethod: (id, method) => {
    if (routeLinkedField(get, set, id, 'method', method)) return;
    commitSynced(set, get, (s) => setRequestMethodAction(s, id, method));
  },
  setRequestUrl: (id, url) => {
    if (routeLinkedField(get, set, id, 'url', url)) return;
    commitSynced(set, get, (s) => setRequestUrlAction(s, id, url));
  },
  setRequestBody: (id, body) => {
    if (routeLinkedField(get, set, id, 'body', body)) return;
    commitSynced(set, get, (s) => setRequestBodyAction(s, id, body));
  },
  setRequestHeaders: (id, headers) => {
    if (routeLinkedField(get, set, id, 'headers', headers)) return;
    commitSynced(set, get, (s) => setRequestHeadersAction(s, id, headers));
  },
  setRequestQuery: (id, query) => {
    if (routeLinkedField(get, set, id, 'query', query)) return;
    commitSynced(set, get, (s) => setRequestQueryAction(s, id, query));
  },
  setRequestPathParams: (id, pathParams) => {
    if (routeLinkedField(get, set, id, 'pathParams', pathParams)) return;
    commitSynced(set, get, (s) => setRequestPathParamsAction(s, id, pathParams));
  },
  setRequestCookies: (id, cookies) => {
    if (routeLinkedField(get, set, id, 'cookies', cookies)) return;
    commitSynced(set, get, (s) => setRequestCookiesAction(s, id, cookies));
  },
  setRequestAssertions: (id, assertions) => {
    if (routeLinkedField(get, set, id, 'assertions', assertions)) return;
    commitSynced(set, get, (s) => setRequestAssertionsAction(s, id, assertions));
  },
  setRequestAuth: (id, auth) => {
    if (routeLinkedField(get, set, id, 'auth', auth)) return;
    commitSynced(set, get, (s) => setRequestAuthAction(s, id, auth));
  },
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

    // Final meta bump — the inline `cur = { ...cur, collections: ... }`
    // patches above don't touch meta, so without this the import would
    // leave the workspace-level timestamp at whatever the last
    // `addRequestAction` set (close, but not necessarily the final
    // moment of the import).
    const stamped: WorkspaceSynced = {
      ...cur,
      meta: { ...cur.meta, updatedAt: new Date().toISOString() },
    };
    set({ synced: stamped });
    queueSaveSynced(stamped);
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
  importApicircleEnvironment: (parsed) => {
    const state = get();
    if (!state.synced) return null;
    const { name, variables, encryptedBindingHints, payloadVersion, warnings } = parsed;
    const existing = state.synced.environments.items;
    let finalName = name;
    let n = 2;
    while (existing[finalName]) {
      finalName = `${name} (${n})`;
      n += 1;
    }

    // Resolve every encrypted hint against the destination's vault.
    //
    // The resolution rules split on whether the source carried ciphertext
    // (v2) or only metadata (v1):
    //
    //   v2 — ciphertext + per-slot salt are on the wire. The row lands
    //   encrypted, pointing at a destination slot whose salt matches the
    //   source's so AES-GCM can decrypt with the local slot plaintext.
    //   When no destination slot has the right salt, we register a new
    //   slot using the source's salt + label so the binding is
    //   self-consistent. The user is then asked to provide the matching
    //   plaintext value via the missing-slots gate (same flow as a fresh
    //   Git pull). No pendingBinding is needed — the ciphertext is the
    //   value; the slot value is the missing piece.
    //
    //   v1 — only metadata. The row lands with `value: ''` and we
    //   surface a pendingBinding for the import modal to prompt the
    //   user for a fresh plaintext to encrypt under the destination's
    //   slot. Existing label-match / origin-id-reuse behavior preserved.
    const destSlots = state.synced.secretKeys ?? {};
    const labelToSlotId = new Map<string, string>();
    for (const slot of Object.values(destSlots)) {
      // First slot to claim a label wins — deterministic and matches the
      // env-panel label-picker (which lists each slot once).
      if (!labelToSlotId.has(slot.label)) labelToSlotId.set(slot.label, slot.id);
    }

    const resolvedVariables: typeof variables = [];
    const pendingBindings: ApicircleEnvironmentPendingBinding[] = [];
    // Slots minted on the fly for v2 rows whose source slot doesn't have a
    // destination counterpart. Accumulated here and merged into
    // synced.secretKeys at the end so we hit IDB once.
    const mintedSlots: Record<string, SecretKeyMeta> = {};
    let hintCursor = 0;
    for (const v of variables) {
      if (!v.encrypted) {
        resolvedVariables.push(v);
        continue;
      }
      const hint = encryptedBindingHints[hintCursor];
      hintCursor += 1;

      // ---- v2 path: ciphertext + salt are present ----
      if (hint && hint.ciphertext && hint.salt) {
        // 1. Same-id reuse: only valid when the destination slot's salt
        //    matches the source's. Different salts = different derived
        //    keys → ciphertext will silently fail to decrypt. Better to
        //    register a fresh slot with the right salt than to land a
        //    binding that lies.
        if (hint.originSecretKeyId && destSlots[hint.originSecretKeyId]?.salt === hint.salt) {
          resolvedVariables.push({ ...v, secretKeyId: hint.originSecretKeyId });
          continue;
        }
        // 2. Label match with matching salt.
        const labelMatch = labelToSlotId.get(hint.label);
        if (labelMatch && destSlots[labelMatch]?.salt === hint.salt) {
          resolvedVariables.push({ ...v, secretKeyId: labelMatch });
          continue;
        }
        // 3. Mint a new slot using source's salt + label. Prefer source's
        //    id when it doesn't already collide; else generate a fresh id.
        const mintedId =
          hint.originSecretKeyId && !destSlots[hint.originSecretKeyId]
            ? hint.originSecretKeyId
            : generateId();
        mintedSlots[mintedId] = {
          id: mintedId,
          label: hint.label,
          salt: hint.salt,
          createdAt: new Date().toISOString(),
        };
        // Track for future hints in the same import — a second v2 row
        // bound to the same source slot should reuse the minted id.
        if (!labelToSlotId.has(hint.label)) labelToSlotId.set(hint.label, mintedId);
        resolvedVariables.push({ ...v, secretKeyId: mintedId });
        continue;
      }

      // ---- v1 path: no ciphertext to land, fall back to pendingBindings ----
      // 1. Same-workspace re-import: the source's id is also a slot here.
      if (hint?.originSecretKeyId && destSlots[hint.originSecretKeyId]) {
        resolvedVariables.push({ ...v, secretKeyId: hint.originSecretKeyId });
        continue;
      }
      // 2. Cross-workspace label match.
      if (hint?.label) {
        const matchId = labelToSlotId.get(hint.label);
        if (matchId) {
          resolvedVariables.push({ ...v, secretKeyId: matchId });
          continue;
        }
      }
      // 3. Unresolved — keep the source's id (so the env-panel chip
      //    renders something stable) and prompt the user.
      resolvedVariables.push(v);
      if (hint) {
        pendingBindings.push({
          envName: finalName,
          varKey: hint.varKey,
          label: hint.label,
          labelFromFallback: hint.labelFromFallback,
        });
      }
    }

    // Persist any v2-minted slots into synced.secretKeys BEFORE the
    // variables land — otherwise the resolver's first pass over the new
    // env would see secretKeyIds pointing at nothing. v2 mint creates
    // slot metadata only; the slot's plaintext value is the user's
    // responsibility via the missing-slots gate.
    if (Object.keys(mintedSlots).length > 0) {
      const baseSynced = get().synced!;
      const nextSynced: WorkspaceSynced = {
        ...baseSynced,
        secretKeys: { ...(baseSynced.secretKeys ?? {}), ...mintedSlots },
        meta: { ...baseSynced.meta, updatedAt: new Date().toISOString() },
      };
      set({ synced: nextSynced });
      queueSaveSynced(nextSynced);
    }

    // v2 with minted slots produces a quieter warning so the user knows
    // why the missing-slots gate is about to fire on this device. v1 had
    // no equivalent — pendingBindings already explained the gap.
    const augmentedWarnings = [...warnings];
    if (payloadVersion === 2 && Object.keys(mintedSlots).length > 0) {
      augmentedWarnings.push(
        `Imported ${Object.keys(mintedSlots).length} new Secret Vault slot(s) from the source workspace. Provide each value in the Vault dock to decrypt the imported variables.`,
      );
    }

    state.addEnvironment(finalName);
    state.setVariables(finalName, resolvedVariables);
    return { name: finalName, pendingBindings, warnings: augmentedWarnings };
  },
  buildFolderExport: (folderId) => {
    const synced = get().synced;
    if (!synced) return null;
    return collectFolderExport({ synced, folderId });
  },
  importApicircleFolder: (parsed, parentFolderId = null) => {
    const synced = get().synced;
    if (!synced) return null;
    const result = importApicircleFolderInto(synced, parsed, parentFolderId);
    set({ synced: result.synced });
    queueSaveSynced(result.synced);
    return result;
  },
  setRequestExtractions: (id, extractions) => {
    if (routeLinkedField(get, set, id, 'extractions', extractions)) return;
    commitSynced(set, get, (s) => setRequestExtractionsAction(s, id, extractions));
  },
  setRequestContextVars: (id, contextVars) => {
    if (routeLinkedField(get, set, id, 'contextVars', contextVars)) return;
    commitSynced(set, get, (s) => setRequestContextVarsAction(s, id, contextVars));
  },
  // bodySchemaId / graphqlSchemaId are NOT in RequestOverridePatch — by design
  // (linked requests share the source's globalAssets schema refs, so flipping
  // them on the consumer side would dangle). Editor disables these inputs on
  // linked requests; if a programmatic call slips through, we just drop it.
  setRequestBodySchemaId: (id, schemaId) => {
    if (isLinkedActive(get, id)) return;
    commitSynced(set, get, (s) => setRequestBodySchemaIdAction(s, id, schemaId));
  },
  setRequestGraphqlSchemaId: (id, schemaId) => {
    if (isLinkedActive(get, id)) return;
    commitSynced(set, get, (s) => setRequestGraphqlSchemaIdAction(s, id, schemaId));
  },

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
  addGlobalFileAsset: async (file, init) => {
    enforceAttachmentSize(file);
    const synced = get().synced;
    if (!synced) throw new Error('Workspace not ready');
    const slotId = generateId();
    const record = await createAttachmentFromFile(file, slotId);
    await putAttachment(record);
    const result = addGlobalFileAssetAction(synced, {
      name: init?.name ?? record.filename,
      description: init?.description,
      slotId,
      filename: record.filename,
      size: record.size,
      mimeType: record.mimeType,
      sha256: record.sha256,
    });
    commitSynced(set, get, () => result.synced);
    return result.file.id;
  },
  updateGlobalFileAsset: (id, patch) =>
    commitSynced(set, get, (s) => updateGlobalFileAssetAction(s, id, patch)),
  removeGlobalFileAsset: async (id) => {
    const synced = get().synced;
    const asset = synced?.globalAssets.files?.[id];
    if (!asset) return;
    commitSynced(set, get, (s) => removeGlobalFileAssetAction(s, id));
    await deleteAttachment(asset.slotId);
  },
  setFormRowGlobalFileAsset: async (requestId, rowIndex, fileAssetId) => {
    const synced = get().synced;
    if (!synced) return;
    const existing = synced.collections.requests[requestId];
    if (!existing || existing.body.type !== 'form-data' || !existing.body.formRows) return;
    const oldRow = existing.body.formRows[rowIndex];
    if (!oldRow || oldRow.kind !== 'file') return;
    const previousSlot = oldRow.globalFileAssetId ? null : oldRow.slotId;
    const asset = fileAssetId ? synced.globalAssets.files?.[fileAssetId] : null;
    const nextRow: FormDataRow = asset
      ? formDataRowFromGlobalFileAsset(oldRow, asset)
      : { kind: 'file', key: oldRow.key, enabled: oldRow.enabled, slotId: null };
    const nextRows = existing.body.formRows.map((r, i) => (i === rowIndex ? nextRow : r));
    const nextBody: RequestBody = { ...existing.body, formRows: nextRows };
    commitSynced(set, get, (s) => setRequestBodyAction(s, requestId, nextBody));
    if (previousSlot && !isGlobalFileSlot(synced, previousSlot))
      await deleteAttachment(previousSlot);
  },
  setBinaryGlobalFileAsset: async (requestId, fileAssetId) => {
    const synced = get().synced;
    if (!synced) return;
    const existing = synced.collections.requests[requestId];
    if (!existing) return;
    const previousSlot =
      existing.body.type === 'binary' && !existing.body.attachment?.globalFileAssetId
        ? (existing.body.attachment?.slotId ?? null)
        : null;
    const asset = fileAssetId ? synced.globalAssets.files?.[fileAssetId] : null;
    const nextBody: RequestBody = asset
      ? { type: 'binary', content: '', attachment: attachmentRefFromGlobalFileAsset(asset) }
      : { type: 'binary', content: '' };
    commitSynced(set, get, (s) => setRequestBodyAction(s, requestId, nextBody));
    if (previousSlot && !isGlobalFileSlot(synced, previousSlot))
      await deleteAttachment(previousSlot);
  },
  openImportModal: () => set({ importModalOpen: true }),
  closeImportModal: () => set({ importModalOpen: false }),
  setEditorPendingCreate: (value) => set({ editorPendingCreate: value }),
  setEnvAdding: (value) => set({ envAdding: value }),
  setHelpQuery: (value) => set({ helpQuery: value }),
  setHelpSectionId: (value) => set({ helpSectionId: value }),
  setMcpActiveSection: (value) => set({ mcpActiveSection: value }),
  setMcpHowToConnectClient: (value) => set({ mcpHowToConnectClient: value }),

  refreshFromDisk: async () => {
    const mirror = getDiskMirror();
    if (!mirror.isAvailable()) return { kind: 'no-mirror' };
    // Read disk BEFORE flushing pending writes. Flushing first would
    // race the on-disk file against in-memory state and silently
    // overwrite any external (MCP / CLI) writes that happened since
    // the desktop last persisted — exactly the bug this refresh is
    // meant to surface. Once we've read the file we know whether to
    // flush (memory is the source of truth) or to hydrate-from-disk
    // (an external writer is).
    const current = get().synced;
    const targetId = current?.workspaceId;
    if (!targetId) {
      // Hydration hasn't completed — there's no in-memory workspace to
      // compare against. Best-effort: if the registry has an active id,
      // hydrate from that; otherwise report no-file.
      const registry = await mirror.readRegistry();
      const activeId = registry?.activeWorkspaceId;
      if (!activeId) return { kind: 'no-file' };
      const onDisk = await mirror.readWorkspace(activeId);
      if (!onDisk) return { kind: 'no-file' };
      set({ synced: onDisk.synced, local: onDisk.local });
      primeObservedWorkspace(onDisk.synced, onDisk.local);
      return {
        kind: 'updated',
        importedAt: onDisk.synced.meta.updatedAt,
        counts: countsOf(onDisk.synced),
      };
    }
    let onDisk: { synced: WorkspaceSynced; local: WorkspaceLocal } | null;
    try {
      onDisk = await mirror.readWorkspace(targetId);
    } catch (err) {
      return { kind: 'error', message: err instanceof Error ? err.message : String(err) };
    }
    if (!onDisk) return { kind: 'no-file' };
    if (onDisk.synced.workspaceId !== current.workspaceId) {
      // Per-id read returned a doc with a different id — corrupted dir.
      // Treat as a one-time merge (IDB wins on collision) and re-write.
      const { merged, importedRequestIds, importedFolderIds } = mergeSyncedFromDisk(
        current,
        onDisk.synced,
      );
      const currentLocal = get().local;
      if (currentLocal) {
        set({ synced: merged });
        primeObservedWorkspace(merged, currentLocal);
        queueSaveBoth(merged, currentLocal);
      }
      return {
        kind: 'merged',
        importedRequestIds,
        importedFolderIds,
        counts: countsOf(merged),
      };
    }
    // Same workspaceId — compare timestamps. Disk newer means CLI / MCP
    // wrote since the desktop last persisted; pull it in.
    const diskUpdatedAt = Date.parse(onDisk.synced.meta.updatedAt);
    const memUpdatedAt = Date.parse(current.meta.updatedAt);
    if (Number.isFinite(diskUpdatedAt) && diskUpdatedAt > memUpdatedAt) {
      const currentLocal = get().local;
      const nextLocal = currentLocal ?? onDisk.local;
      set({ synced: onDisk.synced, local: nextLocal });
      primeObservedWorkspace(onDisk.synced, nextLocal);
      // Persist the adopted doc to IDB so the next hydrate doesn't
      // re-do the disk-vs-IDB compare and re-import. Without this,
      // IDB stays at the pre-refresh state until the user's next
      // mutation flushes through the debounced persister — a window
      // where a crash would lose the freshly-adopted content.
      try {
        await saveSynced(onDisk.synced);
      } catch (err) {
        console.error('[workspace.refreshFromDisk] could not persist adopted state to IDB', err);
      }
      return {
        kind: 'updated',
        importedAt: onDisk.synced.meta.updatedAt,
        counts: countsOf(onDisk.synced),
      };
    }
    // Memory is the source of truth (or matches disk exactly). Drain any
    // pending writes so the disk file reflects whatever the store just
    // queued — safe now because we've already verified disk isn't ahead.
    try {
      await flushPendingPersist();
    } catch {
      /* the write path logs its own errors; press on */
    }
    return { kind: 'up-to-date', counts: countsOf(current) };
  },

  refreshRegistryFromDisk: async () => {
    const mirror = getDiskMirror();
    if (!mirror.isAvailable()) return { kind: 'no-mirror' };
    const fromDisk = await mirror.readRegistry();
    if (!fromDisk) {
      // Empty disk is treated as "no new workspaces" — no point in
      // overwriting the in-memory registry with nothing.
      return { kind: 'updated', added: 0 };
    }
    const current = get().workspaceRegistry;
    const currentIds = new Set(current?.workspaces.map((w) => w.id) ?? []);
    let added = 0;
    for (const w of fromDisk.workspaces) {
      if (!currentIds.has(w.id)) added++;
    }
    set({ workspaceRegistry: fromDisk });
    return { kind: 'updated', added };
  },

  setLinkedRequestOverride: (linkedWorkspaceId, itemId, patch) => {
    const key = `${linkedWorkspaceId}:${itemId}`;
    // An empty patch is a no-op as overrides go — clear instead so the
    // consumer's diff is clean (no zero-content rows in workspace.json).
    if (Object.keys(patch).length === 0) {
      get().clearLinkedRequestOverride(linkedWorkspaceId, itemId);
      return;
    }
    commitSynced(set, get, (synced) => ({
      ...synced,
      linkedOverrides: {
        ...synced.linkedOverrides,
        requests: {
          ...synced.linkedOverrides.requests,
          [key]: {
            linkedWorkspaceId,
            itemId,
            patch,
            updatedAt: new Date().toISOString(),
          },
        },
      },
    }));
  },
  clearLinkedRequestOverride: (linkedWorkspaceId, itemId) => {
    const key = `${linkedWorkspaceId}:${itemId}`;
    commitSynced(set, get, (synced) => {
      if (!synced.linkedOverrides.requests[key]) return synced;
      const { [key]: _drop, ...rest } = synced.linkedOverrides.requests;
      void _drop;
      return {
        ...synced,
        linkedOverrides: { ...synced.linkedOverrides, requests: rest },
      };
    });
  },
  clearLinkedRequestOverrideField: (linkedWorkspaceId, itemId, field) => {
    const key = `${linkedWorkspaceId}:${itemId}`;
    commitSynced(set, get, (synced) => {
      const row = synced.linkedOverrides.requests[key];
      if (!row || !(field in row.patch)) return synced;
      const { [field]: _drop, ...remainingPatch } = row.patch;
      void _drop;
      // No fields left — collapse the entire override row so the source is
      // re-inherited verbatim.
      if (Object.keys(remainingPatch).length === 0) {
        const { [key]: _row, ...rest } = synced.linkedOverrides.requests;
        void _row;
        return {
          ...synced,
          linkedOverrides: { ...synced.linkedOverrides, requests: rest },
        };
      }
      return {
        ...synced,
        linkedOverrides: {
          ...synced.linkedOverrides,
          requests: {
            ...synced.linkedOverrides.requests,
            [key]: {
              ...row,
              patch: remainingPatch,
              updatedAt: new Date().toISOString(),
            },
          },
        },
      };
    });
  },
  setLinkedEnvVarOverride: (linkedWorkspaceId, envName, varKey, patch) => {
    const key = `${linkedWorkspaceId}:${envName}:${varKey}`;
    commitSynced(set, get, (synced) => ({
      ...synced,
      linkedOverrides: {
        ...synced.linkedOverrides,
        environmentVars: {
          ...synced.linkedOverrides.environmentVars,
          [key]: {
            linkedWorkspaceId,
            envName,
            varKey,
            ...patch,
            updatedAt: new Date().toISOString(),
          },
        },
      },
    }));
  },
  clearLinkedEnvVarOverride: (linkedWorkspaceId, envName, varKey) => {
    const key = `${linkedWorkspaceId}:${envName}:${varKey}`;
    commitSynced(set, get, (synced) => {
      if (!synced.linkedOverrides.environmentVars[key]) return synced;
      const { [key]: _drop, ...rest } = synced.linkedOverrides.environmentVars;
      void _drop;
      return {
        ...synced,
        linkedOverrides: { ...synced.linkedOverrides, environmentVars: rest },
      };
    });
  },
  clearLinkedOverridesFor: (linkedWorkspaceId) => {
    commitSynced(set, get, (synced) => {
      const requests = Object.fromEntries(
        Object.entries(synced.linkedOverrides.requests).filter(
          ([, override]) => override.linkedWorkspaceId !== linkedWorkspaceId,
        ),
      );
      const environmentVars = Object.fromEntries(
        Object.entries(synced.linkedOverrides.environmentVars).filter(
          ([, override]) => override.linkedWorkspaceId !== linkedWorkspaceId,
        ),
      );
      // Short-circuit when nothing changed so commitSynced doesn't emit.
      if (
        Object.keys(requests).length === Object.keys(synced.linkedOverrides.requests).length &&
        Object.keys(environmentVars).length ===
          Object.keys(synced.linkedOverrides.environmentVars).length
      ) {
        return synced;
      }
      return {
        ...synced,
        linkedOverrides: { requests, environmentVars },
      };
    });
  },
  setActiveLinkedRequest: (id) => {
    set({ activeLinkedRequest: id });
    // Mirror of setActiveRequestId: opening a linked request clears the
    // workspace-active id, so the editor's unified selector doesn't see
    // both at once. Closing (id === null) leaves the workspace-active
    // alone — the user may want to fall back to whatever they had open.
    if (id !== null) {
      const local = get().local;
      if (local && local.ui.activeRequestId !== null) {
        const next: WorkspaceLocal = {
          ...local,
          ui: { ...local.ui, activeRequestId: null },
        };
        set({ local: next });
        queueSaveLocal(next);
      }
    }
  },
  removeGlobalContextKey: (key) => {
    const local = get().local;
    if (!local) return;
    if (!(key in local.globalContext)) return;
    const { [key]: _omit, ...rest } = local.globalContext;
    void _omit;
    const next: WorkspaceLocal = { ...local, globalContext: rest };
    set({ local: next });
    queueSaveLocal(next);
  },
  clearGlobalContext: () => {
    const local = get().local;
    if (!local) return;
    const next: WorkspaceLocal = { ...local, globalContext: {} };
    set({ local: next });
    queueSaveLocal(next);
  },

  setRequestFormRows: (id, rows) => {
    const synced = get().synced;
    if (!synced) return;
    const existing = synced.collections.requests[id];
    if (!existing) return;
    const before =
      existing.body.type === 'form-data' && existing.body.formRows ? existing.body.formRows : [];
    const beforeSlots = new Set(
      before.flatMap((r) =>
        r.kind === 'file' && r.slotId && !r.globalFileAssetId ? [r.slotId] : [],
      ),
    );
    const afterSlots = new Set(
      rows.flatMap((r) => (r.kind === 'file' && r.slotId ? [r.slotId] : [])),
    );
    const orphaned = [...beforeSlots].filter((s) => !afterSlots.has(s));
    const nextBody: RequestBody = { ...existing.body, type: 'form-data', formRows: rows };
    commitSynced(set, get, (s) => setRequestBodyAction(s, id, nextBody));
    const ownedOrphaned = orphaned.filter((slotId) => !isGlobalFileSlot(synced, slotId));
    if (ownedOrphaned.length > 0) void deleteManyAttachments(ownedOrphaned);
  },

  attachFormFile: async (requestId, rowIndex, file) => {
    enforceAttachmentSize(file);
    const synced = get().synced;
    if (!synced) return;
    const existing = synced.collections.requests[requestId];
    if (!existing || existing.body.type !== 'form-data' || !existing.body.formRows) return;
    const oldRow = existing.body.formRows[rowIndex];
    if (!oldRow) return;
    const previousSlot =
      oldRow.kind === 'file' && oldRow.slotId && !oldRow.globalFileAssetId ? oldRow.slotId : null;

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
    if (previousSlot && !isGlobalFileSlot(synced, previousSlot))
      await deleteAttachment(previousSlot);
  },

  detachFormFile: async (requestId, rowIndex) => {
    const synced = get().synced;
    if (!synced) return;
    const existing = synced.collections.requests[requestId];
    if (!existing || existing.body.type !== 'form-data' || !existing.body.formRows) return;
    const oldRow = existing.body.formRows[rowIndex];
    if (!oldRow || oldRow.kind !== 'file') return;
    const previousSlot = oldRow.globalFileAssetId ? null : oldRow.slotId;

    const nextRow: FormDataRow = {
      kind: 'file',
      key: oldRow.key,
      enabled: oldRow.enabled,
      slotId: null,
    };
    const nextRows = existing.body.formRows.map((r, i) => (i === rowIndex ? nextRow : r));
    const nextBody: RequestBody = { ...existing.body, formRows: nextRows };
    commitSynced(set, get, (s) => setRequestBodyAction(s, requestId, nextBody));
    if (previousSlot && !isGlobalFileSlot(synced, previousSlot))
      await deleteAttachment(previousSlot);
  },

  attachBinaryFile: async (requestId, file) => {
    enforceAttachmentSize(file);
    const synced = get().synced;
    if (!synced) return;
    const existing = synced.collections.requests[requestId];
    if (!existing) return;
    const previousSlot =
      existing.body.type === 'binary' && !existing.body.attachment?.globalFileAssetId
        ? (existing.body.attachment?.slotId ?? null)
        : null;

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
    if (previousSlot && !isGlobalFileSlot(synced, previousSlot))
      await deleteAttachment(previousSlot);
  },

  detachBinaryFile: async (requestId) => {
    const synced = get().synced;
    if (!synced) return;
    const existing = synced.collections.requests[requestId];
    if (!existing || existing.body.type !== 'binary') return;
    const previousSlot = existing.body.attachment?.globalFileAssetId
      ? null
      : (existing.body.attachment?.slotId ?? null);

    const nextBody: RequestBody = { type: 'binary', content: '' };
    commitSynced(set, get, (s) => setRequestBodyAction(s, requestId, nextBody));
    if (previousSlot && !isGlobalFileSlot(synced, previousSlot))
      await deleteAttachment(previousSlot);
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

  setVariableValue: async (envName, index, value) => {
    const synced = get().synced;
    if (!synced) return;
    const env = synced.environments.items[envName];
    if (!env) return;
    const existing = env.variables[index];
    if (!existing) return;

    // If the row is bound to a slot, re-encrypt the new plaintext under the
    // slot's derived key. Falls through to plaintext storage when the slot
    // value is missing locally — caller is expected to surface a "provide
    // slot value" prompt; we don't silently drop the user's input.
    if (existing.encrypted && existing.secretKeyId) {
      const cipherValue = await tryEncryptForSlot(get, existing.secretKeyId, value);
      if (cipherValue !== null) {
        const nextVars: Environment['variables'] = env.variables.map((v, i) =>
          i === index ? { ...v, value: cipherValue, encrypted: true } : v,
        );
        commitSynced(set, get, (s) => setVariablesAction(s, envName, nextVars));
        return;
      }
      // Fall through — slot value missing, store plaintext + clear binding.
    }
    const nextVars: Environment['variables'] = env.variables.map((v, i) =>
      i === index ? { ...v, value, encrypted: false, secretKeyId: undefined } : v,
    );
    commitSynced(set, get, (s) => setVariablesAction(s, envName, nextVars));
  },

  bindVariableToSecretKey: async (envName, index, secretKeyId) => {
    const synced = get().synced;
    const local = get().local;
    if (!synced || !local) return false;
    const env = synced.environments.items[envName];
    if (!env) return false;
    const existing = env.variables[index];
    if (!existing) return false;
    if (!local.secretIndex.entries[secretKeyId]) return false;
    const entry = local.secretIndex.entries[secretKeyId];

    // Ensure the slot exists in synced.secretKeys with a salt. addSecret
    // registers it eagerly; lazy-register here as a defensive backfill
    // (e.g. for slots created before this code landed).
    let meta = synced.secretKeys?.[secretKeyId];
    let metaCreated = false;
    if (!meta) {
      meta = {
        id: secretKeyId,
        label: entry.label,
        salt: generateSlotSalt(),
        createdAt: entry.createdAt,
      };
      metaCreated = true;
    }

    // Encrypt the row's current plaintext under the slot's derived key. If
    // the slot value isn't available locally we can't encrypt — refuse the
    // bind and let the caller prompt the user to provide the slot value.
    const cipherValue = await tryEncryptForSlot(get, secretKeyId, existing.value, meta);
    if (cipherValue === null) return false;

    const nextSecretKeys = metaCreated
      ? { ...(synced.secretKeys ?? {}), [secretKeyId]: meta }
      : (synced.secretKeys ?? {});

    const nextVars: Environment['variables'] = env.variables.map((v, i) =>
      i === index ? { ...v, encrypted: true, secretKeyId, value: cipherValue } : v,
    );

    commitSynced(set, get, (s) => ({
      ...setVariablesAction(s, envName, nextVars),
      secretKeys: nextSecretKeys,
    }));
    return true;
  },

  unbindVariableSecretKey: async (envName, index, opts) => {
    const synced = get().synced;
    if (!synced) return false;
    const env = synced.environments.items[envName];
    if (!env) return false;
    const existing = env.variables[index];
    if (!existing) return false;
    if (!existing.encrypted || !existing.secretKeyId) {
      // Already plain — just normalize the row.
      const nextVars: Environment['variables'] = env.variables.map((v, i) =>
        i === index ? { ...v, encrypted: false, secretKeyId: undefined } : v,
      );
      commitSynced(set, get, (s) => setVariablesAction(s, envName, nextVars));
      return true;
    }

    // Decrypt ciphertext back to plaintext under the slot's derived key. If
    // the slot value isn't available locally — or the value on this device
    // doesn't decrypt the row's ciphertext (passphrase / value mismatch) —
    // we can't recover the plaintext.
    //
    // Two failure modes from one path:
    //   - Default: refuse and return false. Caller surfaces a confirm step
    //     ("Decryption failed — unbind anyway? The value will be cleared.")
    //     and re-invokes with `{ force: true }`.
    //   - Forced:  proceed with an empty value, dropping the binding. The
    //     row becomes a plaintext row with `value: ''` so the user can
    //     type a fresh plaintext into the existing slot.
    const plaintext = await tryDecryptForSlot(get, existing.secretKeyId, existing.value);
    if (plaintext === null) {
      if (!opts?.force) return false;
      const nextVars: Environment['variables'] = env.variables.map((v, i) =>
        i === index ? { ...v, encrypted: false, secretKeyId: undefined, value: '' } : v,
      );
      commitSynced(set, get, (s) => setVariablesAction(s, envName, nextVars));
      return true;
    }

    const nextVars: Environment['variables'] = env.variables.map((v, i) =>
      i === index ? { ...v, encrypted: false, secretKeyId: undefined, value: plaintext } : v,
    );
    commitSynced(set, get, (s) => setVariablesAction(s, envName, nextVars));
    return true;
  },

  setEnvFocus: (name) => {
    const items = get().synced?.environments.items ?? {};
    if (name && !items[name]) return;
    set({ envFocus: name });
  },

  // --- Secret Vault ------------------------------------------------------

  addSecret: async ({ label, value, origin, linkedWorkspaceId, linkedKeyId }) => {
    const local = get().local;
    const synced = get().synced;
    if (!local || !synced) return '';
    // Phase 9: on web without a workspace passphrase the master key would
    // sit in plaintext IndexedDB. Refuse to add a secret on that runtime
    // — the user can still add one after setting a passphrase, or on the
    // Desktop App where the JWK is wrapped via OS keychain.
    await assertSecretsProtected(synced.secretCrypto);
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
    queueSaveLocal(next);
    // Workspace-origin slots become first-class entries in synced.secretKeys
    // with a per-slot salt so encrypted env vars travel through Git: any
    // teammate who supplies the same slot value derives the same AES-GCM
    // key (PBKDF2 with this salt) and can decrypt. Linked-origin slots and
    // raw secrets (e.g. GitHub PATs added via addSecretEntry directly) stay
    // out of synced.secretKeys — they're per-device.
    if ((origin ?? 'workspace') === 'workspace') {
      const salt = generateSlotSalt();
      const meta: SecretKeyMeta = {
        id,
        label: label.trim(),
        salt,
        createdAt: next.secretIndex.entries[id].createdAt,
      };
      const nextSynced: WorkspaceSynced = {
        ...synced,
        secretKeys: { ...(synced.secretKeys ?? {}), [id]: meta },
        meta: { ...synced.meta, updatedAt: new Date().toISOString() },
      };
      set({ synced: nextSynced });
      queueSaveSynced(nextSynced);
    }
    get().recomputeSecretUsage();
    return id;
  },

  setSecretValue: async (id, value) => {
    const local = get().local;
    const synced = get().synced;
    if (!local || !synced || !local.secretIndex.entries[id]) return false;

    // When a slot value changes, every env var encrypted under it has
    // ciphertext that only the OLD value can decrypt. Decrypt everything
    // with the old value first (using the existing salt + slot value), then
    // re-encrypt with the new value (same salt, new derived key) so the
    // synced doc stays valid.
    const meta = synced.secretKeys?.[id];
    const oldSlotValue = await loadSlotPlaintext(id);
    let nextSynced: WorkspaceSynced | null = null;
    if (meta && oldSlotValue !== null && oldSlotValue !== value) {
      const oldKey = await deriveKeyFromSlotValue(oldSlotValue, meta.salt);
      const newKey = await deriveKeyFromSlotValue(value, meta.salt);
      const nextItems: Record<string, Environment> = {};
      let touched = false;
      for (const [envName, env] of Object.entries(synced.environments.items)) {
        const nextVars = await Promise.all(
          env.variables.map(async (v) => {
            if (!(v.encrypted && v.secretKeyId === id)) return v;
            const payload = tryParsePayload(v.value);
            if (!payload) return v; // unrecoverable — leave intact
            try {
              const plaintext = await decryptString(payload, oldKey);
              const next = await encryptString(plaintext, newKey);
              touched = true;
              return { ...v, value: serializePayload(next) };
            } catch {
              return v;
            }
          }),
        );
        nextItems[envName] = { ...env, variables: nextVars };
      }
      if (touched) {
        nextSynced = {
          ...synced,
          environments: { ...synced.environments, items: nextItems },
          meta: { ...synced.meta, updatedAt: new Date().toISOString() },
        };
      }
    }

    // Re-wrap the slot value at rest under the local master key.
    const masterKey = await getMasterKey();
    const payload = await encryptString(value, masterKey);
    await putSecretPayload(id, payload);

    if (nextSynced) {
      set({ synced: nextSynced });
      queueSaveSynced(nextSynced);
    }
    return true;
  },

  /**
   * Onboarding: supply a slot's value when the local vault has no payload
   * for it yet (typical "I just cloned this workspace" flow). The slot
   * identity is read from `synced.secretKeys[id]` — we mirror it into the
   * local secret index so the rest of the app sees the slot the same way
   * it does for slots created on this device. Unlike `setSecretValue`, no
   * re-encryption pass runs — we trust the supplied value matches what
   * existing ciphertext was encrypted under (else env vars surface as
   * `<MISSING:LABEL>` at send time, prompting the user to fix it).
   */
  provideSlotValue: async (id, value) => {
    const local = get().local;
    const synced = get().synced;
    if (!local || !synced) return false;
    const meta = synced.secretKeys?.[id];
    if (!meta) return false;
    const masterKey = await getMasterKey();
    const payload = await encryptString(value, masterKey);
    await putSecretPayload(id, payload);
    // Mirror the slot into the local index if it isn't already there
    // (cloning a workspace lands synced.secretKeys but no local entry).
    if (!local.secretIndex.entries[id]) {
      const nextLocal = addSecretEntryAction(local, {
        id,
        label: meta.label,
        origin: 'workspace',
      });
      if (nextLocal !== local) {
        set({ local: nextLocal });
        queueSaveLocal(nextLocal);
        get().recomputeSecretUsage();
      }
    }
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
    const synced = get().synced;
    if (!local) return;
    const nextLocal = renameSecretEntryAction(local, id, label);
    if (nextLocal === local) return;
    set({ local: nextLocal });
    queueSaveLocal(nextLocal);
    // Labels for workspace-origin slots also live on `synced.secretKeys`
    // so collaborators pulling from Git see the same human-readable
    // name. Without mirroring here, the rename takes effect locally
    // but a teammate pulling sees the stale label. Linked-origin slots
    // don't have a corresponding `synced.secretKeys[id]` entry (their
    // metadata is owned by the source workspace), so the conditional
    // skip is safe.
    if (synced?.secretKeys?.[id]) {
      const trimmed = label.trim();
      if (trimmed && synced.secretKeys[id].label !== trimmed) {
        const nextSynced: WorkspaceSynced = {
          ...synced,
          secretKeys: {
            ...synced.secretKeys,
            [id]: { ...synced.secretKeys[id], label: trimmed },
          },
          meta: { ...synced.meta, updatedAt: new Date().toISOString() },
        };
        set({ synced: nextSynced });
        queueSaveSynced(nextSynced);
      }
    }
  },

  listMissingSlots: async () => {
    const synced = get().synced;
    if (!synced?.secretKeys) return [];
    const missing: SecretKeyMeta[] = [];
    for (const meta of Object.values(synced.secretKeys)) {
      const payload = await getSecretPayload(meta.id);
      if (!payload) missing.push(meta);
    }
    return missing;
  },

  removeSecret: async (id) => {
    const local = get().local;
    const synced = get().synced;
    if (!local || !synced || !local.secretIndex.entries[id]) return;

    // Drop the IDB payload + the per-device index entry first.
    await deleteSecretPayload(id);
    const nextLocal = removeSecretEntryAction(local, id);

    // Cascade through the synced doc: drop the slot record, and unbind
    // every env var that referenced it. We can't recover those env vars'
    // plaintext (slot key is gone), so they become empty plain rows — the
    // user keeps the variable name and can re-type a value if needed.
    let touched = false;
    const nextItems: Record<string, Environment> = {};
    for (const [envName, env] of Object.entries(synced.environments.items)) {
      const nextVars = env.variables.map((v) => {
        if (v.encrypted && v.secretKeyId === id) {
          touched = true;
          return { key: v.key, value: '', encrypted: false };
        }
        return v;
      });
      nextItems[envName] = { ...env, variables: nextVars };
    }
    const nextSecretKeys = { ...(synced.secretKeys ?? {}) };
    const hadSlotMeta = id in nextSecretKeys;
    delete nextSecretKeys[id];

    if (touched || hadSlotMeta) {
      const nextSynced: WorkspaceSynced = {
        ...synced,
        environments: { ...synced.environments, items: nextItems },
        secretKeys: nextSecretKeys,
        meta: { ...synced.meta, updatedAt: new Date().toISOString() },
      };
      set({ local: nextLocal, synced: nextSynced });
      queueSaveSynced(nextSynced);
    } else {
      set({ local: nextLocal });
    }
    queueSaveLocal(nextLocal);
  },

  recomputeSecretUsage: () => {
    const synced = get().synced;
    const local = get().local;
    if (!synced || !local) return;
    const next = recomputeUsedIn(synced, local);
    if (next === local) return;
    set({ local: next });
    queueSaveLocal(next);
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
      // Scope-only check at connect time. Since REQUIRED_BASE_SCOPES already
      // mandates `repo`, this typically resolves to `true` immediately for
      // both classic PATs (where `repo` covers PR ops) and fine-grained
      // PATs that surface `pull_request` directly. A `null` here means the
      // token uses a permission model the scope check can't read; the
      // probe runs once a repo is connected (see `connectRepo`).
      canCreatePullRequests: checkPrCapabilityFromScopes(scopes.granted),
    };
    const next: WorkspaceLocal = {
      ...indexed,
      sessions: { github: { ...indexed.sessions.github, workspace: session } },
    };
    set({ local: next });
    queueSaveLocal(next);
    return session;
  },

  verifyGitHubScopes: async () => {
    const local = get().local;
    const session = local?.sessions.github.workspace ?? null;
    if (!local || !session) return null;
    const payload = await getSecretPayload(session.tokenSecretId);
    if (!payload) return null;
    const masterKey = await getMasterKey();
    const token = await decryptString(payload, masterKey);
    const client = new GitHubClient();
    const { scopes } = await client.getViewer(token);
    // Re-resolve PR capability: scope check first; if inconclusive AND a
    // repo is already connected, fall back to the network probe so the
    // session card flips out of the unknown state on its own.
    const repo = local.connectedRepo;
    const capability = await resolvePrCapability({
      grantedScopes: scopes.granted,
      probe: repo ? () => probePrCapability(client, token, repo.owner, repo.name) : undefined,
    });
    const updated: GitHubSession = {
      ...session,
      grantedScopes: scopes.granted,
      lastVerifiedAt: new Date().toISOString(),
      canCreatePullRequests: capability,
    };
    const next: WorkspaceLocal = {
      ...local,
      sessions: { github: { ...local.sessions.github, workspace: updated } },
    };
    set({ local: next });
    queueSaveLocal(next);
    return scopes.granted;
  },

  updateGitHubToken: async (token) => {
    const local = get().local;
    const session = local?.sessions.github.workspace ?? null;
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
    // Re-resolve capability with the new token. Mirrors verifyGitHubScopes:
    // probe falls back to the connected repo when scope check is inconclusive.
    const repo = local.connectedRepo;
    const capability = await resolvePrCapability({
      grantedScopes: scopes.granted,
      probe: repo ? () => probePrCapability(client, trimmed, repo.owner, repo.name) : undefined,
    });
    const updated: GitHubSession = {
      ...session,
      grantedScopes: scopes.granted,
      lastVerifiedAt: new Date().toISOString(),
      canCreatePullRequests: capability,
    };
    const next: WorkspaceLocal = {
      ...local,
      sessions: { github: { ...local.sessions.github, workspace: updated } },
    };
    set({ local: next });
    queueSaveLocal(next);
    return updated;
  },

  connectGitHubSessionViaDeviceFlow: async ({ onCodeReady, signal }) => {
    const clientId = readOAuthClientId();
    const local = get().local;
    if (!local) throw new Error('Workspace not ready');
    // GitHub doesn't send CORS headers on `github.com/login/*`, so a
    // browser can't POST there directly. The renderer routes through a
    // same-origin proxy (Vite dev server + Electron's main-process proxy
    // in production). Non-browser callers keep the direct origin.
    const client = new GitHubClient({ loginBaseUrl: resolveGitHubLoginBaseUrl() });
    // Classic OAuth apps don't accept `pull_request` as a scope — `repo`
    // already grants PR read/write. Requesting it surfaces as
    // `invalid_scope` from `login/device/code`, so we only ask for the
    // base scopes here.
    const scope = REQUIRED_BASE_SCOPES.join(',');
    const flow = await client.startDeviceFlow(clientId, scope);
    const expiresAt = Date.now() + flow.expiresIn * 1000;
    onCodeReady({
      userCode: flow.userCode,
      verificationUri: flow.verificationUri,
      expiresAt,
    });

    // Poll loop. GitHub's `interval` is in seconds; honor `slow_down`
    // by adding +5s to the next poll. Bail out cleanly on signal abort.
    let intervalMs = flow.interval * 1000;
    while (Date.now() < expiresAt) {
      if (signal?.aborted) throw new Error('Sign-in cancelled.');
      await wait(intervalMs, signal);
      const result = await client.pollDeviceToken(clientId, flow.deviceCode);
      if (result.kind === 'granted') {
        // Funnel through the existing PAT path so the token gets
        // vault-encrypted, scope-validated, and the session card lights
        // up identically to a manual PAT.
        return get().connectGitHubSession(result.accessToken);
      }
      if (result.kind === 'denied')
        throw new Error(`GitHub authorization denied: ${result.reason}`);
      if (result.kind === 'expired') throw new Error('Device code expired — try again.');
      if (result.kind === 'pending' && result.slowDown) intervalMs += 5_000;
    }
    throw new Error('Device code expired — try again.');
  },

  disconnectGitHubSession: async () => {
    const local = get().local;
    const session = local?.sessions.github.workspace ?? null;
    if (!local || !session) return;
    await deleteSecretPayload(session.tokenSecretId);
    const indexCleared = removeSecretEntryAction(local, session.tokenSecretId);
    const next: WorkspaceLocal = {
      ...indexCleared,
      // Only the workspace session is cleared. Per-link linking sessions
      // stay put — disconnecting the workspace PAT shouldn't silently nuke
      // unrelated link credentials. Links bound with sessionMode='workspace'
      // become orphaned; the link card surfaces a "session missing" warning
      // and the user can remap to a dedicated session or re-add the
      // workspace session.
      sessions: { github: { ...indexCleared.sessions.github, workspace: null } },
      // Disconnecting the session also drops the repo + branch — they're
      // unusable without an authenticated client.
      connectedRepo: null,
      workingBranch: null,
    };
    set({ local: next });
    queueSaveLocal(next);
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

    // If session connect couldn't determine PR capability from scopes
    // alone (canCreatePullRequests === null — typically a fine-grained
    // PAT whose permissions aren't surfaced via x-oauth-scopes), now that
    // we have a repo to probe against, run it. Scope-confirmed sessions
    // (the common case — every classic PAT with `repo`) skip this step.
    let updatedSession = local.sessions.github.workspace;
    if (updatedSession && updatedSession.canCreatePullRequests === null) {
      try {
        const probed = await probePrCapability(client, token, repo.owner, repo.name);
        updatedSession = { ...updatedSession, canCreatePullRequests: probed };
      } catch {
        // Probe failed transiently — leave capability as null so a later
        // verify can retry. Don't block repo connection on this.
      }
    }

    const next: WorkspaceLocal = {
      ...local,
      sessions: { github: { ...local.sessions.github, workspace: updatedSession } },
      connectedRepo: connected,
      // If the user re-connects to a different repo, drop any branch tied
      // to the old one — pushing to the wrong repo would be a disaster.
      workingBranch:
        local.workingBranch?.repoFullName === connected.fullName ? local.workingBranch : null,
    };
    set({ local: next });
    queueSaveLocal(next);
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
    queueSaveLocal(next);
  },

  createWorkingBranch: async (opts) => {
    const local = get().local;
    const synced = get().synced;
    if (!local || !synced) throw new Error('Workspace not ready');
    const repo = local.connectedRepo;
    if (!repo) throw new Error('Connect a repo before creating a working branch');

    const baseBranch = opts?.baseBranch?.trim() || repo.defaultBranch;
    const registry = get().workspaceRegistry;
    const activeEntry = registry?.workspaces.find((w) => w.id === synced.workspaceId) ?? null;
    const displayName = activeEntry?.name ?? DEFAULT_WORKSPACE_NAME;
    const branchName = opts?.branchName?.trim() || generateWorkingBranchName({ displayName });

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
    // Creating a fresh working branch implicitly acknowledges any retired
    // branch — the banner pointed the user here, and they followed through.
    const next: WorkspaceLocal = { ...local, workingBranch: branch, retiredBranch: null };
    set({ local: next });
    queueSaveLocal(next);

    // Probe the new branch for an existing `workspace.json`. If it's
    // there, the repo is pre-populated — the user shouldn't push their
    // local seed without first reviewing remote content. Surface the
    // first-pull prompt; the WorkspacePanel banner offers "Pull first"
    // (refreshWorkspace) vs. "Skip" (acknowledgeFirstPull).
    //
    // Exception: if the file's blob sha matches the scaffold we just
    // wrote via `seedInitialCommit`, suppress the prompt — that "remote
    // content" is our own empty placeholder, not anything the user needs
    // to review. Clear the stash either way so a later legitimate
    // pre-populated branch surfaces normally.
    try {
      const file = await client.getContents(
        token,
        repo.owner,
        repo.name,
        'workspace.json',
        branchName,
      );
      const seededSha = next.seededWorkspaceSha;
      if (file !== null && file.sha !== seededSha) {
        set({ firstPullPrompt: { branchName, remoteSha: file.sha } });
      }
      if (seededSha) {
        const cleared: WorkspaceLocal = { ...get().local!, seededWorkspaceSha: null };
        set({ local: cleared });
        queueSaveLocal(cleared);
      }
    } catch {
      // Probe is best-effort — auth/network blips don't block branch creation.
    }
    return branch;
  },

  seedInitialCommit: async () => {
    const local = get().local;
    const synced = get().synced;
    if (!local || !synced) throw new Error('Workspace not ready');
    const repo = local.connectedRepo;
    if (!repo) throw new Error('Connect a repo before seeding the initial commit');

    const token = await decryptSessionToken(local);
    const client = new GitHubClient();
    const branchName = repo.defaultBranch;
    let scaffoldSha: string | null = null;

    // Idempotent probe: if workspace.json is already on the default branch,
    // the seed's job is done — listBranches probably just paginated past
    // existing branches, or a previous attempt partially landed. Skip the
    // PUT (which would fail with 422 "sha wasn't supplied" anyway) and reuse
    // the existing blob sha as the "scaffold sha" so createWorkingBranch
    // can suppress its first-pull prompt for that exact content.
    try {
      const existing = await client.getContents(
        token,
        repo.owner,
        repo.name,
        'workspace.json',
        branchName,
      );
      if (existing) {
        scaffoldSha = existing.sha;
      }
    } catch {
      // Probe is best-effort — if it errors (e.g. branch genuinely doesn't
      // exist yet on a truly empty repo), fall through to the PUT.
    }

    if (scaffoldSha === null) {
      // Build a minimal scaffold: keep the user's workspaceId (so this
      // repo's identity stays tied to their workspace) but clear all content
      // arrays. The user's actual content lands via the working-branch push.
      // No workspace name is included — names live in each user's local
      // registry, not in the git-tracked doc.
      const scaffold: WorkspaceSynced = {
        schemaVersion: synced.schemaVersion,
        workspaceId: synced.workspaceId,
        collections: {
          tree: { id: synced.collections.tree.id, type: 'root', children: [] },
          requests: {},
          folders: {},
        },
        environments: { items: {}, activeName: null, priorityOrder: [] },
        linkedWorkspaces: {},
        linkedOverrides: { requests: {}, environmentVars: {} },
        releases: { self: null, perLink: {} },
        globalAssets: { schemas: {}, graphql: {}, files: {} },
        mockServers: {},
        secretKeys: {},
        meta: synced.meta,
      };
      const content = serializeWorkspaceForGit(scaffold);

      // Use the Contents API rather than the git-data flow: a truly empty
      // repo has no git database yet, so /git/blobs, /git/trees, /git/commits
      // all reject with 409 "Git Repository is empty.". PUT /contents/{path}
      // atomically initializes the repo with a one-file commit on the
      // supplied branch (defaulting to repo.defaultBranch).
      const contentBase64 = bytesToBase64(new TextEncoder().encode(content));
      const result = await client.putContents(token, repo.owner, repo.name, 'workspace.json', {
        message: 'chore: initialize workspace.json',
        contentBase64,
        branch: branchName,
      });
      scaffoldSha = result.contentSha;
    }

    // Persist the scaffold blob sha so the next createWorkingBranch can
    // recognise its own seed and skip the false-positive first-pull prompt.
    const next: WorkspaceLocal = { ...get().local!, seededWorkspaceSha: scaffoldSha };
    set({ local: next });
    queueSaveLocal(next);

    return { branchName, scaffoldSha };
  },

  discardWorkingBranch: () => {
    const local = get().local;
    if (!local || !local.workingBranch) return;
    const next: WorkspaceLocal = { ...local, workingBranch: null };
    set({ local: next });
    queueSaveLocal(next);
  },

  pushWorkspace: async (commitMessage) => {
    // Drain the debounced persistence queue before serialising for git.
    // If a keystroke landed in the last 250ms, its in-memory state is
    // ahead of what's on disk — and we serialize from in-memory `synced`,
    // so the user wouldn't lose data, but a crash between this push and
    // the next debounce flush would diverge IDB from what we just pushed.
    // Flushing here keeps "what's on disk" === "what's in git".
    await flushPendingPersist();

    const local = get().local;
    const synced = get().synced;
    if (!local || !synced) throw new Error('Workspace not ready');
    const branch = local.workingBranch;
    if (!branch) throw new Error('Create a working branch in the Workspace panel before pushing');
    const repo = local.connectedRepo;
    if (!repo) throw new Error('No repo connected');

    // Capture a pre-push snapshot so the user can restore the local state
    // if the upstream gets in a weird shape after the push (force-push
    // overwrites, branch reset, etc).
    get().captureSnapshot({ trigger: 'pre-push', note: `Before push to ${branch.name}` });

    const token = await decryptSessionToken(local);
    const client = new GitHubClient();
    const owner = branch.repoOwner;
    const name = branch.repoName;

    // 0. Pre-flight: confirm the remote branch head still matches what we
    //    last observed. If it doesn't, somebody (force-push, another client,
    //    a CI bot) moved the branch and we'd otherwise upload blobs + a
    //    tree + a commit before discovering the divergence at updateRef.
    //    Throw BranchDivergedError up-front so the UI can route the user
    //    through Refresh first — no orphan objects on the remote.
    const head = await client.getRef(token, owner, name, branch.name);
    if (branch.headSha && head.sha !== branch.headSha) {
      throw new BranchDivergedError(
        `Remote branch "${branch.name}" has moved since your last sync. ` +
          `Refresh first to reconcile, then push again.`,
        branch.headSha,
        head.sha,
      );
    }

    // If steps 1-5 throw, the local store stays untouched (mutation only
    // happens in step 6 below). A retry is safe: orphan blobs/trees from a
    // partial run are harmless, and updateRef is idempotent on the same SHA.
    // 1. Read the head tree SHA so createTree can layer on top of it.
    const headCommit = await client.getCommit(token, owner, name, head.sha);
    // 2. Upload every locally-cached attachment as a blob. Slots whose
    //    bytes aren't in local IDB are skipped — base_tree keeps the
    //    remote entry intact (or absent, on first push).
    const slots = collectAttachmentSlots(synced);
    const attachmentEntries: TreeEntryInput[] = [];
    for (const slot of slots) {
      const record = await getAttachment(slot.slotId);
      if (!record) continue;
      const actualSha = await sha256HexBytes(record.bytes);
      if (slot.sha256 && actualSha !== slot.sha256) {
        throw new Error(
          `Attachment ${slot.filename ?? slot.slotId} failed checksum verification; push aborted.`,
        );
      }
      const blob = await client.createBlob(token, owner, name, {
        content: bytesToBase64(record.bytes),
        encoding: 'base64',
      });
      attachmentEntries.push({
        path: `.apicircle/attachments/${slot.slotId}`,
        sha: blob.sha,
      });
    }
    // 3. Build the new tree, layering workspace.json + attachments over base_tree.
    //    Phase 8 security: redact every secret-bearing field BEFORE
    //    serialising. The push payload is visible to every collaborator
    //    on this repo (and to the world for public repos) — passwords,
    //    bearer tokens, refresh tokens, AWS keys etc. CANNOT travel via
    //    git. `assertNoPlaintextCredentials` is a fail-closed lint pass
    //    over the already-serialised bytes — if any redactor case got
    //    missed (or a future RequestAuth variant is added without
    //    wiring), the push is refused before we ever call createTree.
    const redacted = redactForGit(synced);
    const content = serializeWorkspaceForGit(redacted);
    assertNoPlaintextCredentials(content);
    const newTree = await client.createTree(token, owner, name, {
      baseTreeSha: headCommit.treeSha,
      entries: [{ path: 'workspace.json', content }, ...attachmentEntries],
    });
    // 4. Create the commit.
    const message = (commitMessage ?? '').trim() || 'chore: sync workspace via API Circle Studio';
    const newCommit = await client.createCommit(token, owner, name, {
      message,
      treeSha: newTree.sha,
      parents: [head.sha],
    });
    const newCommitSha = newCommit.sha;
    // 5. Fast-forward the branch ref.
    await client.updateRef(token, owner, name, {
      branch: branch.name,
      sha: newCommit.sha,
    });

    // 6. Persist the new local branch state + refresh the sync snapshot.
    //    After a successful push, the just-pushed `synced` doc IS the
    //    canonical remote state on this branch, so we re-base the 3-way
    //    diff machinery against it. Without this, the UnpushedChangesStrip
    //    keeps diffing against the stale `lastPulledSnapshot` (often null
    //    on the first push) and reports the same N changes as still
    //    unpushed even though the remote now matches local.
    const updatedBranch: WorkingBranch = {
      ...branch,
      headSha: newCommitSha,
      lastPushedSha: newCommitSha,
    };
    const currentLocal = get().local!;
    const next: WorkspaceLocal = {
      ...currentLocal,
      workingBranch: updatedBranch,
      sync: {
        ...currentLocal.sync,
        lastPulledSnapshot: synced,
        lastPulledSha: newCommitSha,
        lastPulledAt: new Date().toISOString(),
        dirtyKeys: [],
      },
    };
    set({ local: next });
    queueSaveLocal(next);
    return { commitSha: newCommitSha };
  },

  publishRelease: async (args) => {
    const synced = get().synced;
    if (!synced) return {};
    // Publishing now ONLY writes the ledger entry + workspace fingerprint.
    // Git tag / GitHub Release creation moved to the dedicated
    // `tagReleaseVersion` action so tags can target main HEAD after the
    // PR merges, instead of an unmerged working-branch commit (the bug
    // this rework closes).
    const next = await publishReleaseAction(synced, args);
    set({ synced: next });
    await saveSynced(next);
    return {};
  },

  tagReleaseVersion: async (args) => {
    const local = get().local;
    if (!local?.connectedRepo) {
      throw new Error('Connect a repo before tagging a release.');
    }
    const repo = local.connectedRepo;
    const baseBranch = local.workingBranch?.baseBranch ?? repo.defaultBranch ?? 'main';
    const trimmedVersion = args.version.trim().replace(/^v/, '');
    if (!trimmedVersion) {
      throw new Error('A version is required to create a tag.');
    }
    const tagName = `v${trimmedVersion}`;

    const token = await decryptSessionToken(local);
    const client = new GitHubClient();

    // Resolve the base branch HEAD — that's the commit we tag against.
    // (Always main, never the working branch — see fix scope #6.)
    const baseRef = await client.getRef(token, repo.owner, repo.name, baseBranch);
    const targetSha = baseRef.sha;

    // Detect existing tag of the same name. Without `override` we throw
    // so the UI can surface a typed-confirm toggle instead of silently
    // hitting GitHub's 422 "Reference already exists".
    const existingSha = await client.getTagSha(token, repo.owner, repo.name, tagName);
    if (existingSha !== null) {
      if (!args.override) {
        throw new Error(
          `Tag ${tagName} already exists at ${existingSha.slice(0, 7)}. ` +
            `Toggle "Override existing tag" to replace it, or pick a different version.`,
        );
      }
      // Override path: delete the old ref, then recreate against main HEAD.
      await client.deleteRef(token, repo.owner, repo.name, `tags/${tagName}`);
    }

    const tag = await client.createTag(token, repo.owner, repo.name, {
      tagName,
      sha: targetSha,
    });

    const result: { tagRef: string; sha: string; releaseUrl?: string } = {
      tagRef: tag.ref,
      sha: targetSha,
    };

    if (args.createGitHubRelease) {
      const parsed = parseSemver(trimmedVersion);
      const release = await client.createRelease(token, repo.owner, repo.name, {
        tagName,
        releaseName: tagName,
        body: args.notes ?? '',
        prerelease: parsed?.prerelease !== null && parsed?.prerelease !== undefined,
      });
      result.releaseUrl = release.htmlUrl;
    }

    return result;
  },

  listRepoTopics: async () => {
    const local = get().local;
    if (!local?.connectedRepo) {
      throw new Error('Connect a repo before reading its topics.');
    }
    const token = await decryptSessionToken(local);
    const client = new GitHubClient();
    return client.listRepoTopics(token, local.connectedRepo.owner, local.connectedRepo.name);
  },

  setRepoTopics: async (topics) => {
    const local = get().local;
    if (!local?.connectedRepo) {
      throw new Error('Connect a repo before editing its topics.');
    }
    // Normalize: lowercase, trim, dedupe, drop empties. GitHub rejects
    // anything not matching ^[a-z0-9][a-z0-9-]*$ — we let GitHub be the
    // strict validator and only do the trivial normalizations here.
    const normalized = Array.from(
      new Set(topics.map((t) => t.trim().toLowerCase()).filter((t) => t.length > 0)),
    );
    const token = await decryptSessionToken(local);
    const client = new GitHubClient();
    return client.setRepoTopics(
      token,
      local.connectedRepo.owner,
      local.connectedRepo.name,
      normalized,
    );
  },

  loadLatestUntaggedRelease: async () => {
    const local = get().local;
    if (!local?.connectedRepo) return null;
    const repo = local.connectedRepo;
    const baseBranch = local.workingBranch?.baseBranch ?? repo.defaultBranch ?? 'main';
    const token = await decryptSessionToken(local);
    const client = new GitHubClient();

    // Pull main's workspace.json — that's the authoritative ledger from
    // a consumer's perspective (anything in synced.releases.self that
    // hasn't been pushed-and-merged yet shouldn't be tag-able).
    const file = await client.getContents(
      token,
      repo.owner,
      repo.name,
      'workspace.json',
      baseBranch,
    );
    if (!file) return null;
    let parsed: { releases?: { self?: { versions?: Array<{ version: string; notes?: string }> } } };
    try {
      parsed = JSON.parse(file.content) as typeof parsed;
    } catch {
      return null;
    }
    const versions = parsed.releases?.self?.versions ?? [];
    if (versions.length === 0) return null;

    const sorted = [...versions]
      .map((v) => v.version)
      .filter((v): v is string => typeof v === 'string' && v.length > 0);
    const sortedDesc = sortVersionsDesc(sorted);

    // Walk from latest to oldest, return the first one whose tag isn't
    // already on the repo. When every version is already tagged we
    // return null — the modal renders an empty state. Surfacing the
    // override path proactively confuses users (they see "Override
    // v2.3.0" when v2.3.0 was just released and there's nothing new to
    // do). Retagging is a rare advanced case; if it becomes a real ask
    // we can add a separate "retag…" affordance.
    for (const version of sortedDesc) {
      const existingSha = await client.getTagSha(token, repo.owner, repo.name, `v${version}`);
      if (existingSha === null) {
        const meta = versions.find((v) => v.version === version);
        return {
          version,
          notes: meta?.notes ?? '',
          existingTagSha: null,
        };
      }
    }
    return null;
  },

  deprecateRelease: (version) => {
    // Capture before mutating releases.self so the user can recover the
    // pre-deprecate state if the version flag was changed by mistake.
    get().captureSnapshot({ trigger: 'pre-deprecate', note: `Before deprecate v${version}` });
    commitSynced(set, get, (s) => deprecateReleaseAction(s, version));
  },

  yankRelease: (version) => {
    // Yank rewrites the version's `yanked: true` flag — destructive enough
    // that we want the snapshot in case the user wants to roll back.
    get().captureSnapshot({ trigger: 'pre-yank', note: `Before yank v${version}` });
    commitSynced(set, get, (s) => yankReleaseAction(s, version));
  },

  linkPrivateWorkspace: async (args) => doLinkWorkspace(set, get, { ...args, kind: 'private' }),

  linkPublicWorkspace: async (args) => doLinkWorkspace(set, get, { ...args, kind: 'public' }),

  searchMarketplace: async (query) => {
    const local = get().local;
    if (!local) throw new Error('Workspace not ready');
    // Marketplace search runs anonymously when the user has no GitHub
    // session — discovery shouldn't require a PAT. The token, when
    // present, only lifts GitHub's anonymous rate limits.
    const token = await tryDecryptSessionToken(local);
    const client = new GitHubClient();
    return client.searchMarketplaceRepos(token, query);
  },

  listAccessibleRepos: async (opts) => {
    const local = get().local;
    if (!local) throw new Error('Workspace not ready');
    const token = opts?.tokenOverride?.trim() || (await decryptSessionToken(local));
    const client = new GitHubClient();
    return client.listAccessibleRepos(token);
  },

  listRepoBranches: async (owner, name, opts) => {
    const local = get().local;
    if (!local) throw new Error('Workspace not ready');
    const token = opts?.tokenOverride?.trim() || (await decryptSessionToken(local));
    const client = new GitHubClient();
    return client.listBranches(token, owner.trim(), name.trim());
  },

  probeLinkedRepoVersions: async (owner, name, branch, opts) => {
    const local = get().local;
    if (!local) throw new Error('Workspace not ready');
    const token = opts?.tokenOverride?.trim() || (await decryptSessionToken(local));
    const client = new GitHubClient();
    const file = await client.getContents(
      token,
      owner.trim(),
      name.trim(),
      'workspace.json',
      branch.trim(),
    );
    if (file === null) return null;
    // parseLinkedWorkspaceJson surfaces typed errors for malformed JSON
    // — let those propagate so the modal can render a useful message.
    const parsed = parseLinkedWorkspaceJson(file.content);
    const ledger = parsed.releases?.self ?? null;

    // Surface every slot the source declared in `secretKeys`. We used to
    // filter this down to slots referenced by an `encrypted: true`
    // variable, but that walk is fragile — a binding gap (variable
    // missing `secretKeyId`, an older push that pre-dates the field,
    // etc.) made declared slots silently invisible to consumers. Now we
    // show all declared slots; users can leave irrelevant ones blank.
    const requiredSecretKeys: SecretKeyMeta[] = parsed.secretKeys
      ? Object.values(parsed.secretKeys)
      : [];

    return {
      // The probe used to surface the source's workspaceName here; that
      // field no longer lives in the synced doc, so the caller displays
      // the repo path as the source's friendly identifier instead.
      repoFullName: `${owner.trim()}/${name.trim()}`,
      versions: (ledger?.versions ?? []).map((v) => v.version),
      currentVersion: ledger?.currentVersion ?? null,
      requiredSecretKeys,
    };
  },

  activeLinkedUpdate: null,

  previewLinkedUpdateForLink: async (id) => {
    const local = get().local;
    const synced = get().synced;
    if (!local || !synced) throw new Error('Workspace not ready');
    const link = synced.linkedWorkspaces[id];
    if (!link) throw new Error(`Linked workspace ${id} not found`);

    const token = await decryptLinkSessionToken(local, link);
    const client = new GitHubClient();
    const [owner, name] = link.source.repoFullName.split('/', 2);
    // Always fetch HEAD of the source branch — that's the source's
    // currently-published view. (Targeting a specific historical version
    // would need git tags / commit refs, deferred to a follow-on slice.)
    const file = await client.getContents(token, owner, name, 'workspace.json', link.source.branch);
    if (file === null) {
      throw new Error(
        `workspace.json missing on ${link.source.repoFullName}@${link.source.branch}`,
      );
    }
    const parsed = parseLinkedWorkspaceJson(file.content);
    const targetSnapshot = buildLinkedSnapshot(parsed, link);
    if (!targetSnapshot) {
      throw new Error(
        `Source ${link.source.repoFullName}@${link.source.branch} has no collections or environments to preview.`,
      );
    }
    const targetVersion = parsed.releases?.self?.currentVersion ?? targetSnapshot.ref;
    const baseSnapshot = local.linkedCollections[id] ?? null;

    const requestOverrides = Object.values(synced.linkedOverrides.requests).filter(
      (o) => o.linkedWorkspaceId === id,
    );
    const envVarOverrides = Object.values(synced.linkedOverrides.environmentVars).filter(
      (o) => o.linkedWorkspaceId === id,
    );

    const preview = previewLinkedUpdateCore({
      fromVersion: link.pinnedVersion,
      toVersion: targetVersion,
      base: baseSnapshot,
      target: targetSnapshot,
      requestOverrides,
      envVarOverrides,
    });
    set({ activeLinkedUpdate: { linkedWorkspaceId: id, preview } });
  },

  clearLinkedUpdatePreview: () => set({ activeLinkedUpdate: null }),

  applyLinkedUpdateForLink: async (resolutions) => {
    const state = get();
    const active = state.activeLinkedUpdate;
    const synced = state.synced;
    const local = state.local;
    if (!active || !synced || !local) return;
    const link = synced.linkedWorkspaces[active.linkedWorkspaceId];
    if (!link) {
      set({ activeLinkedUpdate: null });
      return;
    }

    // Linked update apply mutates synced.linkedOverrides + may adopt
    // upstream changes. Capture pre-state so the user can roll back if
    // the merge resolutions were wrong.
    get().captureSnapshot({
      trigger: 'pre-linked-update',
      note: `Before linked-update apply for ${link.source.repoFullName}`,
    });

    const baseSnapshot = local.linkedCollections[active.linkedWorkspaceId] ?? null;
    // Re-fetch the target — between preview and apply, the source could
    // have moved. Refetching here keeps the apply honest. Routes through
    // the link's bound session (workspace or dedicated) per sessionMode.
    const token = await decryptLinkSessionToken(local, link);
    const client = new GitHubClient();
    const [owner, name] = link.source.repoFullName.split('/', 2);
    const file = await client.getContents(token, owner, name, 'workspace.json', link.source.branch);
    if (file === null) {
      throw new Error(
        `workspace.json missing on ${link.source.repoFullName}@${link.source.branch}`,
      );
    }
    const parsed = parseLinkedWorkspaceJson(file.content);
    const targetSnapshot = buildLinkedSnapshot(parsed, link);
    if (!targetSnapshot) {
      throw new Error('Source has no content to apply.');
    }
    const targetVersion = parsed.releases?.self?.currentVersion ?? active.preview.toVersion;

    const requestOverridesForLink = Object.values(synced.linkedOverrides.requests).filter(
      (o) => o.linkedWorkspaceId === active.linkedWorkspaceId,
    );
    const envVarOverridesForLink = Object.values(synced.linkedOverrides.environmentVars).filter(
      (o) => o.linkedWorkspaceId === active.linkedWorkspaceId,
    );

    const result = applyLinkedUpdateCore({
      base: baseSnapshot,
      target: targetSnapshot,
      preview: active.preview,
      resolutions,
      requestOverrides: requestOverridesForLink,
      envVarOverrides: envVarOverridesForLink,
    });

    // Build the next request overrides map: keep entries from OTHER links,
    // replace this link's entries with the post-apply set.
    const nextRequestOverrides: WorkspaceSynced['linkedOverrides']['requests'] = {};
    for (const [k, v] of Object.entries(synced.linkedOverrides.requests)) {
      if (v.linkedWorkspaceId !== active.linkedWorkspaceId) nextRequestOverrides[k] = v;
    }
    for (const o of result.nextRequestOverrides) {
      nextRequestOverrides[`${o.linkedWorkspaceId}:${o.itemId}`] = o;
    }

    const nextEnvVarOverrides: WorkspaceSynced['linkedOverrides']['environmentVars'] = {};
    for (const [k, v] of Object.entries(synced.linkedOverrides.environmentVars)) {
      if (v.linkedWorkspaceId !== active.linkedWorkspaceId) nextEnvVarOverrides[k] = v;
    }
    for (const o of result.nextEnvVarOverrides) {
      nextEnvVarOverrides[`${o.linkedWorkspaceId}:${o.envName}:${o.varKey}`] = o;
    }

    const cachedLedger: ReleaseHistory = parsed.releases?.self ?? {
      versions: [],
      currentVersion: null,
    };
    const nextSynced: WorkspaceSynced = {
      ...synced,
      linkedWorkspaces: {
        ...synced.linkedWorkspaces,
        [active.linkedWorkspaceId]: { ...link, pinnedVersion: targetVersion },
      },
      linkedOverrides: {
        requests: nextRequestOverrides,
        environmentVars: nextEnvVarOverrides,
      },
      releases: {
        ...synced.releases,
        perLink: {
          ...synced.releases.perLink,
          [active.linkedWorkspaceId]: cachedLedger,
        },
      },
      meta: { ...synced.meta, updatedAt: new Date().toISOString() },
    };
    const nextLocal: WorkspaceLocal = {
      ...local,
      linkedCollections: {
        ...local.linkedCollections,
        [active.linkedWorkspaceId]: result.nextSnapshot,
      },
    };
    set({ synced: nextSynced, local: nextLocal, activeLinkedUpdate: null });
    queueSaveSynced(nextSynced);
    queueSaveLocal(nextLocal);
  },

  refreshLinkedWorkspace: async (id) => {
    const local = get().local;
    const synced = get().synced;
    if (!local || !synced) throw new Error('Workspace not ready');
    const link = synced.linkedWorkspaces[id];
    if (!link) throw new Error(`Linked workspace ${id} not found`);

    // Refresh = LEDGER ONLY (steady state). The user's mental model:
    //   - "Refresh" pulls metadata so the user can see what's been
    //     published upstream.
    //   - "Update Available" badge = pin lags ledger.currentVersion.
    //   - "Apply update" is the only path that touches the cached
    //     content snapshot (and bumps the pin).
    //
    // EXCEPTION: bootstrap. When this consumer has no cached snapshot
    // yet (fresh clone — `local.linkedCollections[id]` is missing),
    // there's nothing to "preserve against an upcoming diff" — the
    // user can't review or apply an update against an empty baseline.
    // In that case Refresh ALSO populates the snapshot from the same
    // workspace.json fetch. Steady-state refreshes (snapshot exists)
    // remain ledger-only.
    const token = await decryptLinkSessionToken(local, link);
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
    set({ synced: next });
    queueSaveSynced(next);

    // Bootstrap path: snapshot is missing → populate it now from the
    // same parsed payload. Doesn't touch the pin (that's still
    // metadata-only); just gives the consumer a non-empty baseline so
    // requests/envs render and future Apply Updates have something to
    // diff against.
    if (!local.linkedCollections[id]) {
      const snapshot = buildLinkedSnapshot(parsed, link);
      if (snapshot) {
        const nextLocal: WorkspaceLocal = {
          ...local,
          linkedCollections: { ...local.linkedCollections, [id]: snapshot },
        };
        set({ local: nextLocal });
        queueSaveLocal(nextLocal);
      }
    }
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
    queueSaveSynced(next);
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
    queueSaveSynced(next);
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
    queueSaveSynced(next);
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
    // Drop the cached collections snapshot AND any dedicated linking
    // session for this link — the session is no longer reachable from
    // the UI once the link is gone.
    let nextLocal = local;
    if (local) {
      const linkSession = local.sessions.github.links[id];
      const hasSnapshot = !!local.linkedCollections[id];
      if (linkSession || hasSnapshot) {
        const linkedCollections = { ...local.linkedCollections };
        delete linkedCollections[id];
        const links = { ...local.sessions.github.links };
        delete links[id];
        nextLocal = {
          ...local,
          linkedCollections,
          sessions: { github: { ...local.sessions.github, links } },
        };
      }
      // The dedicated session's IDB payload also needs to be purged so
      // it doesn't outlive the link.
      if (linkSession?.tokenSecretId) {
        void deleteSecretPayload(linkSession.tokenSecretId);
      }
    }
    if (nextLocal !== local && nextLocal) {
      set({ synced: next, local: nextLocal });
      queueSaveSynced(next);
      queueSaveLocal(nextLocal);
    } else {
      set({ synced: next });
      queueSaveSynced(next);
    }
  },

  addLinkSession: async (linkedWorkspaceId, token) => {
    const local = get().local;
    const synced = get().synced;
    if (!local || !synced) throw new Error('Workspace not ready');
    const link = synced.linkedWorkspaces[linkedWorkspaceId];
    if (!link) throw new Error(`Linked workspace ${linkedWorkspaceId} not found`);
    const trimmed = token.trim();
    if (!trimmed) throw new Error('Token is required');

    // Verify the PAT before storing — surfaces the same MissingScopeError
    // / UnauthorizedError signals the workspace-session connect uses, so
    // the link card can show a precise reason on failure.
    const client = new GitHubClient();
    const { viewer, scopes } = await client.getViewer(trimmed);

    // Rotate over any existing dedicated session: replace the ciphertext
    // under the existing tokenSecretId when the link already had one
    // (keeps the secret-vault index stable), otherwise mint a fresh id.
    const existing = local.sessions.github.links[linkedWorkspaceId];
    const tokenSecretId = existing?.tokenSecretId ?? generateId();
    const masterKey = await getMasterKey();
    const payload = await encryptString(trimmed, masterKey);
    await putSecretPayload(tokenSecretId, payload);

    const session: GitHubSession = {
      accountLogin: viewer.login,
      tokenSecretId,
      grantedScopes: scopes.granted,
      addedAt: existing?.addedAt ?? new Date().toISOString(),
      lastVerifiedAt: new Date().toISOString(),
      canCreatePullRequests: null,
    };

    // Stamp the dedicated session and flip the link's mode in one pass.
    const nextLocal: WorkspaceLocal = {
      ...local,
      sessions: {
        github: {
          ...local.sessions.github,
          links: { ...local.sessions.github.links, [linkedWorkspaceId]: session },
        },
      },
    };
    const currentMode = link.source.sessionMode ?? 'workspace';
    const nextSynced: WorkspaceSynced =
      currentMode === 'dedicated'
        ? synced
        : {
            ...synced,
            linkedWorkspaces: {
              ...synced.linkedWorkspaces,
              [linkedWorkspaceId]: {
                ...link,
                source: { ...link.source, sessionMode: 'dedicated' },
              },
            },
            meta: { ...synced.meta, updatedAt: new Date().toISOString() },
          };

    set({ local: nextLocal, synced: nextSynced });
    queueSaveLocal(nextLocal);
    if (nextSynced !== synced) queueSaveSynced(nextSynced);
    return session;
  },

  removeLinkSession: async (linkedWorkspaceId) => {
    const local = get().local;
    if (!local) return;
    const session = local.sessions.github.links[linkedWorkspaceId];
    if (!session) return;
    await deleteSecretPayload(session.tokenSecretId);
    const links = { ...local.sessions.github.links };
    delete links[linkedWorkspaceId];
    const next: WorkspaceLocal = {
      ...local,
      sessions: { github: { ...local.sessions.github, links } },
    };
    set({ local: next });
    queueSaveLocal(next);
  },

  setLinkSessionMode: async (linkedWorkspaceId, mode) => {
    const synced = get().synced;
    const local = get().local;
    if (!synced || !local) return;
    const link = synced.linkedWorkspaces[linkedWorkspaceId];
    if (!link) return;
    if (mode === 'dedicated' && !local.sessions.github.links[linkedWorkspaceId]) {
      throw new Error(
        'Add a linking session for this link first, then switch its mode to dedicated.',
      );
    }
    const currentMode = link.source.sessionMode ?? 'workspace';
    if (currentMode === mode) return;
    const next: WorkspaceSynced = {
      ...synced,
      linkedWorkspaces: {
        ...synced.linkedWorkspaces,
        [linkedWorkspaceId]: {
          ...link,
          source: { ...link.source, sessionMode: mode },
        },
      },
      meta: { ...synced.meta, updatedAt: new Date().toISOString() },
    };
    set({ synced: next });
    await saveSynced(next);
  },

  // --- Execution plans (P6) ----------------------------------------------

  setActivePlanId: (id) => set({ activePlanId: id }),

  addPlan: (name) => {
    const synced = get().synced;
    if (!synced) return '';
    const { synced: nextRaw, plan } = addPlanAction(synced, name);
    // Bump workspace-level meta.updatedAt — see commitSynced for the
    // rationale. Manual paths like this can't reuse commitSynced
    // because they also need to return the new plan id.
    const next: WorkspaceSynced = {
      ...nextRaw,
      meta: { ...nextRaw.meta, updatedAt: new Date().toISOString() },
    };
    set({ synced: next, activePlanId: plan.id });
    queueSaveSynced(next);
    return plan.id;
  },

  removePlan: (id) => {
    const synced = get().synced;
    const local = get().local;
    if (!synced) return;
    const nextRaw = removePlanAction(synced, id);
    if (nextRaw === synced) return;
    // Deleting a plan also drops any plan-run history rows for it —
    // those reference an id that no longer resolves. History stays
    // local; do this in a separate setLocal pass.
    const next: WorkspaceSynced = {
      ...nextRaw,
      meta: { ...nextRaw.meta, updatedAt: new Date().toISOString() },
    };
    const wasActive = get().activePlanId === id;
    set({ synced: next, ...(wasActive ? { activePlanId: null } : {}) });
    queueSaveSynced(next);
    if (local) {
      const planRuns = local.history.planRuns.filter((r) => r.planId !== id);
      if (planRuns.length !== local.history.planRuns.length) {
        const nextLocal: WorkspaceLocal = {
          ...local,
          history: { ...local.history, planRuns },
        };
        set({ local: nextLocal });
        queueSaveLocal(nextLocal);
      }
    }
  },

  renamePlan: (id, name) => commitSynced(set, get, (s) => renamePlanAction(s, id, name)),
  duplicatePlan: (planId) => {
    const synced = get().synced;
    if (!synced) return null;
    const { synced: nextRaw, plan } = duplicatePlanAction(synced, planId);
    if (!plan || nextRaw === synced) return null;
    const next: WorkspaceSynced = {
      ...nextRaw,
      meta: { ...nextRaw.meta, updatedAt: new Date().toISOString() },
    };
    set({ synced: next, activePlanId: plan.id });
    queueSaveSynced(next);
    return plan.id;
  },
  addPlanStep: (planId, requestId, linkedWorkspaceId) =>
    commitSynced(set, get, (s) => addPlanStepAction(s, planId, requestId, linkedWorkspaceId)),
  removePlanStep: (planId, stepIndex) =>
    commitSynced(set, get, (s) => removePlanStepAction(s, planId, stepIndex)),
  reorderPlanSteps: (planId, fromIndex, toIndex) =>
    commitSynced(set, get, (s) => reorderPlanStepsAction(s, planId, fromIndex, toIndex)),
  setPlanStepEnabled: (planId, stepIndex, enabled) =>
    commitSynced(set, get, (s) => setPlanStepEnabledAction(s, planId, stepIndex, enabled)),
  setPlanEnvPriority: (planId, priorityOrder) =>
    commitSynced(set, get, (s) => setPlanEnvPriorityAction(s, planId, priorityOrder)),
  setPlanStopOnFailure: (planId, stopOnAssertionFailure) =>
    commitSynced(set, get, (s) => setPlanStopOnFailureAction(s, planId, stopOnAssertionFailure)),
  setPlanVariables: (planId, variables) =>
    commitSynced(set, get, (s) => setPlanVariablesAction(s, planId, variables)),

  runPlan: async (planId, opts) => {
    const local = get().local;
    const synced = get().synced;
    if (!local || !synced) throw new Error('Workspace not ready');
    const plan = synced.executionPlans?.[planId];
    if (!plan) throw new Error(`Plan ${planId} not found`);

    const executionRequests: ExecutionAttachmentRequestRef[] = [];
    for (const step of plan.steps) {
      if (step.enabled === false) continue;
      const lookup = lookupPlanStepRequest(step, synced, local);
      if (!lookup.request) continue;
      executionRequests.push({
        request: lookup.request,
        source: step.linkedWorkspaceId ? 'linked-workspace' : 'workspace',
        ...(step.linkedWorkspaceId ? { linkedWorkspaceId: step.linkedWorkspaceId } : {}),
      });
    }
    const attachmentsReady = await ensureExecutionAttachmentsReady(set, get, {
      title: 'Download attachments before running this plan?',
      detail:
        'This plan includes requests that need file assets not available on this machine. Download them now to continue the run, or cancel execution.',
      requests: executionRequests,
    });
    if (!attachmentsReady) throw new Error('Execution cancelled.');

    // Concurrent-run guard: refuse to start a second run of the same
    // plan while the first is still in flight. The UI surfaces this as
    // a toast ("Plan already running"); we don't queue.
    if (inflightPlanRuns.has(planId)) throw new Error('plan already running');
    inflightPlanRuns.add(planId);
    // Register an AbortController so cancelExecutePlan can stop the loop
    // between steps (and abort the currently-fetching step's HTTP call).
    const controller = new AbortController();
    inflightAbortControllers.set(`plan:${planId}`, controller);
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
          envPriorityOrder?: readonly EnvPriorityRef[];
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
                globalAssets: lookup.linkedGlobalAssets ?? synced.globalAssets,
                collections: {
                  ...synced.collections,
                  folders: lookup.linkedFolders ?? {},
                },
              }
            : synced;
        // Bail out cleanly between steps if the plan was cancelled. The
        // currently-running step's fetch is also aborted via the signal
        // we pass into coreExecuteRequest below.
        if (controller.signal.aborted) break;
        const resolved = await resolveRequest(request, resolveSynced, get().local, planScope);
        const result = await coreExecuteRequest(resolved, {
          resolveAttachment: attachmentResolver,
          signal: controller.signal,
          authOptions: { onTokenRefreshed: makeTokenRefreshPersister(set, get, request.id) },
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
        queueSaveLocal(nextLocal);
      }
      return planRun;
    } finally {
      inflightPlanRuns.delete(planId);
      inflightAbortControllers.delete(`plan:${planId}`);
    }
  },

  syncAttachments: async () => {
    const local = get().local;
    const synced = get().synced;
    if (!local || !synced) throw new Error('Workspace not ready');
    const branch = local.workingBranch;

    const workspaceToken = await tryDecryptSessionToken(local);
    const client = new GitHubClient();
    let fetched = 0;
    let alreadyPresent = 0;
    let failed = 0;
    const cacheUpdates: Record<string, LocalAttachmentCacheEntry> = {};

    const syncSlot = async (
      slot: AttachmentSlotRefLike,
      source: {
        token: string;
        owner: string;
        name: string;
        ref: string;
        attachmentSource: 'workspace' | 'linked-workspace';
        linkedWorkspaceId?: string;
      },
    ): Promise<void> => {
      const markCached = (size: number): void => {
        cacheUpdates[slot.slotId] = {
          slotId: slot.slotId,
          filename: slot.filename ?? slot.slotId,
          mimeType: slot.mimeType ?? 'application/octet-stream',
          size,
          sha256: slot.sha256,
          localPath: `indexeddb://apicircle-attachments/${encodeURIComponent(slot.slotId)}`,
          storage: 'indexeddb',
          source: source.attachmentSource,
          ...(source.linkedWorkspaceId ? { linkedWorkspaceId: source.linkedWorkspaceId } : {}),
          requiredBy: slot.requiredBy,
          downloadedAt: new Date().toISOString(),
        };
      };
      // Skip when local already has bytes whose sha256 matches the synced ref.
      const existing = await getAttachment(slot.slotId);
      if (existing && (!slot.sha256 || (await sha256HexBytes(existing.bytes)) === slot.sha256)) {
        alreadyPresent++;
        markCached(existing.size);
        return;
      }
      try {
        const file = await client.getBinaryContents(
          source.token,
          source.owner,
          source.name,
          `.apicircle/attachments/${slot.slotId}`,
          source.ref,
        );
        if (!file) {
          failed++;
          return;
        }
        const actualSha = await sha256HexBytes(file.bytes);
        if (slot.sha256 && actualSha !== slot.sha256) {
          throw new Error(
            `Attachment ${slot.filename ?? slot.slotId} failed checksum verification.`,
          );
        }
        await putAttachment({
          slotId: slot.slotId,
          filename: slot.filename ?? slot.slotId,
          mimeType: slot.mimeType ?? 'application/octet-stream',
          size: file.bytes.length,
          // Trust the recorded sha256 for now; mismatch detection is a future
          // tightening (plan §7.6 mentions "surfaces tampering and corruption").
          sha256: slot.sha256 ?? actualSha,
          savedAt: new Date().toISOString(),
          bytes: file.bytes,
        });
        markCached(file.bytes.length);
        fetched++;
      } catch {
        failed++;
      }
    };

    const localSlots = dedupeAttachmentSlots([
      ...collectAttachmentSlotsFromCollections(synced.collections),
      ...collectAttachmentSlotsFromMockServers(synced.mockServers),
      ...collectAttachmentSlotsFromGlobalAssets(synced.globalAssets),
    ]);
    if (localSlots.length > 0) {
      if (!branch) throw new Error('Create a working branch before syncing workspace attachments');
      if (!workspaceToken) throw new Error('No GitHub session - connect a PAT first');
      for (const slot of localSlots) {
        await syncSlot(slot, {
          token: workspaceToken,
          owner: branch.repoOwner,
          name: branch.repoName,
          ref: branch.name,
          attachmentSource: 'workspace',
        });
      }
    }

    for (const [linkId, snapshot] of Object.entries(local.linkedCollections)) {
      const link = synced.linkedWorkspaces[linkId];
      if (!link) continue;
      const [owner, name] = link.source.repoFullName.split('/', 2);
      const linkToken = await decryptLinkSessionToken(local, link);
      const slots = dedupeAttachmentSlots([
        ...collectAttachmentSlotsFromCollections(snapshot.collections),
        ...collectAttachmentSlotsFromGlobalAssets(snapshot.globalAssets),
      ]);
      for (const slot of slots) {
        await syncSlot(slot, {
          token: linkToken,
          owner,
          name,
          ref: link.source.branch,
          attachmentSource: 'linked-workspace',
          linkedWorkspaceId: linkId,
        });
      }
    }
    if (Object.keys(cacheUpdates).length > 0) {
      const liveLocal = get().local;
      if (liveLocal) {
        const next: WorkspaceLocal = {
          ...liveLocal,
          attachmentCache: { ...(liveLocal.attachmentCache ?? {}), ...cacheUpdates },
        };
        set({ local: next });
        queueSaveLocal(next);
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

    // Pre-flight: check whether the branch is functionally over before
    // running the diff. Two paths trigger retirement here:
    //   - The PR opened from this branch was merged on GitHub
    //   - The branch ref was deleted out from under us (typical GitHub
    //     "delete branch on merge" behavior, or a manual cleanup)
    // Either way, there's nothing left to refresh against — drop the
    // working branch and surface a banner so the user creates a new one.
    const probe = await probeBranchRetirement(client, token, branch);
    const retired = decideRetirement(branch, probe);
    if (retired) {
      const next: WorkspaceLocal = {
        ...local,
        workingBranch: null,
        retiredBranch: retired,
        // Drop any stale first-pull prompt — it points at a branch we just
        // declared dead. firstPullPrompt is for new working branches.
        // (No-op if it was already null.)
      };
      set({ local: next, firstPullPrompt: null });
      queueSaveLocal(next);
      return { status: 'retired', retired };
    }

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

    // Phase 7: validate the remote shape AND strip prototype-pollution
    // keys before we merge it into anything. A malicious collaborator
    // pushing a workspace.json with `"__proto__": {…}` would otherwise
    // poison Object.prototype the next time we shallow-merge.
    let remote: WorkspaceSynced;
    try {
      remote = parseWorkspaceJson(file.content);
    } catch (err) {
      if (err instanceof RemoteWorkspaceParseError) {
        throw new Error(
          `Remote workspace.json could not be loaded (${err.code}): ${err.message}. ` +
            `The branch may have been written by an incompatible Studio version.`,
        );
      }
      throw err;
    }
    const base = local.sync.lastPulledSnapshot;
    const diff = computeThreeWayDiff(base, synced, remote);

    // Ancestry pre-flight: if we have a `lastPushedSha` baseline AND the
    // probe gave us the current remote HEAD, confirm the remote is a
    // descendant of our last pushed commit. Otherwise we'd be about to
    // merge across a history rewrite (force-push), which can silently
    // re-apply local edits on top of an upstream that intentionally
    // deleted them. The user must explicitly opt in via the resolver modal.
    //
    // We reuse `probe.branchHeadSha` to avoid a redundant `getRef` —
    // the probe already fetched the branch head for retirement detection.
    let historyRewritten = false;
    if (
      branch.lastPushedSha &&
      probe.branchHeadSha &&
      probe.branchHeadSha !== branch.lastPushedSha
    ) {
      try {
        const isAncestor = await client.isAncestor(
          token,
          branch.repoOwner,
          branch.repoName,
          branch.lastPushedSha,
          probe.branchHeadSha,
        );
        historyRewritten = !isAncestor;
      } catch {
        // Best-effort: a transient API failure here should not block the
        // user's refresh. Fall through to the standard 3-way path; the
        // baseline diff is still safer than nothing.
      }
    }

    if (historyRewritten) {
      // Never auto-merge across a rewrite. Surface a dedicated path so the
      // user can review the diff explicitly before adopting either side.
      set({ pendingRefresh: { diff, remote, remoteSha: file.sha, historyRewritten: true } });
      return { status: 'history-rewritten', diff };
    }

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
      queueSaveLocal(next);
      return { status: 'up-to-date' };
    }

    if (diff.conflicts.length === 0) {
      // No conflicts — auto-merge. Capture pre-merge so the user can
      // restore even when the merge looked clean (e.g. the remote moved
      // ahead in a way that drops local entries the user didn't expect).
      get().captureSnapshot({
        trigger: 'pre-merge',
        note: `Before auto-merge from ${branch.name}`,
      });
      const merged = applyMerge(synced, remote, diff, {});
      await persistMerged(set, get, merged, remote, file.sha);
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
    // Conflicting merge with user-resolved choices — definitely worth a
    // pre-merge snapshot so the user can roll back if the resolutions
    // turned out wrong.
    get().captureSnapshot({
      trigger: 'pre-merge',
      note: 'Before conflict-resolved merge',
    });
    const merged = applyMerge(synced, pending.remote, pending.diff, resolutions);
    await persistMerged(set, get, merged, pending.remote, pending.remoteSha);
    set({ pendingRefresh: null });
  },

  cancelRefresh: () => set({ pendingRefresh: null }),

  dismissRetiredBranch: () => {
    const local = get().local;
    if (!local || !local.retiredBranch) return;
    const next: WorkspaceLocal = { ...local, retiredBranch: null };
    set({ local: next });
    queueSaveLocal(next);
  },

  recheckRetiredBranch: async () => {
    const local = get().local;
    if (!local?.retiredBranch || !local.connectedRepo) {
      return { status: 'still-retired', reason: 'inconclusive' } as const;
    }
    const retired = local.retiredBranch;
    const repo = local.connectedRepo;
    let token: string;
    try {
      token = await decryptSessionToken(local);
    } catch (err) {
      return {
        status: 'error',
        message: err instanceof Error ? err.message : 'Could not decrypt session token',
      } as const;
    }
    const client = new GitHubClient();
    // Reconstruct the minimal WorkingBranch fields probeBranchRetirement needs.
    // PR url is preserved on the retirement record so the probe can re-check
    // PR state too — if the PR was reopened externally, we want to see it.
    const probeTarget: WorkingBranch = {
      name: retired.branchName,
      baseBranch: repo.defaultBranch,
      repoFullName: repo.fullName,
      repoOwner: repo.owner,
      repoName: repo.name,
      headSha: '',
      createdAt: retired.retiredAt,
      lastPushedSha: null,
      diffSummary: null,
      openPrUrl: retired.prUrl,
    };
    try {
      const probe = await probeBranchRetirement(client, token, probeTarget);
      // The branch is "revived" when it now exists AND any PR is no longer
      // in the merged state. We don't gate on prState because a deleted-
      // branch retirement can resurrect via a manual branch push.
      const branchAlive = probe.branchExists === true && probe.branchHeadSha !== null;
      const prStillMerged = probe.prState?.merged === true;
      if (branchAlive && !prStillMerged) {
        // Restore. lastPushedSha is null — we don't know what's changed on
        // the remote since retirement, so the first action should be a
        // refresh; the FirstPullPrompt would handle the actual review.
        const restored: WorkingBranch = {
          name: retired.branchName,
          baseBranch: repo.defaultBranch,
          repoFullName: repo.fullName,
          repoOwner: repo.owner,
          repoName: repo.name,
          headSha: probe.branchHeadSha!,
          createdAt: retired.retiredAt,
          lastPushedSha: null,
          diffSummary: null,
          openPrUrl: probe.prState?.state === 'open' ? retired.prUrl : null,
        };
        const next: WorkspaceLocal = {
          ...local,
          workingBranch: restored,
          retiredBranch: null,
        };
        set({ local: next });
        queueSaveLocal(next);
        return {
          status: 'restored',
          branchName: retired.branchName,
          headSha: probe.branchHeadSha!,
        } as const;
      }
      if (prStillMerged) {
        return { status: 'still-retired', reason: 'merged' } as const;
      }
      if (probe.branchExists === false) {
        return { status: 'still-retired', reason: 'deleted' } as const;
      }
      return { status: 'still-retired', reason: 'inconclusive' } as const;
    } catch (err) {
      return {
        status: 'error',
        message: err instanceof Error ? err.message : 'Probe failed',
      } as const;
    }
  },

  createPullRequest: async (args) => {
    const local = get().local;
    if (!local) throw new Error('Workspace not ready');
    const branch = local.workingBranch;
    if (!branch) throw new Error('Create a working branch first');
    if (!branch.lastPushedSha) {
      throw new Error('Push to save before opening a PR');
    }
    if (branch.openPrUrl) {
      throw new Error(`A pull request is already open for this branch: ${branch.openPrUrl}`);
    }

    const token = await decryptSessionToken(local);
    const client = new GitHubClient();
    const pr = await client.createPullRequest(token, branch.repoOwner, branch.repoName, {
      title: args?.title?.trim() || 'API Circle workspace updates',
      body: args?.body ?? '',
      head: branch.name,
      base: branch.baseBranch,
      draft: args?.draft ?? false,
    });

    const updatedBranch: WorkingBranch = { ...branch, openPrUrl: pr.htmlUrl };
    const next: WorkspaceLocal = { ...get().local!, workingBranch: updatedBranch };
    set({ local: next });
    queueSaveLocal(next);
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
    queueSaveLocal(next);
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
    queueSaveLocal(next);
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
    queueSaveLocal(next);
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
    queueSaveLocal(next);
  },

  executeLinkedActiveRequest: async () => {
    const state = get();
    const active = state.activeLinkedRequest;
    const synced = state.synced;
    const local = state.local;
    if (!active || !synced || !local) return;

    const lookup = lookupPlanStepRequest(
      { requestId: active.itemId, linkedWorkspaceId: active.linkedWorkspaceId },
      synced,
      local,
    );
    const request = lookup.request;
    if (!request) {
      // Surface the typed error on `lastRun` so the modal Send button can
      // render it the same way as a network failure.
      const errorResult: ExecutionResult = {
        startedAt: new Date().toISOString(),
        durationMs: 0,
        status: null,
        statusText: lookup.error ?? 'Linked request unavailable',
        ok: false,
        url: '',
        method: '—',
        headers: {},
        body: '',
        bodyKind: 'empty',
        error: lookup.error ?? 'Linked request unavailable',
        authWarnings: [],
      };
      set((s) => ({ lastRun: { ...s.lastRun, [active.itemId]: errorResult } }));
      return;
    }
    // Build a "virtual" synced doc that resolves against the source's
    // environments + folders so `auth.type === 'inherit'` walks the source
    // chain (not the consumer's, which doesn't know about the source).
    const resolveSynced: WorkspaceSynced =
      lookup.linkedEnvironments && lookup.linkedFolders
        ? {
            ...synced,
            environments: lookup.linkedEnvironments,
            globalAssets: lookup.linkedGlobalAssets ?? synced.globalAssets,
            collections: {
              ...synced.collections,
              folders: lookup.linkedFolders,
            },
          }
        : synced;

    const attachmentsReady = await ensureExecutionAttachmentsReady(set, get, {
      title: 'Download attachment before sending this linked request?',
      detail:
        'This linked request needs file assets from the source workspace that are not available on this machine. Download them now to continue, or cancel execution.',
      requests: [
        {
          request,
          source: 'linked-workspace',
          linkedWorkspaceId: active.linkedWorkspaceId,
        },
      ],
    });
    if (!attachmentsReady) return;

    // Register an AbortController under both the linked itemId AND the
    // source request.id so the EditorPanel's Cancel button (which keys by
    // request.id) and the legacy linked surface both work.
    const linkedController = new AbortController();
    inflightAbortControllers.set(active.itemId, linkedController);
    inflightAbortControllers.set(request.id, linkedController);
    set((s) => ({ isExecuting: { ...s.isExecuting, [active.itemId]: true } }));
    try {
      const resolved = await resolveRequest(request, resolveSynced, local);
      const result = await coreExecuteRequest(resolved, {
        resolveAttachment: attachmentResolver,
        signal: linkedController.signal,
        authOptions: { onTokenRefreshed: makeTokenRefreshPersister(set, get, request.id) },
      });
      const assertionResults = runAssertions(request.assertions, result);
      const run = buildRequestRun(resolved, result, assertionResults);
      const extractionResult =
        request.extractions && request.extractions.length > 0
          ? extractContext(result, request.extractions)
          : { extracted: {}, warnings: [] };

      const liveLocal = get().local;
      if (liveLocal) {
        const trimmed = [run, ...liveLocal.history.requestRuns].slice(0, MAX_REQUEST_RUNS);
        const next: WorkspaceLocal = {
          ...liveLocal,
          history: { ...liveLocal.history, requestRuns: trimmed },
          globalContext: { ...liveLocal.globalContext, ...extractionResult.extracted },
        };
        set({ local: next });
        queueSaveLocal(next);
      }
      set((s) => ({ lastRun: { ...s.lastRun, [active.itemId]: result } }));
    } catch (err) {
      const aborted = linkedController.signal.aborted;
      const message = aborted
        ? 'Request aborted.'
        : err instanceof Error
          ? err.message
          : String(err);
      set((s) => ({
        lastRun: {
          ...s.lastRun,
          [active.itemId]: {
            startedAt: new Date().toISOString(),
            durationMs: 0,
            status: null,
            ok: false,
            statusText: '',
            headers: {},
            body: '',
            bodyKind: 'empty',
            error: message,
            url: '',
            method: request.method,
            authWarnings: [],
          },
        },
      }));
    } finally {
      inflightAbortControllers.delete(active.itemId);
      inflightAbortControllers.delete(request.id);
      set((s) => ({ isExecuting: { ...s.isExecuting, [active.itemId]: false } }));
    }
  },

  executeActiveRequest: async () => {
    const state = get();
    const id = state.local?.ui.activeRequestId;
    const synced = state.synced;
    if (!id || !synced) return;
    const request = synced.collections.requests[id];
    if (!request) return;

    const attachmentsReady = await ensureExecutionAttachmentsReady(set, get, {
      title: 'Download attachment before sending this request?',
      detail:
        'This request needs file assets that are not available on this machine. Download them now to continue, or cancel execution.',
      requests: [{ request, source: 'workspace' }],
    });
    if (!attachmentsReady) return;

    // Allocate an AbortController and register it before kicking off
    // resolveRequest. cancelExecuteRequest looks the controller up by
    // request id and calls .abort(); the core executor honours the
    // signal and surfaces the abort as a thrown error, which we catch
    // and convert into a `lastRun` entry so the UI can show the
    // cancellation state instead of looking frozen.
    const controller = new AbortController();
    inflightAbortControllers.set(id, controller);
    set((s) => ({ isExecuting: { ...s.isExecuting, [id]: true } }));
    try {
      const resolved = await resolveRequest(request, synced, get().local);
      const result = await coreExecuteRequest(resolved, {
        resolveAttachment: attachmentResolver,
        signal: controller.signal,
        // Persist refreshed OAuth2 tokens so the next request doesn't
        // re-refresh. Without this hook applyAuth mints fresh tokens
        // per send — wasteful + a foot-gun for short-TTL refresh tokens.
        authOptions: { onTokenRefreshed: makeTokenRefreshPersister(set, get, id) },
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
        queueSaveLocal(next);
      }
      set((s) => ({ lastRun: { ...s.lastRun, [id]: result } }));
    } catch (err) {
      // Cancellation: synthesize a lastRun entry so the response panel
      // shows "Request aborted." instead of an indefinite spinner.
      const aborted = controller.signal.aborted;
      const message = aborted
        ? 'Request aborted.'
        : err instanceof Error
          ? err.message
          : String(err);
      set((s) => ({
        lastRun: {
          ...s.lastRun,
          [id]: {
            startedAt: new Date().toISOString(),
            durationMs: 0,
            status: null,
            ok: false,
            statusText: '',
            headers: {},
            body: '',
            bodyKind: 'empty',
            error: message,
            url: '',
            method: request.method,
            authWarnings: [],
          },
        },
      }));
    } finally {
      inflightAbortControllers.delete(id);
      set((s) => ({ isExecuting: { ...s.isExecuting, [id]: false } }));
    }
  },

  cancelExecuteRequest: (requestId) => {
    const controller = inflightAbortControllers.get(requestId);
    if (controller && !controller.signal.aborted) controller.abort();
  },

  cancelExecutePlan: (planId) => {
    const controller = inflightAbortControllers.get(`plan:${planId}`);
    if (controller && !controller.signal.aborted) controller.abort();
  },

  retryPlanStep: async (planId, stepIndex) => {
    const synced = get().synced;
    const local = get().local;
    if (!synced || !local) return;
    const plan = synced.executionPlans?.[planId];
    if (!plan) return;
    const step = plan.steps[stepIndex];
    if (!step || step.enabled === false) return;
    const lookup = lookupPlanStepRequest(step, synced, local);
    if (!lookup.request) return;
    const request = lookup.request;
    const planScope: {
      envPriorityOrder?: readonly EnvPriorityRef[];
      planVariables?: ReadonlyArray<{ key: string; value: string }>;
    } = {
      envPriorityOrder: plan.envPriorityOrder.length > 0 ? plan.envPriorityOrder : undefined,
      planVariables: plan.variables && plan.variables.length > 0 ? plan.variables : undefined,
    };
    const resolveSynced =
      step.linkedWorkspaceId && lookup.linkedEnvironments
        ? {
            ...synced,
            environments: lookup.linkedEnvironments,
            collections: { ...synced.collections, folders: lookup.linkedFolders ?? {} },
          }
        : synced;
    const attachmentsReady = await ensureExecutionAttachmentsReady(set, get, {
      title: 'Download attachment before retrying this step?',
      detail:
        'This plan step needs file assets that are not available on this machine. Download them now to retry the step, or cancel execution.',
      requests: [
        {
          request,
          source: step.linkedWorkspaceId ? 'linked-workspace' : 'workspace',
          ...(step.linkedWorkspaceId ? { linkedWorkspaceId: step.linkedWorkspaceId } : {}),
        },
      ],
    });
    if (!attachmentsReady) return;
    const resolved = await resolveRequest(request, resolveSynced, get().local, planScope);
    const result = await coreExecuteRequest(resolved, { resolveAttachment: attachmentResolver });
    const assertionResults = runAssertions(request.assertions, result);
    const allPassed = result.ok && assertionResults.every((a) => a.passed);

    // Splice the new result into lastPlanResults at the same index so the
    // PlanRunDetails view updates in place. The underlying RequestRun is
    // also appended to history so the user can find the retry alongside
    // the original.
    set((s) => {
      const existing = s.lastPlanResults[planId] ?? [];
      const updated = existing.slice();
      updated[stepIndex] = {
        result,
        assertionResults,
        passed: allPassed,
        requestName: request.name,
        requestMethod: request.method,
      };
      return { lastPlanResults: { ...s.lastPlanResults, [planId]: updated } };
    });

    const requestRun = buildRequestRun(resolved, result, assertionResults);
    const liveLocal = get().local;
    if (liveLocal) {
      const trimmed = [requestRun, ...liveLocal.history.requestRuns].slice(0, MAX_REQUEST_RUNS);
      const next: WorkspaceLocal = {
        ...liveLocal,
        history: { ...liveLocal.history, requestRuns: trimmed },
      };
      set({ local: next });
      queueSaveLocal(next);
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

    const attachmentsReady = await ensureExecutionAttachmentsReady(set, get, {
      title: 'Download attachment before replaying this request?',
      detail:
        'This replay needs file assets that are not available on this machine. Download them now to continue, or cancel execution.',
      requests: [{ request, source: 'workspace' }],
    });
    if (!attachmentsReady) return null;

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
        queueSaveLocal(next);
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
//
// `__apicircleFlushPersist` lets reload-persistence specs await the
// 250ms debounced IDB write before navigating. The production
// `beforeunload` listener fires `flushPendingPersist()` fire-and-forget;
// Chromium/WebKit commit the in-flight transaction during unload but
// Firefox aborts it — so a Firefox reload that's racing the debounce
// loses the most recent mutation. Test specs call this before reload to
// pin the boundary.
if (typeof window !== 'undefined') {
  const w = window as unknown as {
    __apicircleStore?: typeof useWorkspaceStore;
    __apicircleFlushPersist?: typeof flushPendingPersist;
  };
  w.__apicircleStore = useWorkspaceStore;
  w.__apicircleFlushPersist = flushPendingPersist;
}

type SetState = (
  partial: Partial<WorkspaceStore> | ((state: WorkspaceStore) => Partial<WorkspaceStore>),
) => void;
type GetState = () => WorkspaceStore;

async function collectMissingExecutionAttachments(
  get: GetState,
  refs: readonly ExecutionAttachmentRequestRef[],
): Promise<AttachmentDownloadPromptItem[]> {
  const cache = get().local?.attachmentCache ?? {};
  const items = new Map<string, AttachmentDownloadPromptItem>();

  for (const ref of refs) {
    for (const slot of collectAttachmentSlotsFromRequest(ref.request)) {
      const existing = await getAttachment(slot.slotId);
      if (existing && (!slot.sha256 || (await sha256HexBytes(existing.bytes)) === slot.sha256)) {
        continue;
      }

      const key = `${ref.source}:${ref.linkedWorkspaceId ?? ''}:${slot.slotId}`;
      const cached = cache[slot.slotId];
      const existingItem = items.get(key);
      if (existingItem) {
        for (const required of slot.requiredBy) {
          if (!existingItem.requiredBy.some((item) => item.requestId === required.requestId)) {
            existingItem.requiredBy.push(required);
          }
        }
        continue;
      }

      items.set(key, {
        slotId: slot.slotId,
        sha256: slot.sha256,
        filename: slot.filename ?? slot.slotId,
        mimeType: slot.mimeType ?? 'application/octet-stream',
        size: slot.size,
        source: ref.source,
        ...(ref.linkedWorkspaceId ? { linkedWorkspaceId: ref.linkedWorkspaceId } : {}),
        requiredBy: [...slot.requiredBy],
        ...(cached?.localPath ? { localPath: cached.localPath } : {}),
      });
    }
  }

  return [...items.values()];
}

function promptForAttachmentDownload(
  set: SetState,
  get: GetState,
  args: {
    title: string;
    detail: string;
    items: AttachmentDownloadPromptItem[];
  },
): Promise<boolean> {
  if (args.items.length === 0) return Promise.resolve(true);
  if (get().attachmentDownloadPrompt) return Promise.resolve(false);

  return new Promise((resolve) => {
    set({
      attachmentDownloadPrompt: {
        id: generateId(),
        title: args.title,
        detail: args.detail,
        items: args.items,
        resolve,
      },
    });
  });
}

async function ensureExecutionAttachmentsReady(
  set: SetState,
  get: GetState,
  args: {
    title: string;
    detail: string;
    requests: readonly ExecutionAttachmentRequestRef[];
  },
): Promise<boolean> {
  const missing = await collectMissingExecutionAttachments(get, args.requests);
  if (missing.length === 0) return true;

  const accepted = await promptForAttachmentDownload(set, get, {
    title: args.title,
    detail: args.detail,
    items: missing,
  });
  if (!accepted) return false;

  const remaining = await collectMissingExecutionAttachments(get, args.requests);
  if (remaining.length === 0) return true;

  get().pushToast({
    tone: 'error',
    title: 'Attachments still missing',
    detail:
      'Download did not complete for every file required by this execution. The request was not sent.',
  });
  return false;
}

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
  remote: WorkspaceSynced,
  remoteSha: string,
): Promise<void> {
  const local = get().local;
  if (!local) return;
  // The snapshot baseline tracks WHAT'S ON THE REMOTE BRANCH, not what we
  // merged locally. Storing `merged` here was the cause of "No unpushed
  // changes" appearing right after a pull whose merge picked any local-only
  // change — synced and the baseline would coincide so the diff returned
  // empty, even though the remote didn't have those local picks yet.
  // Using `remote` keeps the next `summarizeUnpushedChanges` honest: it
  // surfaces every divergence the next push needs to send.
  const nextLocal: WorkspaceLocal = {
    ...local,
    sync: {
      ...local.sync,
      lastPulledSnapshot: remote,
      lastPulledSha: remoteSha,
      lastPulledAt: new Date().toISOString(),
    },
  };
  set({ synced: merged, local: nextLocal });
  // Route through the debounce queue (then immediately flush) instead of
  // writing direct. If a prior action — e.g. restoreSnapshot before a
  // refresh — left stale `pendingSynced`/`pendingLocal` in the queue, a
  // direct write here would land first, then the stale flush (triggered
  // later by workspace switch / push / debounce timeout) would clobber
  // the merged state on disk. queueSaveBoth replaces the pending pair
  // with the merged one so the subsequent flush writes the correct state.
  queueSaveBoth(merged, nextLocal);
  await flushPendingPersist();

  // Bootstrap snapshots for any linkedWorkspaces that just arrived via
  // pull but have no local cached snapshot yet. Fixes the fresh-clone
  // scenario: a new workspace connecting to an existing repo would
  // otherwise see the link metadata but no requests/envs from the
  // source until the user manually clicks Refresh ledger on each card
  // — and even then the old behavior didn't populate the snapshot
  // (only the ledger), so the user was stuck.
  //
  // Best-effort: any individual link's bootstrap can fail (auth /
  // network / source 404); we don't block the pull on it. The link
  // card's "Refresh ledger" remains as a manual retry path.
  const refreshLinkedWorkspace = get().refreshLinkedWorkspace;
  for (const linkId of Object.keys(merged.linkedWorkspaces)) {
    if (!nextLocal.linkedCollections[linkId]) {
      try {
        await refreshLinkedWorkspace(linkId);
      } catch (err) {
        console.warn(`[refreshWorkspace] failed to bootstrap linked snapshot for ${linkId}:`, err);
      }
    }
  }
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
    /**
     * Which session credentials this link should use at fetch / refresh
     * time. Defaults to `'workspace'` so callers that don't specify keep
     * the pre-per-link behavior. When `'dedicated'`, `linkSessionToken`
     * MUST be supplied — it's verified against `GET /user`, encrypted,
     * and stored at `local.sessions.github.links[<linkId>]`.
     */
    sessionMode?: 'workspace' | 'dedicated';
    linkSessionToken?: string;
    /**
     * Optional map of `secretKeyId → plaintext value` to provision after
     * the link is created. The link wizard collects these alongside repo
     * + branch so users don't have to scroll down on the link card after
     * the fact. Each entry calls `provisionLinkedSecret` post-link;
     * empty values are skipped (the slot stays "missing" until later).
     */
    secretValues?: Record<string, string>;
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
  const sessionMode = args.sessionMode ?? 'workspace';

  // Allocate the link id up front — we need it both for keying the
  // dedicated session into `local.sessions.github.links` and for stamping
  // it onto the LinkedWorkspace entry below.
  const id = generateId();

  // Resolve the token to use for the source-fetch. For 'dedicated' we
  // also verify the token via /user and persist it under the link id, so
  // the link card's session badge can render scopes + account info on
  // first load without a separate verify roundtrip.
  let token: string;
  let dedicatedSession: GitHubSession | null = null;
  let dedicatedTokenSecretId: string | null = null;
  if (sessionMode === 'dedicated') {
    const provided = args.linkSessionToken?.trim();
    if (!provided) {
      throw new Error('Dedicated session requires a PAT for the linking-session step.');
    }
    const verifier = new GitHubClient();
    const { viewer, scopes } = await verifier.getViewer(provided);
    dedicatedTokenSecretId = generateId();
    const masterKey = await getMasterKey();
    const payload = await encryptString(provided, masterKey);
    await putSecretPayload(dedicatedTokenSecretId, payload);
    dedicatedSession = {
      accountLogin: viewer.login,
      tokenSecretId: dedicatedTokenSecretId,
      grantedScopes: scopes.granted,
      addedAt: new Date().toISOString(),
      lastVerifiedAt: new Date().toISOString(),
      // Linking sessions are read-only by intent — PR creation isn't part
      // of their job. Leave this as null so the UI doesn't claim a
      // capability we never probed for.
      canCreatePullRequests: null,
    };
    token = provided;
  } else if (args.kind === 'public') {
    token = (await tryDecryptSessionToken(local)) ?? '';
  } else {
    token = await decryptSessionToken(local);
  }

  const client = new GitHubClient();
  let file: { content: string } | null;
  try {
    file = await client.getContents(token, owner, name, 'workspace.json', trimmedBranch);
  } catch (err) {
    // If the dedicated path failed, the orphan payload we just stored
    // must be cleaned up so it doesn't leak into the vault on a retry.
    if (dedicatedTokenSecretId) {
      try {
        await deleteSecretPayload(dedicatedTokenSecretId);
      } catch {
        /* swallow cleanup error */
      }
    }
    throw err;
  }
  if (file === null) {
    if (dedicatedTokenSecretId) {
      try {
        await deleteSecretPayload(dedicatedTokenSecretId);
      } catch {
        /* swallow cleanup error */
      }
    }
    throw new Error(`workspace.json not found on ${trimmedRepo}@${trimmedBranch}`);
  }
  const parsed = parseLinkedWorkspaceJson(file.content);

  // Seed `requiredSecretKeyIds` with every slot the source declared.
  // Mirroring the registry directly is more robust than walking env
  // vars: a missing or stale `secretKeyId` on a variable would
  // otherwise silently drop slots from the consumer's required list.
  // Consumers can still remove unused slots from the link card later.
  const seededRequiredKeys: string[] = parsed.secretKeys ? Object.keys(parsed.secretKeys) : [];

  const link: LinkedWorkspace = {
    id,
    kind: args.kind,
    // The linked source no longer ships a workspace name in workspace.json
    // — names are per-machine. Use the repo path as the link's default
    // display label; the consumer can rename their local entry later.
    name: trimmedRepo,
    source: {
      provider: 'github',
      repoFullName: trimmedRepo,
      branch: trimmedBranch,
      sessionMode,
    },
    scope: ['collections', 'environments'],
    pinnedVersion: args.pinnedVersion ?? parsed.releases?.self?.currentVersion ?? null,
    updatePolicy: 'manual',
    linkedAt: new Date().toISOString(),
    requiredSecretKeyIds: seededRequiredKeys,
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
  const baseLocal: WorkspaceLocal = snapshot
    ? { ...local, linkedCollections: { ...local.linkedCollections, [id]: snapshot } }
    : local;
  // Stamp the dedicated session under the link id, if any.
  const nextLocal: WorkspaceLocal = dedicatedSession
    ? {
        ...baseLocal,
        sessions: {
          github: {
            ...baseLocal.sessions.github,
            links: { ...baseLocal.sessions.github.links, [id]: dedicatedSession },
          },
        },
      }
    : baseLocal;
  const localChanged = nextLocal !== local;
  set({ synced: next, ...(localChanged ? { local: nextLocal } : {}) });
  queueSaveSynced(next);
  if (localChanged) queueSaveLocal(nextLocal);

  // If the wizard collected slot values upfront, provision each one. We
  // run these AFTER the link is committed so the secretIndex entries
  // can correlate `linkedWorkspaceId === id`. A failed provision doesn't
  // unwind the link itself — the user can retry from the link card; the
  // slot just stays "missing" until they do.
  if (args.secretValues) {
    const provision = get().provisionLinkedSecret;
    for (const [keyId, value] of Object.entries(args.secretValues)) {
      const trimmed = value.trim();
      if (!trimmed) continue;
      try {
        await provision(id, keyId, trimmed);
      } catch (err) {
        console.warn(`[link] failed to provision secret ${keyId}:`, err);
      }
    }
  }

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
  linkedGlobalAssets?: WorkspaceSynced['globalAssets'];
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
  // The patch may carry any editable request field — fields it omits
  // inherit from the source. Identity / structural fields (id, folderId,
  // createdAt, updatedAt, schema refs) are not in the patch type so they
  // always come from the source.
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
  // Spread the patch over the base — any field present in the patch
  // replaces; absent fields inherit. Body / auth / pathParams / cookies
  // are object-shaped so a present value replaces wholesale (the user's
  // edited body is the entire body, not a deep-merged sub-tree).
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

/**
 * Project the linked workspace's environments through the consumer's
 * per-variable overrides for that link. Three composition rules per row:
 *
 *   1. Override has `removed: true` → drop the source variable.
 *   2. Override has a value/encrypted/secretKeyId → replace those fields
 *      on the existing source variable, keeping its position.
 *   3. Override targets a varKey that doesn't exist in the source's env
 *      → append it as a new variable owned by the consumer.
 */
function applyEnvironmentOverrides(
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
    // Newly-introduced variables: present in overrides but absent in source.
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

function buildLinkedSnapshot(
  parsed: LinkedWorkspaceProbe,
  link: LinkedWorkspace,
): LinkedSnapshot | null {
  if (!parsed.collections && !parsed.environments) return null;
  return {
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
    // Cache the source's secretKeys registry so the link card can
    // render slot labels instead of raw ids. Falls through to undefined
    // when the source doesn't declare any.
    ...(parsed.secretKeys ? { secretKeys: parsed.secretKeys } : {}),
    ...(parsed.globalAssets ? { globalAssets: parsed.globalAssets } : {}),
  };
}

/**
 * Parse a linked workspace's `workspace.json`. Pulls releases.self and
 * the collections + environments we want to cache locally for
 * cross-workspace plan steps (P5.8). Leniency on missing keys: a
 * partially-malformed remote can still be linked; the caller checks
 * each field before relying on it.
 *
 * The workspace's display name is intentionally absent — names live in
 * each consumer's local registry, not in the git-tracked source doc.
 */
interface LinkedWorkspaceProbe {
  releases?: { self?: ReleaseHistory | null };
  collections?: WorkspaceSynced['collections'];
  environments?: WorkspaceSynced['environments'];
  /**
   * The slot metadata the source workspace declares. Consumers need to
   * provide values for every slot that's referenced by an encrypted env
   * variable they care about. The link wizard surfaces these as input
   * rows so values can be supplied at link-time instead of forcing the
   * user to scroll down on the link card after the fact.
   */
  secretKeys?: Record<string, SecretKeyMeta>;
  globalAssets?: WorkspaceSynced['globalAssets'];
}
// Forbidden JSON keys we drop at parse time — see `parseWorkspaceJson` in
// @apicircle/core for the full rationale. Mirrored here because the linked-
// workspace shape diverges from `WorkspaceSynced` (no schemaVersion, only
// a subset of fields) so we can't reuse the core parser directly.
const LINKED_FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function parseLinkedWorkspaceJson(text: string): LinkedWorkspaceProbe {
  // Same 16 MiB cap as parseWorkspaceJson — a hostile linked source could
  // otherwise stream gigabytes of nested junk.
  if (text.length > 16 * 1024 * 1024) {
    throw new Error('Remote workspace.json exceeds 16 MiB');
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text, (key: string, value: unknown) => {
      if (LINKED_FORBIDDEN_KEYS.has(key)) return undefined;
      return value;
    });
  } catch {
    throw new Error('Remote workspace.json is not valid JSON');
  }
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Remote workspace.json is not an object');
  }
  const obj = raw as Record<string, unknown>;
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
  const secretKeysValue = obj.secretKeys;
  const secretKeys =
    typeof secretKeysValue === 'object' && secretKeysValue !== null
      ? (secretKeysValue as Record<string, SecretKeyMeta>)
      : undefined;
  const globalAssetsValue = obj.globalAssets;
  const globalAssets =
    typeof globalAssetsValue === 'object' && globalAssetsValue !== null
      ? (globalAssetsValue as WorkspaceSynced['globalAssets'])
      : undefined;
  return { releases, collections, environments, secretKeys, globalAssets };
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
  const session = local.sessions.github.workspace;
  if (!session) throw new Error('No GitHub session — connect a PAT first');
  const payload = await getSecretPayload(session.tokenSecretId);
  if (!payload) throw new Error('Stored token is missing — reconnect to refresh');
  const masterKey = await getMasterKey();
  return decryptString(payload, masterKey);
}

/**
 * Resolve and decrypt the token a given LinkedWorkspace should use at link /
 * refresh time. Honors `link.source.sessionMode`:
 *
 *   - `'workspace'` → use `sessions.github.workspace` (the same PAT that
 *     pushes/pulls THIS workspace's repo).
 *   - `'dedicated'` → use the per-link session at
 *     `sessions.github.links[link.id]`.
 *
 * Throws a typed-message Error so callers can surface "Session missing —
 * reconnect or remap" without having to introspect the failure mode.
 */
async function decryptLinkSessionToken(
  local: WorkspaceLocal,
  link: LinkedWorkspace,
): Promise<string> {
  const mode = link.source.sessionMode ?? 'workspace';
  if (mode === 'workspace') {
    if (!local.sessions.github.workspace) {
      if (link.kind === 'public') return '';
      throw new Error(
        `Link "${link.name}" uses the workspace session — connect a PAT in Sessions to fetch it.`,
      );
    }
    return decryptSessionToken(local);
  }
  const linkSession = local.sessions.github.links[link.id];
  if (!linkSession) {
    throw new Error(
      `Link "${link.name}" needs its dedicated session re-added — open the link card to reconnect.`,
    );
  }
  const payload = await getSecretPayload(linkSession.tokenSecretId);
  if (!payload) {
    throw new Error(
      `Stored token for "${link.name}" is missing locally — reconnect the link's session.`,
    );
  }
  const masterKey = await getMasterKey();
  return decryptString(payload, masterKey);
}

// Variant for paths where missing-session is a normal, non-error state
// (e.g. anonymous marketplace search). Returns null instead of throwing
// when the user has no session.
/**
 * Public client id for the API Circle Studio GitHub OAuth App. Public-client
 * device flow exchanges no client_secret, so embedding the id in the bundle
 * is the documented setup — see GitHub's "OAuth Device Flow" docs. Override
 * with `VITE_GITHUB_OAUTH_CLIENT_ID` at build time to point a fork at its
 * own OAuth App.
 */
const DEFAULT_GITHUB_OAUTH_CLIENT_ID = 'Ov23lidibDgD8hoGFB67';

/**
 * Path that the dev server / Electron main proxies to `https://github.com`.
 * Browsers can't POST to `github.com/login/*` directly because GitHub
 * doesn't send CORS headers there; the proxy hop makes the request
 * same-origin and bypasses the preflight.
 */
const BROWSER_GITHUB_LOGIN_PROXY = '/_gh-oauth';

function resolveGitHubLoginBaseUrl(): string {
  if (typeof window === 'undefined') return 'https://github.com';
  return BROWSER_GITHUB_LOGIN_PROXY;
}

/**
 * Resolve the OAuth client id. Prefers the build-time env override (Vite or
 * Node test fallback); falls back to `DEFAULT_GITHUB_OAUTH_CLIENT_ID` so the
 * shipped binary works out of the box.
 */
function readOAuthClientId(): string {
  try {
    const meta = import.meta as { env?: Record<string, string | undefined> };
    const fromMeta = meta.env?.VITE_GITHUB_OAUTH_CLIENT_ID;
    if (fromMeta) return fromMeta;
  } catch {
    /* import.meta unavailable in some test envs */
  }
  if (typeof process !== 'undefined' && process.env?.VITE_GITHUB_OAUTH_CLIENT_ID) {
    return process.env.VITE_GITHUB_OAUTH_CLIENT_ID;
  }
  return DEFAULT_GITHUB_OAUTH_CLIENT_ID;
}

/** Promise-based delay that resolves early if the abort signal fires. */
async function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      cleanup();
      resolve();
    };
    function cleanup() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
    if (signal?.aborted) {
      cleanup();
      resolve();
    } else {
      signal?.addEventListener('abort', onAbort, { once: true });
    }
  });
}

async function tryDecryptSessionToken(local: WorkspaceLocal): Promise<string | null> {
  if (!local.sessions.github.workspace) return null;
  return decryptSessionToken(local);
}

/**
 * `true` when the editor's currently-active edit target is a linked request
 * AND the supplied `id` matches its itemId. Setters call this to decide
 * whether to route writes into `synced.linkedOverrides.requests` instead
 * of mutating `synced.collections.requests`.
 *
 * Returning false leaves the workspace path intact — same id can refer to
 * a workspace request when no linked-request edit session is active.
 */
function isLinkedActive(get: GetState, id: string): boolean {
  const active = get().activeLinkedRequest;
  return active !== null && active.itemId === id;
}

/**
 * Generic field-level router for linked-request edits. When the editor is
 * editing a linked request and the caller's id matches, build a single-field
 * patch on top of any existing override and persist via
 * `setLinkedRequestOverride` (which round-trips through Git). Returns true
 * if the call was handled — caller should skip its workspace fallback.
 *
 * Field is typed as a key of `RequestOverridePatch` so unsupported fields
 * (`bodySchemaId`, `graphqlSchemaId`) can't accidentally be routed here.
 */
function routeLinkedField<K extends keyof RequestOverridePatch>(
  get: GetState,
  _set: SetState,
  id: string,
  field: K,
  value: RequestOverridePatch[K],
): boolean {
  const active = get().activeLinkedRequest;
  if (!active || active.itemId !== id) return false;
  const synced = get().synced;
  if (!synced) return true; // suppress: state isn't ready, nothing to write
  const key = `${active.linkedWorkspaceId}:${active.itemId}`;
  const existing = synced.linkedOverrides.requests[key]?.patch ?? {};
  // Merge the single field into the existing patch. Empty patches are
  // no-ops; setLinkedRequestOverride clears the entry in that case.
  const nextPatch: RequestOverridePatch = { ...existing, [field]: value };
  get().setLinkedRequestOverride(active.linkedWorkspaceId, active.itemId, nextPatch);
  return true;
}

/**
 * Build an `onTokenRefreshed` callback bound to a specific requestId. The
 * core auth path calls this when applyAuth refreshes an OAuth2 access
 * token via the refresh_token grant. We patch the corresponding request's
 * auth payload (only the token-state fields — clientId, tokenUrl, etc.
 * are untouched) and persist via the debounced queue. Without this hook
 * applyAuth would refresh once, the new token lands on the wire for the
 * current send, and the next send sees the stale value in synced state
 * and refreshes again — wasteful AND it burns through refresh-token
 * rotation if the IdP issues a new refresh_token per use.
 *
 * Reads `get().synced` synchronously so the user's most-recent edits are
 * respected — applyAuth awaits this callback so a sync return is fine.
 */
function makeTokenRefreshPersister(
  set: SetState,
  get: GetState,
  requestId: string,
): NonNullable<AuthApplyOptions['onTokenRefreshed']> {
  return (_priorAuth, next) => {
    const synced = get().synced;
    if (!synced) return;
    const currentReq = synced.collections.requests[requestId];
    if (!currentReq) return;
    // Only the OAuth2 token-bearing variants carry these fields. The
    // type predicate keeps us from accidentally writing tokens onto a
    // non-OAuth2 auth that the user just switched to.
    if (
      currentReq.auth.type !== 'oauth2-client-credentials' &&
      currentReq.auth.type !== 'oauth2-auth-code' &&
      currentReq.auth.type !== 'oauth2-pkce' &&
      currentReq.auth.type !== 'oauth2-password' &&
      currentReq.auth.type !== 'oauth2-implicit' &&
      currentReq.auth.type !== 'oauth2-device'
    ) {
      return;
    }
    const refreshedAuth = {
      ...currentReq.auth,
      accessToken: next.accessToken,
      tokenType: next.tokenType,
      expiresAt: next.expiresAt,
      ...(next.refreshToken !== undefined ? { refreshToken: next.refreshToken } : {}),
      ...(next.obtainedScope !== undefined ? { obtainedScope: next.obtainedScope } : {}),
    };
    const updated: WorkspaceSynced = {
      ...synced,
      collections: {
        ...synced.collections,
        requests: {
          ...synced.collections.requests,
          [requestId]: { ...currentReq, auth: refreshedAuth },
        },
      },
    };
    set({ synced: updated });
    queueSaveSynced(updated);
  };
}

function commitSynced(
  set: SetState,
  get: GetState,
  reducer: (s: WorkspaceSynced) => WorkspaceSynced,
): void {
  const synced = get().synced;
  if (!synced) return;
  const reduced = reducer(synced);
  if (reduced === synced) return;
  // Centralize `meta.updatedAt` bumping here so every commit advances
  // the workspace-level stale-time, regardless of whether the reducer
  // remembered to do it. Idempotent for reducers that ALSO bump it
  // (editor + env reducers via core/applyMutation, envActions, etc.)
  // — the wrapper's timestamp wins, which is fine since it's later in
  // the same tick. Critical for plan reducers in planActions.ts which
  // only bump per-plan `updatedAt`; without this they'd leave the
  // workspace-level timestamp stale.
  const next: WorkspaceSynced = {
    ...reduced,
    meta: { ...reduced.meta, updatedAt: new Date().toISOString() },
  };
  set({ synced: next });
  queueSaveSynced(next);
  // Refresh the secret usedIn map whenever synced state moves; aggregator
  // is O(refs × secrets) and a no-op when nothing the secrets reference
  // changed, so this is cheap to do unconditionally.
  const local = get().local;
  if (local && Object.keys(local.secretIndex.entries).length > 0) {
    const updatedLocal = recomputeUsedIn(next, local);
    if (updatedLocal !== local) {
      set({ local: updatedLocal });
      queueSaveLocal(updatedLocal);
    }
  }
}

// `commitLocal` was removed when plan reducers moved to `commitSynced`
// (plans now travel through Git). Other local-only mutations use raw
// `set` + `saveLocal` paths — keep this comment as a breadcrumb in
// case a future feature wants the symmetry helper back.

/**
 * Resolve `{{var}}` placeholders inside an auth config's string fields.
 *
 * Every `RequestAuth` variant is a flat object of string-valued fields
 * (a Bearer token, a Basic username/password, an OAuth2 client secret,
 * an AWS access key, …) plus a handful of non-string discriminants /
 * enums (`type`, `addTo`, `algorithm`, `expiresAt`, `bindPayload`, …).
 * Without this step a `{{token}}` typed into the Bearer field would
 * reach the wire verbatim — URL/header/body fields are interpolated in
 * `resolveRequest` but `resolveInheritedAuth` only resolves folder
 * inheritance, never variable substitution.
 *
 * We map `resolveString` over every string property; non-string fields
 * pass through untouched, and enum-typed strings (which never contain
 * `{{`) are a harmless no-op.
 */
function resolveAuthVariables(auth: RequestAuth, scope: ResolutionScope): RequestAuth {
  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(auth)) {
    // `type` is the discriminant — never templated, keep it verbatim.
    resolved[key] =
      key !== 'type' && typeof value === 'string' ? resolveString(value, scope).value : value;
  }
  return resolved as unknown as RequestAuth;
}

/**
 * Apply variable substitution + secret decryption to a request before it
 * goes to the executor. URL, query params, headers, body content, auth
 * fields, and (for json/text/xml/graphql) the raw body string are all
 * resolved against the workspace scope (context vars > active env >
 * priority list > secrets).
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
    envPriorityOrder?: readonly EnvPriorityRef[];
    /**
     * Plan-level variables. Sit between request.contextVars and the env
     * priority list — they override an env value without mutating the
     * env. Last-wins on duplicate keys (consistent with env vars).
     */
    planVariables?: ReadonlyArray<{ key: string; value: string }>;
  },
): Promise<ApiRequest> {
  const vault = local ? await decryptVault(local) : { byLabel: {}, byId: {} };
  const secrets = vault.byLabel;

  // Plan-level priority overrides the workspace's global order when the
  // plan supplied a non-empty list (plan §6 P6 + §11.1 inline guidance).
  const refs: readonly EnvPriorityRef[] =
    overrides?.envPriorityOrder && overrides.envPriorityOrder.length > 0
      ? overrides.envPriorityOrder
      : synced.environments.priorityOrder;

  // Build a flat `Record<compositeKey, Record<varKey, plaintext>>` map
  // that mixes local and linked envs. Linked entries route through the
  // consumer's per-row overrides (linkedOverrides.environmentVars) before
  // decryption — so the priority layer sees the consumer's effective view
  // of the source's env.
  const localEnvs = await decryptEnvironments(
    synced.environments.items,
    vault.byId,
    synced.secretKeys ?? {},
  );
  const flatEnvs: Record<string, Record<string, string>> = {};
  for (const [name, vars] of Object.entries(localEnvs.items)) {
    flatEnvs[envPriorityKey({ kind: 'local', name })] = vars;
  }
  // Accumulate per-resolve decryption failures so the Environments panel
  // can light up a banner ("3 encrypted variables won't decrypt on this
  // device — re-enter their slot values or unbind"). The store action
  // commits this to `envDecryptFailures` after the resolver returns.
  const collectedFailures: EnvDecryptFailure[] = [...localEnvs.failures];
  // Eagerly fold in EVERY linked workspace's envs so the resolver's
  // autocomplete / suggestion paths see them too. Priority list controls
  // ordering; this just makes the names resolvable. Skips links whose
  // snapshot hasn't been pulled yet — they show up as missing on first
  // resolve, prompting a refresh.
  if (local) {
    for (const [linkId, snapshot] of Object.entries(local.linkedCollections)) {
      const overridden = applyEnvironmentOverrides(snapshot.environments, linkId, synced);
      const decrypted = await decryptEnvironments(
        overridden.items,
        vault.byId,
        synced.secretKeys ?? {},
      );
      for (const [envName, vars] of Object.entries(decrypted.items)) {
        flatEnvs[envPriorityKey({ kind: 'linked', linkedWorkspaceId: linkId, envName })] = vars;
      }
      // Tag linked-env failures with the link id so the banner can
      // disambiguate them from local-env failures (different surface to
      // fix in the UI). LinkedSnapshot doesn't carry a label; the link
      // id is stable + matchable to synced.linkedWorkspaces.
      for (const f of decrypted.failures) {
        collectedFailures.push({ ...f, envName: `linked:${linkId} :: ${f.envName}` });
      }
    }
  }
  // Push the accumulated failures into the store. We only WRITE when the
  // set is non-empty OR was previously non-empty (avoids triggering a
  // re-render on every clean resolve). Comparison is by JSON shape — the
  // list is small and structured, so deep-equal-via-stringify is fine.
  // `resolveRequest` is a free function (no closure over set/get), so we
  // reach the store via its module-level getState/setState.
  const prevFailuresJson = JSON.stringify(useWorkspaceStore.getState().envDecryptFailures ?? []);
  const nextFailuresJson = JSON.stringify(collectedFailures);
  if (prevFailuresJson !== nextFailuresJson) {
    useWorkspaceStore.setState({ envDecryptFailures: collectedFailures });
  }

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
  const priorityKeys = refs.map(envPriorityKey);
  const scope = buildScope({
    contextVars,
    environments: flatEnvs,
    // The "active env" concept is gone in favor of an ordered global layer —
    // priorityOrder is the sole list the resolver consults.
    activeEnvName: null,
    priorityOrder: priorityKeys,
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
  const inheritedAuth = resolveInheritedAuth({
    requestAuth: request.auth ?? { type: 'none' },
    folderId: request.folderId,
    folders: synced.collections.folders,
  });
  // Interpolate `{{var}}` placeholders in the auth's string fields —
  // resolveInheritedAuth only resolves folder inheritance, so a
  // `{{token}}` typed into a Bearer / Basic / API-key field would
  // otherwise reach the wire verbatim.
  const auth = resolveAuthVariables(inheritedAuth, scope);

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
 * Read a slot's plaintext value out of the local IDB vault. Returns `null`
 * when the slot id is missing on this device (typical post-clone state) or
 * when the master-key decrypt fails. The slot value is the user-supplied
 * input that PBKDF2 turns into the per-slot AES-GCM key.
 */
async function loadSlotPlaintext(id: string): Promise<string | null> {
  const payload = await getSecretPayload(id);
  if (!payload) return null;
  try {
    const masterKey = await getMasterKey();
    return await decryptString(payload, masterKey);
  } catch {
    return null;
  }
}

/**
 * Encrypt a plaintext under a secret-key slot's derived key. Resolves to
 * `null` when the slot value or salt is unavailable — caller should treat
 * that as "can't bind, tell the user to provide the slot value first."
 *
 * `metaOverride` lets the caller pass a pending SecretKeyMeta that hasn't
 * been committed to `synced.secretKeys` yet (used by `bindVariableToSecretKey`
 * when it lazily creates the slot record on first bind).
 */
async function tryEncryptForSlot(
  get: GetState,
  secretKeyId: string,
  plaintext: string,
  metaOverride?: SecretKeyMeta,
): Promise<string | null> {
  const synced = get().synced;
  if (!synced) return null;
  const meta = metaOverride ?? synced.secretKeys?.[secretKeyId];
  if (!meta) return null;
  const slotValue = await loadSlotPlaintext(secretKeyId);
  if (slotValue === null) return null;
  const key = await deriveKeyFromSlotValue(slotValue, meta.salt);
  const payload = await encryptString(plaintext, key);
  return serializePayload(payload);
}

/**
 * Decrypt an `enc:v1:` ciphertext using a slot's derived key. Resolves to
 * `null` for any failure (slot missing, slot value missing, salt missing,
 * malformed payload, AES-GCM auth tag mismatch).
 */
async function tryDecryptForSlot(
  get: GetState,
  secretKeyId: string,
  serialized: string,
): Promise<string | null> {
  const synced = get().synced;
  if (!synced) return null;
  const meta = synced.secretKeys?.[secretKeyId];
  if (!meta) return null;
  const payload = tryParsePayload(serialized);
  if (!payload) return null;
  const slotValue = await loadSlotPlaintext(secretKeyId);
  if (slotValue === null) return null;
  try {
    const key = await deriveKeyFromSlotValue(slotValue, meta.salt);
    return await decryptString(payload, key);
  } catch {
    return null;
  }
}

/**
 * Decrypt every vault entry available in this browser. Returns parallel
 * label→plaintext and id→plaintext maps. `byId` is keyed by slot id and
 * holds the slot's *plaintext value* — both the substrate for `{{LABEL}}`
 * substitution and the input for deriving the slot's encryption key.
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

/**
 * Per-row classification of why an encrypted env var failed to decrypt
 * (or — implicit "no failure" — succeeded). Surfaced via the resolver
 * so the Environments panel can show a precise, actionable banner
 * instead of the silent `<MISSING:LABEL>` substitution we used to do.
 *
 *   missing-slot-meta:   secretKeyId references a slot that doesn't
 *                        exist in synced.secretKeys (workspace data
 *                        damaged, or pulled mid-rename).
 *   missing-slot-value:  slot meta is present, but this device has no
 *                        plaintext for it yet (the most common case
 *                        post-pull / post-import). Covered by the
 *                        existing missing-slots gate — surfaced here
 *                        for completeness only.
 *   invalid-ciphertext:  row's `value` isn't a parseable enc:v1:...
 *                        payload (truncated, tampered, or never
 *                        encrypted).
 *   decrypt-failed:      everything else lined up but AES-GCM
 *                        rejected the unwrap — the slot value on this
 *                        device doesn't decrypt the row's ciphertext.
 *                        This is the case Phase 4 was added to
 *                        surface: a different value from the one used
 *                        to encrypt, or a salt mismatch.
 */
export type EnvDecryptFailureReason =
  | 'missing-slot-meta'
  | 'missing-slot-value'
  | 'invalid-ciphertext'
  | 'decrypt-failed';

export interface EnvDecryptFailure {
  envName: string;
  varKey: string;
  secretKeyId: string;
  label: string;
  reason: EnvDecryptFailureReason;
}

/**
 * Flatten encrypted env vars to plaintext for the resolver. Each row's
 * `value` carries `enc:v1:<iv>:<ciphertext>` produced by `tryEncryptForSlot`;
 * decryption requires the slot's plaintext value (from `vaultById`) and the
 * slot's salt (from `synced.secretKeys[id].salt`). When decryption can't
 * resolve we still substitute `<MISSING:LABEL>` (so the wire request
 * shows the user *where* the failure was), but we also accumulate a
 * structured `failures[]` so the store can light up a banner.
 */
async function decryptEnvironments(
  items: Record<string, Environment>,
  vaultById: Record<string, string>,
  secretKeys: Record<string, SecretKeyMeta>,
): Promise<{
  items: Record<string, Record<string, string>>;
  failures: EnvDecryptFailure[];
}> {
  const out: Record<string, Record<string, string>> = {};
  const failures: EnvDecryptFailure[] = [];
  // Cache derived keys per slot — same slot used N times in N env vars
  // shouldn't pay PBKDF2 N times.
  const derivedKeyCache = new Map<string, CryptoKey>();
  const deriveOnce = async (id: string, value: string, salt: string): Promise<CryptoKey> => {
    const cached = derivedKeyCache.get(id);
    if (cached) return cached;
    const key = await deriveKeyFromSlotValue(value, salt);
    derivedKeyCache.set(id, key);
    return key;
  };

  for (const [name, env] of Object.entries(items)) {
    const flat: Record<string, string> = {};
    for (const v of env.variables) {
      if (!v.key) continue;
      if (v.encrypted && v.secretKeyId) {
        const meta = secretKeys[v.secretKeyId];
        const slotValue = vaultById[v.secretKeyId];
        const labelForMissing = meta?.label ?? v.secretKeyId;
        if (!meta) {
          flat[v.key] = `<MISSING:${labelForMissing}>`;
          failures.push({
            envName: name,
            varKey: v.key,
            secretKeyId: v.secretKeyId,
            label: labelForMissing,
            reason: 'missing-slot-meta',
          });
          continue;
        }
        if (typeof slotValue !== 'string') {
          flat[v.key] = `<MISSING:${labelForMissing}>`;
          failures.push({
            envName: name,
            varKey: v.key,
            secretKeyId: v.secretKeyId,
            label: labelForMissing,
            reason: 'missing-slot-value',
          });
          continue;
        }
        const payload = tryParsePayload(v.value);
        if (!payload) {
          // Bound row with a non-cipher value — treat as missing rather
          // than silently passing a bad string to the wire.
          flat[v.key] = `<MISSING:${labelForMissing}>`;
          failures.push({
            envName: name,
            varKey: v.key,
            secretKeyId: v.secretKeyId,
            label: labelForMissing,
            reason: 'invalid-ciphertext',
          });
          continue;
        }
        try {
          const key = await deriveOnce(v.secretKeyId, slotValue, meta.salt);
          flat[v.key] = await decryptString(payload, key);
        } catch {
          // The high-value signal: everything was set up to decrypt but
          // AES-GCM unwrap failed. Either the slot's local plaintext is
          // wrong for this ciphertext, or salts diverged. Surface so the
          // banner tells the user to re-enter the slot value or unbind.
          flat[v.key] = `<MISSING:${labelForMissing}>`;
          failures.push({
            envName: name,
            varKey: v.key,
            secretKeyId: v.secretKeyId,
            label: labelForMissing,
            reason: 'decrypt-failed',
          });
        }
        continue;
      }
      flat[v.key] = v.value;
    }
    out[name] = flat;
  }
  return { items: out, failures };
}
