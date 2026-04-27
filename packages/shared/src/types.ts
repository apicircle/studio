// =============================================================================
// Workspace JSON schema — two documents
//
// `WorkspaceSynced` is serialized to a single `workspace.json` in the connected
// Git repo (working branch). Push-to-save only ever reads this document.
//
// `WorkspaceLocal` lives only in IndexedDB and is never pushed. Local edits,
// history, executions, working-branch metadata, secret index, sessions, and
// sync snapshots all live here so they can never leak into commits.
// =============================================================================

export type ThemeId =
  | 'studio-dark'
  | 'graphite-dark'
  | 'midnight-blue'
  | 'workbench-light'
  | 'paper-light'
  | 'high-contrast-dark';

// No 'settings' panel — Secret Vault and Theme moved to TopBar.
// No 'command' panel — feature dropped per revision #2.
export type PanelId =
  | 'workspace' // renamed from 'git'
  | 'link-workspace' // renamed from 'api-connections'
  | 'editor'
  | 'env'
  | 'execution'
  | 'history'
  | 'help';

// ---------------------------------------------------------------------------
// Synced document
// ---------------------------------------------------------------------------

export interface WorkspaceSynced {
  schemaVersion: 1;
  workspaceId: string;
  workspaceName: string;
  collections: {
    tree: FolderNode;
    requests: Record<string, Request>;
    folders: Record<string, Folder>;
  };
  environments: {
    items: Record<string, Environment>;
    activeName: string | null;
    priorityOrder: string[];
  };
  // Renamed from `apiConnections`. Each entry represents a workspace this one
  // links to (private session-bound or public marketplace).
  linkedWorkspaces: Record<string, LinkedWorkspace>;
  releases: {
    // This workspace's own release ledger — drives version updates without
    // depending on GitHub Actions / tag automation.
    self: ReleaseHistory | null;
    // Cached release history of each linked workspace, keyed by linkedWorkspaceId.
    perLink: Record<string, ReleaseHistory>;
  };
  meta: {
    createdAt: string;
    updatedAt: string;
    appVersion: string;
  };
}

export interface FolderNode {
  id: string;
  type: 'root' | 'folder';
  children: Array<{ kind: 'folder' | 'request'; id: string }>;
}

export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

export type BodyType =
  | 'none'
  | 'json'
  | 'text'
  | 'form-data'
  | 'urlencoded'
  | 'binary'
  | 'xml'
  | 'graphql';

export interface Request {
  id: string;
  name: string;
  folderId: string | null;
  method: HttpMethod;
  url: string;
  headers: Array<{ key: string; value: string; enabled: boolean }>;
  query: Array<{ key: string; value: string; enabled: boolean }>;
  body: RequestBody;
  contextVars: Array<{ key: string; value: string }>;
  assertions: Assertion[];
  createdAt: string;
  updatedAt: string;
}

// Body content. For text-shaped types (json/text/xml/graphql/urlencoded)
// the payload is `content` (string). For form-data the rows describe each
// field — text rows carry their own value, file rows reference an
// attachment by slotId. For binary the whole body is a single attachment.
//
// Attachments themselves (the actual blobs + filename/mimeType) live only
// in the local IndexedDB `attachments` store; the synced doc only carries
// the slotId reference plus minimal display metadata. Blobs never round-
// trip through Git.
export interface RequestBody {
  type: BodyType;
  content: string;
  formRows?: FormDataRow[];
  attachment?: AttachmentRef;
}

export type FormDataRow =
  | { kind: 'text'; key: string; value: string; enabled: boolean }
  | {
      kind: 'file';
      key: string;
      slotId: string | null;
      filename?: string;
      size?: number;
      mimeType?: string;
      enabled: boolean;
    };

export interface AttachmentRef {
  slotId: string | null;
  filename?: string;
  size?: number;
  mimeType?: string;
}

export interface Assertion {
  id: string;
  kind: 'status' | 'header' | 'json-path' | 'duration';
  op: 'equals' | 'not-equals' | 'contains' | 'lt' | 'gt' | 'matches';
  target?: string;
  expected: string | number;
}

export interface Environment {
  name: string;
  variables: Array<{ key: string; value: string; encrypted: boolean }>;
}

// LinkedWorkspace — replaces v1's Repo + apiConnectionSessions. Every
// version-update action requires explicit user confirmation; updatePolicy is
// fixed to 'manual' for v2.0.
export interface LinkedWorkspace {
  id: string;
  kind: 'private' | 'public';
  name: string;
  description?: string;
  source: {
    provider: 'github';
    repoFullName: string;
    branch: string;
  };
  // 'commands' scope removed per revision #2.
  scope: Array<'collections' | 'environments'>;
  pinnedVersion: string | null;
  updatePolicy: 'manual';
  linkedAt: string;
  // Secret-vault key IDs the linked workspace expects values for. The consumer
  // fills these in via the connection card; values land in the consumer's
  // secret vault tagged with origin: 'linked'.
  requiredSecretKeyIds: string[];
  marketplace?: {
    listedAs: string;
    tags: string[];
    summary: string;
  };
}

// Workspace-owned release ledger. Source of truth lives in workspace.json,
// not in GitHub tags.
export interface ReleaseHistory {
  versions: ReleaseVersion[];
  currentVersion: string | null;
}

export interface ReleaseVersion {
  version: string; // semver
  publishedAt: string;
  notes: string; // markdown
  // SHA-256 of workspace.synced.json at publish time. Verifiable on the
  // consumer side to detect tampering.
  workspaceSnapshot: string;
  sha?: string; // optional git commit SHA on the source branch
  tagName?: string; // optional git tag name
  deprecated: boolean;
  yanked: boolean;
}

// ---------------------------------------------------------------------------
// Local document — never pushed to git
// ---------------------------------------------------------------------------

export interface WorkspaceLocal {
  schemaVersion: 1;
  workspaceId: string;
  overrides: {
    items: Record<string, ItemOverride>;
  };
  executionPlans: Record<string, ExecutionPlan>;
  history: {
    requestRuns: RequestRun[];
    planRuns: PlanRun[];
  };
  // Cross-workspace global secret vault. Distinguishes workspace-defined vs
  // required-by-linked-workspace, and tracks usage so the user can see where
  // each key is consumed before deleting it.
  secretIndex: SecretIndex;
  // GitHub session(s) — managed in the Sessions tab of the Secret Vault modal.
  // Allows token rotation without losing branch/PR state.
  sessions: {
    github: GitHubSession | null;
  };
  workingBranch: WorkingBranch | null;
  // 3-way diff snapshot for conflict-safe sync. See Sync section in the plan.
  sync: SyncSnapshot;
  // No `activePanel` — top nav controls this and persists in localStorage so
  // it doesn't bloat the workspace doc.
  ui: {
    activeRequestId: string | null;
    sidebarExpandedSections: string[];
    themeId: ThemeId;
  };
}

export interface SecretIndex {
  entries: Record<string, SecretEntry>;
}

export interface SecretEntry {
  id: string;
  label: string;
  createdAt: string;
  origin: 'workspace' | 'linked';
  // Populated when origin === 'linked':
  linkedWorkspaceId?: string;
  linkedKeyId?: string; // the key ID as defined in the linked workspace
  // Where this key is consumed — populated lazily; helps the user before
  // delete and powers the "where used" view in the modal.
  usedIn: SecretUsage[];
}

export interface SecretUsage {
  kind: 'request' | 'environment-var' | 'linked-workspace-input';
  id: string; // request id, environment var path, or linked workspace id
  label: string;
}

export interface GitHubSession {
  accountLogin: string;
  // Points into secretIndex.entries — the actual encrypted PAT lives in the
  // separate web-secrets store.
  tokenSecretId: string;
  // Scopes the token currently grants, e.g. ['repo', 'pull_request'].
  // Refreshed by an explicit "Verify scopes" call (GET /user via API).
  grantedScopes: string[];
  addedAt: string;
  lastVerifiedAt: string | null;
}

export interface ItemOverride {
  // Key in the parent record is `${linkedWorkspaceId}:${itemId}`.
  linkedWorkspaceId: string;
  itemId: string;
  patch: Record<string, unknown>;
  updatedAt: string;
}

export interface ExecutionPlan {
  id: string;
  name: string;
  steps: Array<{ requestId: string; linkedWorkspaceId?: string }>;
  envPriorityOrder: string[];
  createdAt: string;
  updatedAt: string;
}

export interface RequestRun {
  id: string;
  requestId: string;
  startedAt: string;
  durationMs: number;
  status: number | null;
  ok: boolean;
  error?: string;
  assertions: Array<{ assertionId: string; passed: boolean; detail?: string }>;
}

export interface PlanRun {
  id: string;
  planId: string;
  startedAt: string;
  durationMs: number;
  withAssertions: boolean;
  steps: Array<{ requestRunId: string; passed: boolean }>;
}

export interface WorkingBranch {
  name: string;
  baseBranch: string;
  repoFullName: string;
  createdAt: string;
  lastPushedSha: string | null;
  diffSummary: { ahead: number; behind: number; staleAt: string } | null;
  openPrUrl: string | null;
}

// 3-way diff snapshot. localDiff = currentSynced - lastPulledSnapshot;
// remoteDiff = remote - lastPulledSnapshot. Conflict iff both diffs touch
// the same entity key.
export interface SyncSnapshot {
  lastPulledSnapshot: WorkspaceSynced | null;
  lastPulledSha: string | null;
  lastPulledAt: string | null;
  // Optional optimization: entity keys edited locally since last successful
  // push. Format: 'requests:<id>', 'environments:<name>', 'linkedWorkspaces:<id>',
  // 'releases.self'. Cleared after push succeeds.
  dirtyKeys: string[];
}
