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

import type { MockServer, MockRuntime } from './mock';

export type ThemeId =
  // Built-in defaults
  | 'studio-dark'
  | 'graphite-dark'
  | 'midnight-blue'
  | 'workbench-light'
  | 'paper-light'
  | 'high-contrast-dark'
  // High contrast (companion)
  | 'high-contrast-light'
  // Dark — community palettes
  | 'dracula'
  | 'nord'
  | 'tokyo-night'
  | 'one-dark-pro'
  | 'monokai-pro'
  | 'gruvbox-dark'
  | 'solarized-dark'
  | 'catppuccin-mocha'
  | 'catppuccin-macchiato'
  | 'synthwave-84'
  | 'cobalt2'
  | 'rose-pine'
  | 'ayu-mirage'
  | 'night-owl'
  | 'github-dark'
  | 'material-palenight'
  // Light — community palettes
  | 'solarized-light'
  | 'github-light'
  | 'catppuccin-latte'
  | 'ayu-light'
  | 'atom-one-light'
  | 'rose-pine-dawn'
  | 'tokyo-night-day';

// Font family preference. Matches `ALL_FONTS` in `applyFont.ts` — the
// bare id lives here because it's persisted on `WorkspaceLocal.ui` so
// fonts switch with the workspace (parity with theme).
export type FontFamilyId =
  // Monospace
  | 'system-mono'
  | 'jetbrains-mono'
  | 'fira-code'
  | 'cascadia-code'
  | 'ibm-plex-mono'
  | 'source-code-pro'
  | 'roboto-mono'
  | 'space-mono'
  | 'hack'
  | 'inconsolata'
  | 'anonymous-pro'
  | 'ubuntu-mono'
  | 'dm-mono'
  | 'geist-mono'
  | 'red-hat-mono'
  | 'azeret-mono'
  | 'victor-mono'
  // Sans-serif
  | 'system-sans'
  | 'inter'
  | 'roboto'
  | 'open-sans'
  | 'lato'
  | 'source-sans-3'
  | 'nunito-sans'
  | 'manrope'
  | 'dm-sans'
  | 'geist'
  | 'plus-jakarta-sans'
  | 'ibm-plex-sans'
  | 'work-sans';

// No 'settings' panel — Secret Vault and Theme moved to TopBar.
// No 'command' panel — feature dropped per revision #2.
// 'mocks' and 'mcp' added in P27 (mock-server runtime + MCP config snippets).
export type PanelId =
  | 'workspace' // renamed from 'git'
  | 'link-workspace' // renamed from 'api-connections'
  | 'editor'
  | 'env'
  | 'execution'
  | 'history'
  | 'mocks'
  | 'mcp'
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
  // Consumer-side modifications to linked content. Lives in the synced doc
  // so collaborators see each other's edits to a linked workspace's
  // requests / env vars when they pull. Reset = drop the entry. The
  // canonical source content is re-fetched into `WorkspaceLocal.linkedCollections`
  // (snapshots, device-local) and these patches apply on top at read time.
  linkedOverrides: {
    // Keyed `${linkedWorkspaceId}:${requestId}`. Patch is field-level
    // (only the diverging fields are stored — omitted ⇒ inherit from source).
    requests: Record<string, RequestOverride>;
    // Keyed `${linkedWorkspaceId}:${envName}:${varKey}`. Per-variable so we
    // don't need a "full env replacement" sledgehammer when the user just
    // tweaks one value.
    environmentVars: Record<string, EnvironmentVariableOverride>;
  };
  releases: {
    // This workspace's own release ledger — drives version updates without
    // depending on GitHub Actions / tag automation.
    self: ReleaseHistory | null;
    // Cached release history of each linked workspace, keyed by linkedWorkspaceId.
    perLink: Record<string, ReleaseHistory>;
  };
  // Workspace-wide library of reusable JSON Schemas + GraphQL schema
  // definitions. Requests opt in by setting `bodySchemaId` /
  // `graphqlSchemaId`. Lives in the synced doc so teams share definitions
  // through the regular push/pull flow.
  globalAssets: {
    schemas: Record<string, GlobalSchema>;
    graphql: Record<string, GlobalGraphQL>;
  };
  // Workspace-wide mock-server library. Definitions push to git so a
  // teammate cloning the repo can spin up the same mocks via Desktop or
  // CLI. Runtime status (port, pid, request count) lives in
  // `WorkspaceLocal.mockRuntime` and is host-specific.
  mockServers: Record<string, MockServer>;
  // Synced labels for secret keys referenced by environment variables.
  // The actual secret values live in WorkspaceLocal vault (and are
  // supplied at runtime for the CLI). This map exists so collaborators
  // see consistent human labels for the same id. Optional so older
  // workspaces can load without a hard schema bump; the normalizer in
  // workspaceStorage backfills `{}` on read and the store always writes
  // a populated value.
  secretKeys?: Record<string, SecretKeyMeta>;
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
  /**
   * Optional folder-level auth. When a request has `auth.type === 'inherit'`,
   * the runner walks up the folder chain and uses the first explicit
   * (non-`inherit`, non-`none`) auth it finds. Absent here = no folder-level
   * auth at this level (continue walking up).
   */
  auth?: RequestAuth;
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
  /**
   * Values for URL path placeholders (`:name` Express-style or `{name}`
   * OpenAPI-style). Keys are expected to match placeholder names found in
   * `url`. Missing keys substitute to empty string at send time. Absent =
   * empty (no path params), so the field is optional in storage.
   */
  pathParams?: Record<string, string>;
  /**
   * Cookies sent with the request. Joined into a single `Cookie` header at
   * send time (existing user-set Cookie header wins). Absent = no cookies.
   */
  cookies?: Array<{ key: string; value: string; enabled: boolean }>;
  body: RequestBody;
  // Discriminated union covering all 15 supported auth schemes. Defaults to
  // { type: 'none' }. Older synced docs without this field are upgraded by
  // workspaceStore on hydrate (see normalizeRequest).
  auth: RequestAuth;
  contextVars: Array<{ key: string; value: string }>;
  // Per-request post-run extractors. After a successful send the extracted
  // values land in WorkspaceLocal.globalContext (local-only, never pushed)
  // and become available as `{{name}}` to subsequent requests + plan steps.
  extractions: ContextExtraction[];
  // Optional reference to a workspace-wide JSON Schema (in
  // WorkspaceSynced.globalAssets.schemas) used for body validation in the
  // editor (P18). Null/undefined means "no schema."
  bodySchemaId?: string | null;
  // Optional reference to a workspace-wide GraphQL schema definition. Used
  // for GraphQL request body autocomplete (P19).
  graphqlSchemaId?: string | null;
  assertions: Assertion[];
  createdAt: string;
  updatedAt: string;
}

export interface ContextExtraction {
  id: string;
  variable: string;
  source: 'body' | 'header' | 'cookie' | 'status';
  /**
   * Source-specific path:
   *   - body: JSON path (dot/bracket, e.g. `data.token` or `items[0].id`)
   *   - header: header name (case-insensitive)
   *   - cookie: cookie name
   *   - status: ignored — the HTTP status code is the value
   */
  path: string;
  enabled: boolean;
}

// Workspace-wide library of reusable schemas. Lives in the synced doc so
// teams share definitions, and Requests reference them by id (see
// Request.bodySchemaId / graphqlSchemaId added in §P17).
export interface GlobalSchema {
  id: string;
  name: string;
  description?: string;
  /** JSON Schema document, stored as a string so the user can paste any draft. */
  schema: string;
  createdAt: string;
  updatedAt: string;
}

// GraphQL schema definitions. `kind: 'sdl'` is the canonical Schema
// Definition Language (`type Query { ... }`); `kind: 'introspection'` is a
// JSON dump from `query IntrospectionQuery { __schema { ... } }`. The
// editor accepts either; downstream features (P19) parse whichever is
// supplied.
export interface GlobalGraphQL {
  id: string;
  name: string;
  description?: string;
  kind: 'sdl' | 'introspection';
  source: string;
  createdAt: string;
  updatedAt: string;
}

// All 15 auth schemes supported by Studio v2. Mirrors v1's discriminated
// union (see studio/packages/core/src/request/types.ts) so request import
// paths stay symmetrical. The companion `applyAuth` in @apicircle/core
// translates each variant into headers / query / signature on the wire.
export type RequestAuth =
  | { type: 'none' }
  | { type: 'inherit' }
  | { type: 'bearer'; token: string }
  | { type: 'basic'; username: string; password: string }
  | { type: 'api-key'; key: string; value: string; addTo: 'header' | 'query' | 'cookie' }
  | { type: 'custom-header'; key: string; value: string }
  | OAuth2ClientCredentialsAuth
  | OAuth2AuthCodeAuth
  | OAuth2PkceAuth
  | OAuth2PasswordAuth
  | OAuth2ImplicitAuth
  | OAuth2DeviceAuth
  | AwsSigV4Auth
  | DigestAuth
  | NtlmAuth
  | HawkAuth
  | JwtBearerAuth;

export interface OAuth2TokenState {
  accessToken: string;
  tokenType: string; // 'Bearer' by default
  refreshToken: string;
  /**
   * Epoch milliseconds when the access token expires, or 0 / null when
   * unknown. Stored as number so all comparisons are direct
   * `Date.now() < expiresAt` without round-tripping through Date()
   * parsing on the hot path. Workspace serialization rolls it through
   * JSON unchanged — git-side this is a number, not an ISO string.
   */
  expiresAt: number | null;
  /**
   * Scope the IdP actually granted (may differ from the request's
   * `scope` field if the user/client is missing some). Refresh keeps
   * this; clearing the token resets to ''.
   */
  obtainedScope: string;
}

export interface OAuth2ClientCredentialsAuth extends OAuth2TokenState {
  type: 'oauth2-client-credentials';
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scope: string;
  clientAuthMethod: 'header' | 'body';
}

export interface OAuth2AuthCodeAuth extends OAuth2TokenState {
  type: 'oauth2-auth-code';
  authUrl: string;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scope: string;
  state: string;
}

export interface OAuth2PkceAuth extends OAuth2TokenState {
  type: 'oauth2-pkce';
  authUrl: string;
  tokenUrl: string;
  clientId: string;
  clientSecret: string; // optional public client when blank
  redirectUri: string;
  scope: string;
  state: string;
  codeVerifier: string;
  codeChallengeMethod: 'S256' | 'plain';
}

export interface OAuth2PasswordAuth extends OAuth2TokenState {
  type: 'oauth2-password';
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
  scope: string;
}

export interface OAuth2ImplicitAuth extends Omit<OAuth2TokenState, 'refreshToken'> {
  type: 'oauth2-implicit';
  authUrl: string;
  clientId: string;
  redirectUri: string;
  scope: string;
}

export interface OAuth2DeviceAuth extends OAuth2TokenState {
  type: 'oauth2-device';
  deviceAuthUrl: string;
  tokenUrl: string;
  clientId: string;
  scope: string;
  deviceCode: string;
  userCode: string;
  verificationUri: string;
}

export interface AwsSigV4Auth {
  type: 'aws-sigv4';
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  region: string;
  service: string;
  addTo: 'header' | 'query';
}

export interface DigestAuth {
  type: 'digest';
  username: string;
  password: string;
}

export interface NtlmAuth {
  type: 'ntlm';
  username: string;
  password: string;
  domain: string;
  workstation: string;
}

export interface HawkAuth {
  type: 'hawk';
  hawkId: string;
  hawkKey: string;
  algorithm: 'sha256' | 'sha1';
  ext: string;
  /**
   * When true, the request body is folded into the Hawk MAC via the
   * payload-hash extension (Hawk spec §3.2.5). Required for servers
   * configured with strict body-binding; leave false for the looser
   * "header-only" form that most public Hawk APIs accept.
   */
  bindPayload?: boolean;
}

export interface JwtBearerAuth {
  type: 'jwt-bearer';
  algorithm:
    | 'HS256'
    | 'HS384'
    | 'HS512'
    | 'RS256'
    | 'RS384'
    | 'RS512'
    | 'PS256'
    | 'PS384'
    | 'PS512'
    | 'ES256'
    | 'ES384'
    | 'ES512'
    | 'EdDSA';
  secretOrKey: string;
  payload: string; // JSON
  jwtHeaders: string; // JSON
  // Pre-computed token. UI fills this on demand via the "Generate token"
  // button; HS algorithms sign locally, RS/ES require user-supplied PEM.
  token: string;
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
  // GraphQL-only: the user-supplied variables JSON. Sent alongside the
  // query in the standard `{ query, variables }` envelope. Empty / missing
  // means no variables. Pre-P19 docs simply lack the field.
  variables?: string;
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
      // SHA-256 of the file bytes at attach time. Lives in the synced doc so
      // pulls can skip re-downloading already-cached blobs and so the CLI /
      // teammates can detect tampering or corruption.
      sha256?: string;
      enabled: boolean;
    };

export interface AttachmentRef {
  slotId: string | null;
  filename?: string;
  size?: number;
  mimeType?: string;
  sha256?: string;
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
  variables: EnvironmentVariable[];
}

// Encrypted variables MUST set `secretKeyId`, which references
// WorkspaceSynced.secretKeys[id]. The actual secret value is never synced
// to Git — it lives in the local vault. CLI runs receive values via
// APICIRCLE_SECRET_<id>=… or `--secrets <file>.json`.
export interface EnvironmentVariable {
  key: string;
  value: string;
  encrypted: boolean;
  secretKeyId?: string;
}

// Synced metadata for secret keys. Holds id + label so collaborators see
// what each `{{NAME}}` ref points to. Values stay in WorkspaceLocal vault.
export interface SecretKeyMeta {
  id: string;
  label: string;
  createdAt: string;
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
  // The GitHub repo the user has bound this workspace to. Holds metadata
  // copied from `GET /repos/:owner/:repo` at connect time so the UI can
  // render without re-fetching. Cleared on disconnect.
  connectedRepo: ConnectedRepo | null;
  workingBranch: WorkingBranch | null;
  // 3-way diff snapshot for conflict-safe sync. See Sync section in the plan.
  sync: SyncSnapshot;
  // Cached collections + environments pulled from each linked workspace at
  // link / refresh time. Local-only because the consumer's own pushed JSON
  // shouldn't carry the source's whole tree — it's a materialization of
  // intent, not intent itself. Keyed by linkedWorkspace.id.
  linkedCollections: Record<string, LinkedSnapshot>;
  // Local-only workspace-wide context. Populated by the post-run
  // extractions defined on each request. Latest write wins. Survives
  // reload (it's persisted in IDB) but never round-trips through Git.
  // Surfaced into `ResolutionScope.contextVars` as a fallback layer
  // sitting between per-request context and the active environment.
  globalContext: Record<string, string>;
  // Per-host mock-server runtime status. Maps mockServerId → live port /
  // pid / counters when running. Cleared on app shutdown — restart re-
  // populates as the user starts mocks.
  mockRuntime: MockRuntime;
  // No `activePanel` — top nav controls this and persists in localStorage so
  // it doesn't bloat the workspace doc.
  ui: {
    activeRequestId: string | null;
    sidebarExpandedSections: string[];
    themeId: ThemeId;
    /**
     * Workspace-bound font family. Switching workspaces applies this
     * font; renaming a workspace does not affect it. Default
     * `'system-mono'` matches the seed in `createEmptyWorkspace`.
     */
    fontId: FontFamilyId;
  };
  /**
   * User-tunable client-side settings. Local-only; never round-trips
   * through Git so each developer can keep their own preferences.
   *
   * - `validateOnSend`: when true, the Editor surfaces a pre-send
   *   validation panel (warnings + blockers from
   *   `core/preSendValidation`) above the Send button. Default: true.
   */
  settings: WorkspaceLocalSettings;
  /**
   * Pre-destructive snapshot ledger. Auto-captured before every operation
   * that could lose work (push, merge, linked-update apply, yank, deprecate),
   * and on user demand via the History panel. Local-only; never pushed.
   *
   * The ledger acts as a ring buffer: when total `sizeBytes` exceeds
   * `maxBytes`, the oldest snapshots are evicted until the total drops
   * back under cap. Set `maxBytes: Number.POSITIVE_INFINITY` to disable
   * eviction.
   */
  snapshots: WorkspaceSnapshotLedger;
}

export interface WorkspaceLocalSettings {
  validateOnSend: boolean;
  /**
   * Whether Monaco editors consume mouse-wheel events even when the user
   * isn't intending to scroll the editor (e.g. they're hovering over the
   * editor while scrolling the page). When `false`, wheel events bubble
   * up to the page so long pages remain scrollable past the editor.
   * When `true`, the editor scrolls first and only releases the wheel
   * once it reaches its top/bottom (Monaco's default behavior).
   *
   * Default: `false` (page-scroll friendly).
   */
  monacoConsumesWheel: boolean;
}

export type WorkspaceSnapshotTrigger =
  | 'manual'
  | 'pre-push'
  | 'pre-merge'
  | 'pre-linked-update'
  | 'pre-yank'
  | 'pre-deprecate';

export interface WorkspaceSnapshot {
  /** Stable id; survives ledger updates so restore is idempotent. */
  id: string;
  /** ISO timestamp the snapshot was captured at. */
  createdAt: string;
  /** What triggered the capture — informational, used for the History badge. */
  triggeredBy: WorkspaceSnapshotTrigger;
  /** Optional user-provided note (manual snapshots; the others auto-fill it). */
  note?: string;
  /**
   * Verbatim copy of `WorkspaceSynced` at the moment of capture. Stored
   * inline so restore is a single state replacement — no IPFS, no SHA-only
   * placeholder. Cost: ~the size of `workspace.json`. The ring buffer +
   * cap keep this bounded.
   */
  workspaceSyncedSnapshot: WorkspaceSynced;
  /**
   * Approximate JSON byte length of `workspaceSyncedSnapshot` at capture
   * time. Used for the storage meter + ring-buffer eviction; the exact
   * persisted size after IDB compression may differ.
   */
  sizeBytes: number;
}

export interface WorkspaceSnapshotLedger {
  entries: WorkspaceSnapshot[];
  /**
   * Cap on total `sizeBytes` across all entries. When exceeded, oldest
   * entries are dropped until the total drops back under cap. Defaults
   * to 50 MB (52,428,800).
   */
  maxBytes: number;
}

/**
 * Snapshot of a linked source workspace at a specific ref. Lives only
 * in `WorkspaceLocal.linkedCollections[id]`. Refreshed on demand via
 * the link card's Refresh ledger button (which pulls workspace.json
 * and re-derives this snapshot).
 *
 * `ref` is the pinnedVersion when the link is pinned, otherwise
 * `HEAD@<branch>` to make it obvious which moving target the snapshot
 * is tracking.
 */
export interface LinkedSnapshot {
  workspaceName: string;
  pulledAt: string;
  ref: string;
  collections: WorkspaceSynced['collections'];
  environments: WorkspaceSynced['environments'];
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
  // Refreshed by an explicit "Test connection" call (GET /user via API).
  grantedScopes: string[];
  addedAt: string;
  lastVerifiedAt: string | null;
}

/**
 * Field-level override for a single linked request. Every field is
 * optional — present ⇒ replaces the source workspace's value, absent ⇒
 * inherits from the snapshot. Stored as a delta (smallest possible
 * patch) so reset = drop the entry.
 *
 * The five identity / lifecycle fields (`id`, `folderId`, `createdAt`,
 * `updatedAt`, plus `bodySchemaId` / `graphqlSchemaId` since those
 * reference the source's globalAssets) are intentionally NOT
 * overridable — keeping them source-pinned avoids stale references and
 * keeps the consumer's tree structure under the source's control.
 */
export type RequestOverridePatch = Partial<
  Pick<
    Request,
    | 'name'
    | 'method'
    | 'url'
    | 'headers'
    | 'query'
    | 'pathParams'
    | 'cookies'
    | 'body'
    | 'auth'
    | 'contextVars'
    | 'extractions'
    | 'assertions'
  >
>;

export interface RequestOverride {
  // Key in the parent record is `${linkedWorkspaceId}:${itemId}`.
  linkedWorkspaceId: string;
  itemId: string;
  patch: RequestOverridePatch;
  updatedAt: string;
}

/**
 * Per-variable override on a linked workspace's environment. Keyed
 * `${linkedWorkspaceId}:${envName}:${varKey}` in the parent record.
 *
 * Three modes:
 *   1. Replace value: `value` (and optionally `encrypted` / `secretKeyId`) set,
 *      `removed` absent. Keeps the source variable but with the consumer's value.
 *   2. Hide source variable: `removed: true`. The source's variable is dropped
 *      from the consumer's effective environment.
 *   3. Inject new variable: the `varKey` does not exist in the source's env;
 *      the override row introduces it for this consumer only.
 */
export interface EnvironmentVariableOverride {
  linkedWorkspaceId: string;
  envName: string;
  varKey: string;
  value?: string;
  encrypted?: boolean;
  secretKeyId?: string;
  removed?: boolean;
  updatedAt: string;
}

export interface ExecutionPlan {
  id: string;
  name: string;
  /**
   * Steps run sequentially in this order. `enabled: false` skips the step
   * entirely at run time — useful for keeping a step in the plan while
   * temporarily routing around it. Defaults to `true` when missing on
   * older persisted plans (pre-`enabled` plans that haven't been touched
   * since the field landed).
   */
  steps: Array<{ requestId: string; linkedWorkspaceId?: string; enabled?: boolean }>;
  envPriorityOrder: string[];
  /**
   * Plan-level variables sit between context vars and the env priority
   * list in the resolver chain — they let a plan override an env value
   * without mutating the env. Keys are case-sensitive; later entries
   * silently win on duplicate keys (consistent with env vars).
   */
  variables?: Array<{ key: string; value: string }>;
  /**
   * When `true`, runPlan halts the loop the first time a step's
   * assertions don't all pass. Only consulted when the run is launched
   * `withAssertions` — `Run` (without assertions) never short-circuits.
   * Defaults to `false` (continue past failed assertions).
   */
  stopOnAssertionFailure?: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Captured wire detail for a request run, written when the run completes.
 * Stored on `WorkspaceLocal.history` (capped, IDB-only). Body fields are
 * truncated past `RUN_BODY_PREVIEW_LIMIT` so a hundred history rows can't
 * blow up the IDB record.
 */
export interface RequestRun {
  id: string;
  requestId: string;
  startedAt: string;
  durationMs: number;
  status: number | null;
  /** Empty string for network errors (status === null). */
  statusText: string;
  ok: boolean;
  error?: string;
  /** Final URL after path-param substitution + query composition. */
  url: string;
  method: string;
  /** Final headers actually sent on the wire (post-auth). */
  requestHeaders: Record<string, string>;
  /**
   * Best-effort string preview of the request body. `null` for binary/form
   * bodies (where the body isn't a string) or no body. Truncated past
   * `RUN_BODY_PREVIEW_LIMIT` bytes.
   */
  requestBodyPreview: string | null;
  /** Headers received from the server. */
  responseHeaders: Record<string, string>;
  /** Truncated string preview of the response body. */
  responseBodyPreview: string;
  responseBodyKind: 'json' | 'text' | 'binary' | 'empty';
  responseTruncated: boolean;
  /**
   * Verdicts captured at run time. Snapshots the assertion definition so the
   * History detail view can render kind/op/target/expected even when the
   * source request has since been edited or deleted.
   */
  assertions: Array<{
    assertionId: string;
    kind: Assertion['kind'];
    op: Assertion['op'];
    target?: string;
    expected: string | number;
    passed: boolean;
    detail?: string;
  }>;
}

/** Soft cap for body previews stored on a RequestRun (each side). */
export const RUN_BODY_PREVIEW_LIMIT = 64 * 1024;

export interface PlanRun {
  id: string;
  planId: string;
  startedAt: string;
  durationMs: number;
  withAssertions: boolean;
  steps: Array<{ requestRunId: string; passed: boolean }>;
}

export interface ConnectedRepo {
  fullName: string;
  owner: string;
  name: string;
  defaultBranch: string;
  visibility: 'public' | 'private' | 'internal';
  isPrivate: boolean;
  pushable: boolean;
  connectedAt: string;
}

export interface WorkingBranch {
  /** Branch name on GitHub, e.g. `apicircle/payments-a3f9c2`. */
  name: string;
  /** Base branch (typically the repo's default — `main` / `master`). */
  baseBranch: string;
  /** `owner/name` on GitHub. */
  repoFullName: string;
  /** Owner login, stored redundantly so call sites don't have to re-split. */
  repoOwner: string;
  /** Repo name, same idea. */
  repoName: string;
  /** Commit SHA on this branch's HEAD at creation (= base SHA initially). */
  headSha: string;
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
