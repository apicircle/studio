// =============================================================================
// Workspace JSON schema — two documents
//
// `WorkspaceSynced` is serialized to a single `workspace.json` in the connected
// Git repo (working branch). Push-to-save only ever reads this document.
//
// `WorkspaceLocal` lives only in IndexedDB and is never pushed. Local edits,
// history, executions, working-branch metadata, UI state — anything that must
// survive a sync round-trip without leaking into Git lives here.
// =============================================================================

export type ThemeId =
  | 'studio-dark'
  | 'graphite-dark'
  | 'midnight-blue'
  | 'workbench-light'
  | 'paper-light'
  | 'high-contrast-dark';

export type PanelId =
  | 'git'
  | 'api-connections'
  | 'editor'
  | 'env'
  | 'execution'
  | 'history'
  | 'settings'
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
  apiConnections: Record<string, ApiConnection>;
  releases: {
    perConnection: Record<string, ConnectionReleaseHistory>;
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

export type BodyType = 'none' | 'json' | 'text' | 'form-data' | 'urlencoded' | 'binary' | 'xml' | 'graphql';

export interface Request {
  id: string;
  name: string;
  folderId: string | null;
  method: HttpMethod;
  url: string;
  headers: Array<{ key: string; value: string; enabled: boolean }>;
  query: Array<{ key: string; value: string; enabled: boolean }>;
  body: { type: BodyType; content: string };
  contextVars: Array<{ key: string; value: string }>;
  assertions: Assertion[];
  createdAt: string;
  updatedAt: string;
}

export interface Assertion {
  id: string;
  kind: 'status' | 'header' | 'json-path' | 'duration';
  op: 'equals' | 'not-equals' | 'contains' | 'lt' | 'gt' | 'matches';
  target?: string; // header name or JSON path
  expected: string | number;
}

export interface Environment {
  name: string;
  variables: Array<{ key: string; value: string; encrypted: boolean }>;
}

// API Connections — replaces v1's Repo + apiConnectionSessions split.
export interface ApiConnection {
  id: string;
  kind: 'private' | 'public';
  name: string;
  description?: string;
  source: {
    provider: 'github';
    repoFullName: string;
    branch: string;
  };
  scope: Array<'collections' | 'environments' | 'commands'>;
  pinnedVersion: string | null; // null = floating to latest
  linkedAt: string;
  marketplace?: {
    listedAs: string;
    tags: string[];
    summary: string;
  };
}

// Per-connection release history — replaces v1's workspace-global apiRelease.
export interface ConnectionReleaseHistory {
  connectionId: string;
  versions: ReleaseVersion[];
  currentVersion: string | null;
  automationMode: 'manual' | 'app';
}

export interface ReleaseVersion {
  version: string;
  publishedAt: string;
  notes: string;
  sha: string;
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
  secretIndex: {
    entries: Record<string, { id: string; label: string; createdAt: string }>;
  };
  workingBranch: WorkingBranch | null;
  ui: {
    activePanel: PanelId;
    activeRequestId: string | null;
    sidebarExpandedSections: string[];
    themeId: ThemeId;
  };
}

export interface ItemOverride {
  // Key in the parent record is `${connectionId}:${itemId}`.
  connectionId: string;
  itemId: string;
  patch: Record<string, unknown>;
  updatedAt: string;
}

export interface ExecutionPlan {
  id: string;
  name: string;
  steps: Array<{ requestId: string; connectionId?: string }>;
  envPriorityOrder: string[]; // overrides global priority for this plan
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
  lastPulledSha: string | null;
  diffSummary: { ahead: number; behind: number; staleAt: string } | null;
  openPrUrl: string | null;
}
