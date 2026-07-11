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
  | 'vscode-dark'
  | 'github-dark-dimmed'
  | 'terminal-green'
  | 'terminal-amber'
  | 'oled-black'
  | 'carbon-dark'
  | 'slate-dark'
  | 'zinc-dark'
  | 'everforest-dark'
  | 'kanagawa-wave'
  | 'kanagawa-dragon'
  | 'horizon-dark'
  | 'city-lights'
  | 'nightfox-dark'
  | 'command-center'
  | 'ink-dark'
  | 'muted-teal-dark'
  | 'redwood-dark'
  // Light — community palettes
  | 'solarized-light'
  | 'github-light'
  | 'catppuccin-latte'
  | 'ayu-light'
  | 'atom-one-light'
  | 'rose-pine-dawn'
  | 'tokyo-night-day'
  | 'vscode-light'
  | 'xcode-light'
  | 'minimal-light'
  | 'porcelain-light'
  | 'cloud-light'
  | 'everforest-light'
  | 'kanagawa-lotus'
  | 'clarity-light'
  | 'nord-light'
  | 'sage-light'
  // Additional high-contrast palettes
  | 'github-dark-high-contrast'
  | 'github-light-high-contrast';

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
  | 'noto-sans-mono'
  | 'martian-mono'
  | 'fragment-mono'
  | 'overpass-mono'
  | 'cousine'
  | 'courier-prime'
  | 'pt-mono'
  | 'oxygen-mono'
  | 'b612-mono'
  | 'share-tech-mono'
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
  | 'work-sans'
  | 'macos-system'
  | 'aptos'
  | 'public-sans'
  | 'noto-sans'
  | 'atkinson-hyperlegible'
  | 'lexend'
  | 'outfit'
  | 'sora'
  | 'barlow'
  | 'urbanist';

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

/**
 * Display name used when seeding a fresh workspace's registry entry on
 * first boot. The name itself is local-only — it never lives in the
 * git-synced doc — so two machines pulling the same workspace.json can
 * each call their local copy whatever they want.
 */
export const DEFAULT_WORKSPACE_NAME = 'My Workspace';

export interface WorkspaceSynced {
  schemaVersion: 1;
  workspaceId: string;
  collections: {
    tree: FolderNode;
    requests: Record<string, Request>;
    folders: Record<string, Folder>;
  };
  environments: {
    items: Record<string, Environment>;
    activeName: string | null;
    /**
     * Ordered list of envs the resolver layers into request scope. Mixes
     * local and linked-workspace envs — the consumer picks order. See
     * `EnvPriorityRef`.
     */
    priorityOrder: EnvPriorityRef[];
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
  // Workspace-wide library of reusable JSON Schemas, GraphQL schema
  // definitions, and file assets. Requests opt in by setting
  // `bodySchemaId`, `graphqlSchemaId`, or by pointing file body rows at a
  // file asset. File bytes stay outside workspace.json as Git blobs under
  // `.apicircle/workspace-<id>/attachments/<slotId>`; only metadata lives here.
  globalAssets: {
    schemas: Record<string, GlobalSchema>;
    graphql: Record<string, GlobalGraphQL>;
    files?: Record<string, GlobalFileAsset>;
  };
  // Workspace-wide mock-server library. Definitions push to git so a
  // teammate cloning the repo can spin up the same mocks via Desktop or
  // CLI. Runtime status (port, pid, request count) lives in
  // `WorkspaceLocal.mockRuntime` and is host-specific.
  mockServers: Record<string, MockServer>;
  /**
   * Workspace-wide execution plans. Plan **definitions** travel through
   * Git so collaborators on the same workspace see the same plans;
   * plan **runs** (history) stay in `WorkspaceLocal.history.planRuns`
   * because they're per-device and per-execution.
   *
   * Optional in the type: pre-migration workspaces persisted plans on
   * `WorkspaceLocal.executionPlans` only; the hydration normalizer
   * lifts those into `synced.executionPlans` on first load. The store
   * always writes a populated value (defaulting to `{}`) after
   * migration, so consumers can rely on `synced.executionPlans` being
   * defined post-hydrate.
   */
  executionPlans?: Record<string, ExecutionPlan>;
  // Synced labels for secret keys referenced by environment variables.
  // The actual secret values live in WorkspaceLocal vault (and are
  // supplied at runtime for the CLI). This map exists so collaborators
  // see consistent human labels for the same id. Optional so older
  // workspaces can load without a hard schema bump; the normalizer in
  // workspaceStorage backfills `{}` on read and the store always writes
  // a populated value.
  secretKeys?: Record<string, SecretKeyMeta>;
  /**
   * Workspace-passphrase crypto state. `null` when no passphrase has been
   * set yet (the workspace either has no secrets, or hasn't been migrated
   * to the passphrase model). Populated by `setupPassphrase` the first
   * time a user creates a passphrase; from then on, decryption requires
   * the same passphrase to be re-entered (in memory only).
   *
   * The actual encrypted secret-value payloads still live in device-local
   * IndexedDB today; migrating those into the synced doc is its own
   * follow-up.
   *
   * `kdf` / `salt` / `iterations` parameterise the PBKDF2 derivation;
   * `verifier` lets us reject a wrong passphrase up front without trying
   * to decrypt every payload. See `passphraseKey.ts` for the algorithm.
   */
  secretCrypto?: SecretCryptoMeta | null;
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
  /**
   * Provenance for requests imported from an OpenAPI/Swagger spec: the Global
   * File Asset the collection was imported from (`specAssetId`) and the
   * operation it maps to (`operationId` = `"<METHOD> <path>"`, the stable
   * operation key). Enables re-syncing a collection when its source spec asset
   * changes. Additive; absent on hand-authored or non-spec-imported requests.
   */
  specAssetId?: string;
  operationId?: string;
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

/**
 * Pointer to a verified-good copy of a Global File Asset's bytes on a
 * specific Git ref. Each asset can carry up to two of these — one for
 * the consumer's working branch and one for the base branch the working
 * branch was forked from — and the cleanup invariant drops the working
 * ref once the base ref holds the same blob (single source of truth).
 *
 * Populated lazily — never at upload time. The first push promotes the
 * pending upload to `workingBranchRef`; the next refresh after the PR
 * merges promotes to `baseBranchRef`. See
 * docs/architecture/platform.md for the full state machine.
 */
export interface AssetGitRef {
  /** Branch the asset is known to live on. */
  branchName: string;
  /**
   * GitHub blob SHA at the most recent successful verification. Drives
   * the cleanup invariant — when both refs return the same `blobSha` the
   * working ref is redundant and gets dropped. Optional because legacy
   * entries persisted before this field existed; consumers treat absent
   * as "not yet verified."
   */
  blobSha?: string;
  /**
   * Commit SHA the ref was first recorded at. Used for display
   * ("On main · since v2.3.1") and for the "branch retargeted" detection
   * path where the same branchName resolves to a different blob.
   */
  commitSha?: string;
  /** ISO timestamp of the last successful read of this ref. */
  verifiedAt: string;
}

/**
 * Parsed summary of a Global File Asset that IS an OpenAPI 3.x / Swagger 2.0
 * document. Present only on spec files — an ordinary file asset leaves `spec`
 * undefined. Derived once when the bytes are uploaded (and re-derived when they
 * change) by `summarizeSpec` in `@apicircle/mock-server-core`, so the Assets
 * panel, the mock "run/import from spec" pickers, and (in the Lens edition) the
 * code-vs-spec drift check all read one authoritative parse instead of
 * re-parsing the blob. Purely additive — existing assets and non-spec files are
 * unaffected.
 */
export interface SpecAssetMeta {
  /** `openapi-3` when the doc has a top-level `openapi:` string; `swagger-2` for `swagger:`. */
  dialect: 'openapi-3' | 'swagger-2';
  /** How the bytes are encoded, so consumers parse with the right reader. */
  format: 'json' | 'yaml';
  /** `info.title`, when present. */
  title?: string;
  /** `info.version`, when present. */
  version?: string;
  /** Operations declared — the sum of HTTP methods across `paths`. */
  operationCount: number;
  /** ISO timestamp of the parse; re-derived whenever the bytes (sha256) change. */
  parsedAt: string;
  /** Non-fatal structural warnings surfaced in the Assets panel. */
  warnings: string[];
}

export interface GlobalFileAsset {
  id: string;
  name: string;
  description?: string;
  slotId: string;
  filename: string;
  size: number;
  mimeType: string;
  sha256?: string;
  createdAt: string;
  updatedAt: string;
  /**
   * Provenance pointer to the asset's bytes on the consumer's currently
   * connected working branch. Set by the push flow after `updateRef`
   * resolves with the GitHub blob sha. Dropped by the cleanup invariant
   * when `baseBranchRef` holds the same blob. Optional — pre-1.0.9 docs
   * and freshly-uploaded-but-unpushed assets leave it `undefined`.
   */
  workingBranchRef?: AssetGitRef | null;
  /**
   * Provenance pointer to the asset's bytes on the base branch the
   * working branch was forked from (usually `main`). Set by the refresh
   * verification probe once the PR merges. Optional — assets that have
   * never been merged leave it `undefined`.
   */
  baseBranchRef?: AssetGitRef | null;
  /**
   * Present when this file asset is a recognised OpenAPI/Swagger document — a
   * parsed summary derived on upload (see {@link SpecAssetMeta}). Absent on
   * ordinary file assets. Additive; drives the Assets-panel spec badge and the
   * mock "run/import from spec" pickers.
   */
  spec?: SpecAssetMeta;
}

/**
 * Local-only buffer recording an asset whose bytes are in IDB but have
 * not yet been pushed to any Git ref. Keyed by `globalFileAssetId` so
 * the desktop / web can render an "Uploaded locally" state pill and the
 * push flow knows which slots still need to be uploaded as blobs. Dropped
 * by the push flow after `globalAsset.markPushed` lands.
 */
export interface PendingFileUpload {
  slotId: string;
  filename: string;
  mimeType: string;
  sha256: string;
  size: number;
  /** ISO timestamp the file was dropped into the studio. */
  queuedAt: string;
}

/**
 * Where a Global File Asset is referenced inside the current synced doc.
 * Recomputed by `assetUsageAggregator` after every `commitSynced`. Used
 * to surface "Used in N places" in the Global Assets panel, the form-data
 * row, the binary body, and the mock-response editors, and to flag
 * zero-use orphans for one-click cleanup.
 */
export interface AssetUsage {
  /** Request ids whose body binds this asset. */
  requests: string[];
  /** Mock endpoints whose responses bind this asset. */
  mockEndpoints: Array<{ mockId: string; endpointId: string }>;
  /** Total reference count — denormalised for cheap badge rendering. */
  total: number;
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
// Attachments themselves (the actual blobs + filename/mimeType) live in the
// local IndexedDB `attachments` store and are uploaded as Git blobs under
// `.apicircle/workspace-<id>/attachments/<slotId>` on push. The synced doc carries only the
// slotId reference plus minimal display metadata so diffs stay small.
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
      globalFileAssetId?: string | null;
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
  globalFileAssetId?: string | null;
  filename?: string;
  size?: number;
  mimeType?: string;
  sha256?: string;
}

export interface LocalAttachmentCacheEntry {
  slotId: string;
  filename: string;
  mimeType: string;
  size: number;
  sha256?: string;
  /**
   * Local-only path or storage URI where this device can read the bytes for
   * execution. Browser builds use an IndexedDB URI; CLI runs use an absolute
   * filesystem path under `.apicircle/workspace-<id>/attachments/`.
   */
  localPath: string;
  storage: 'indexeddb' | 'filesystem';
  source: 'workspace' | 'linked-workspace';
  linkedWorkspaceId?: string;
  requiredBy: Array<{ requestId: string; requestName: string }>;
  downloadedAt: string;
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

/**
 * Entry in the global / plan-level environment priority order. Both local
 * environments and linked-workspace environments are first-class citizens
 * — the consumer can interleave them in any order and the resolver layers
 * them top-down at request-time. The two `kind`s exist because linked envs
 * need a `linkedWorkspaceId` to resolve against the right snapshot in
 * `WorkspaceLocal.linkedCollections` (and to apply the consumer's per-row
 * overrides from `synced.linkedOverrides.environmentVars`).
 *
 * Stored in `WorkspaceSynced.environments.priorityOrder` and
 * `ExecutionPlan.envPriorityOrder`.
 */
export type EnvPriorityRef =
  | { kind: 'local'; name: string }
  | {
      kind: 'linked';
      linkedWorkspaceId: string;
      envName: string;
    };

// Encrypted variables MUST set `secretKeyId`, which references
// `WorkspaceSynced.secretKeys[id]`. When `encrypted: true`, `value` carries
// the AES-GCM ciphertext (`enc:v1:<iv>:<ciphertext>`) produced with a key
// derived from the slot's plaintext value via PBKDF2 + the slot's salt.
// Ciphertext travels through Git; the slot value never does — each user
// supplies it on their own device. CLI runs receive values via
// APICIRCLE_SECRET_<id>=… or `--secrets <file>.json`.
export interface EnvironmentVariable {
  key: string;
  value: string;
  encrypted: boolean;
  secretKeyId?: string;
}

// Synced metadata for secret-vault slots. Holds id + label so collaborators
// see consistent names for `{{LABEL}}` refs, plus the per-slot salt used
// when deriving an AES-GCM key from the slot's plaintext value. Salts are
// not secret — keeping them in Git is what makes ciphertext from one
// device decryptable on another (given the same plaintext value).
export interface SecretKeyMeta {
  id: string;
  label: string;
  // Base64-encoded random salt (16 bytes). Mixed into PBKDF2 alongside the
  // user-supplied slot value to derive the slot's encryption key. Per slot
  // so two slots with the same plaintext value still produce distinct keys.
  salt: string;
  createdAt: string;
}

/**
 * Workspace-passphrase crypto parameters. Persisted in `WorkspaceSynced.
 * secretCrypto`, written by `setupPassphrase` and read by `unlockSecretCrypto`.
 * Single-version contract for now (`pbkdf2-sha256-v1`); future versions
 * will be additional discriminants on `kdf`.
 *
 * `salt` is base64-encoded 16 random bytes; `verifier` is base64-encoded
 * AES-GCM ciphertext of a fixed sentinel string under the derived key with
 * a zero IV — comparing it constant-time tells a right passphrase from a
 * wrong one before any real decrypt is attempted.
 */
export interface SecretCryptoMeta {
  kdf: 'pbkdf2-sha256-v1';
  salt: string;
  iterations: number;
  verifier: string;
}

// LinkedWorkspace — replaces v1's Repo + apiConnectionSessions. Every
// version-update action requires explicit user confirmation; updatePolicy is
// fixed to 'manual' for v2.0.
export interface LinkedWorkspace {
  id: string;
  kind: 'private' | 'public';
  name: string;
  description?: string;
  /** The remote workspace's `workspaceId` (from the source's registry).
   *  Needed to resolve per-workspace paths (attachments, workspace.json)
   *  when fetching from the source repo. */
  sourceWorkspaceId: string;
  source: {
    provider: 'github';
    repoFullName: string;
    branch: string;
    /**
     * Which GitHub session credentials this link uses for `workspace.json`
     * fetches at link / refresh time.
     *
     *   - `'workspace'` — reuse `local.sessions.github.workspace` (the same
     *     PAT that pushes/pulls THIS workspace). Convenient when both repos
     *     are reachable from a single token.
     *   - `'dedicated'` — use a per-link PAT stored at
     *     `local.sessions.github.links[linkedWorkspaceId]`. Used when the
     *     source repo lives under a different account (different org, a
     *     bot user, a teammate's fork) that the workspace session can't
     *     read.
     *
     * Public links still pick a mode — even public-repo fetches today route
     * through `GitHubClient.getContents`, which uses an auth header.
     */
    sessionMode: 'workspace' | 'dedicated';
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
  // SHA-256 of workspace.json at publish time. Verifiable on the
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
  /**
   * @deprecated Plans now live on `WorkspaceSynced.executionPlans` so
   * they round-trip through Git (team-shared). This field is kept for
   * one schema version to support hydration migration only — code
   * should NOT write here. The hydration normalizer
   * `liftLegacyExecutionPlansToSynced` lifts any value found here into
   * `synced.executionPlans` on first load and clears it.
   */
  executionPlans: Record<string, ExecutionPlan>;
  history: {
    requestRuns: RequestRun[];
    planRuns: PlanRun[];
  };
  // Cross-workspace global secret vault. Distinguishes workspace-defined vs
  // required-by-linked-workspace, and tracks usage so the user can see where
  // each key is consumed before deleting it.
  secretIndex: SecretIndex;
  // GitHub credentials for this workspace, split by purpose.
  //
  //   - `workspace` — the PAT that drives push/pull/PR for THIS workspace's
  //     own repo. Single-valued. Disconnecting clears it but doesn't touch
  //     `links` — orphaned links surface a "session missing" warning so the
  //     user can re-auth or remap.
  //   - `links` — per-link dedicated PATs, keyed by `LinkedWorkspace.id`.
  //     Populated when a link is added with `sessionMode: 'dedicated'`. Used
  //     to fetch the source's `workspace.json` from a repo the workspace
  //     session can't read (different org, bot user, etc.).
  //
  // Both sides are encrypted at rest under the local master key. The
  // `tokenSecretId` on each session points into the `apicircle-secret-vault`
  // IDB store (per-device, never pushed to git).
  sessions: {
    github: {
      workspace: GitHubSession | null;
      links: Record<string, GitHubSession>;
    };
  };
  // The GitHub repo the user has bound this workspace to. Holds metadata
  // copied from `GET /repos/:owner/:repo` at connect time so the UI can
  // render without re-fetching. Cleared on disconnect.
  connectedRepo: ConnectedRepo | null;
  workingBranch: WorkingBranch | null;
  /**
   * Blob sha of the scaffold `workspace.json` written by
   * `seedInitialCommit`. Persisted so the next `createWorkingBranch` can
   * recognise its own scaffold on the new branch and suppress the
   * "remote already has content" first-pull prompt — that prompt only
   * makes sense for genuinely pre-populated remote content, not the
   * empty seed we just wrote ourselves. `null` once any other content
   * has overwritten the scaffold.
   */
  seededWorkspaceSha: string | null;
  /**
   * Set by `refreshWorkspace` when it detects that the working branch is
   * functionally over: the PR was merged on GitHub, OR the branch ref was
   * deleted out from under us (typically by GitHub's "delete branch on
   * merge" setting). `workingBranch` is cleared at the same time so the
   * UI flips back to the create-branch form, and this slot drives a
   * one-time banner pointing the user toward starting a new branch.
   * Cleared by `dismissRetiredBranch` once the user acknowledges or
   * creates a new branch.
   */
  retiredBranch: RetiredBranch | null;
  // 3-way diff snapshot for conflict-safe sync. See Sync section in the plan.
  sync: SyncSnapshot;
  // Cached collections + environments pulled from each linked workspace at
  // link / refresh time. Local-only because the consumer's own pushed JSON
  // shouldn't carry the source's whole tree — it's a materialization of
  // intent, not intent itself. Keyed by linkedWorkspace.id.
  linkedCollections: Record<string, LinkedSnapshot>;
  /**
   * Local-only attachment cache metadata. The bytes themselves live outside
   * workspace.json (IndexedDB in the web app, `.apicircle/attachments` for
   * the CLI). This tells execution where the bytes are available locally and
   * which request(s) require each file.
   */
  attachmentCache?: Record<string, LocalAttachmentCacheEntry>;
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
    /**
     * Whole-UI text-size scaling, expressed as a percentage of the
     * browser's default root font-size. The HTML root's `font-size` is
     * set to this percentage at hydrate / switch time, scaling every
     * Tailwind `rem`-based utility plus the Monaco editor's option in
     * `MonacoEditorBase`. Range: `FONT_SIZE_PERCENT_MIN`..`MAX`, snapped
     * to `FONT_SIZE_PERCENT_STEP`. Default `FONT_SIZE_PERCENT_DEFAULT`
     * (100) — matches the browser baseline so first-paint before
     * hydrate doesn't flash a different size.
     */
    fontSizePercent: number;
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
  /**
   * Pre-push buffer for Global File Asset bytes. Each entry mirrors the
   * IDB attachment record (which stays the authoritative byte store) but
   * is keyed by `globalFileAssetId` instead of `slotId`, making it easy
   * for the push flow + the status-pill UI to ask "is this asset still
   * pending upload?" without scanning IDB. Dropped per-asset after the
   * push promotes the asset to `workingBranchRef`.
   */
  pendingFileUploads?: Record<string, PendingFileUpload>;
  /**
   * Cross-cutting reference index for Global File Assets. Recomputed by
   * `assetUsageAggregator` whenever `commitSynced` runs, mirroring the
   * `secretIndex.entries[].usedIn` pattern. Local-only because it's pure
   * cache — the truth lives in `synced.collections.requests` and
   * `synced.mockServers`.
   */
  assetUsageIndex?: Record<string, AssetUsage>;
  /**
   * Slot ids whose attachment blob needs to be DELETED from the working
   * branch on the next push. Queued by `removeGlobalFileAsset` (and the
   * headless `globalAsset.removeFile` patch) when the asset being
   * deleted had any push provenance (`workingBranchRef` or
   * `baseBranchRef`). The push emits
   * `{path: '.apicircle/workspace-<id>/attachments/<slotId>', sha: null}`
   * tree entries layered over `base_tree`, which GitHub treats as
   * deletions. After a successful push, the queue is cleared — the
   * deletion is durable on the working branch, and the eventual PR
   * merge propagates it to the base branch.
   *
   * Without this queue, the asset would be removed from `workspace.json`
   * but the orphan blob would persist on the remote tree forever.
   */
  pendingAttachmentDeletes?: string[];
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
  pulledAt: string;
  ref: string;
  collections: WorkspaceSynced['collections'];
  environments: WorkspaceSynced['environments'];
  /**
   * Source workspace assets referenced by linked requests
   * (`bodySchemaId` / `graphqlSchemaId`). Cached locally with the linked
   * collections so linked editors and execution can resolve schema refs
   * without copying assets into the consumer's synced workspace.
   */
  globalAssets?: WorkspaceSynced['globalAssets'];
  /**
   * The source workspace's secret-key registry, cached so the link card
   * can render slot labels (not just raw ids). Optional — older
   * snapshots from before this field was tracked load with `undefined`,
   * and the card falls back to showing ids until the next refresh.
   */
  secretKeys?: Record<string, SecretKeyMeta>;
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
  /**
   * Whether this token can create pull requests, derived from a two-step
   * check: (1) scope inspection (`repo` on classic PATs OR `pull_request`
   * on fine-grained PATs covers PR creation), and (2) if the scope check
   * is inconclusive, a real `GET /repos/:owner/:repo/pulls` probe against
   * the connected repo. The PR-creation warning + Create PR button enable
   * state both read this flag instead of doing string-includes checks
   * against `grantedScopes` — which would false-fire for any classic PAT
   * (classic PATs don't have a separate `pull_request` scope; `repo`
   * already grants full PR powers, and that's what GitHub actually
   * accepts at runtime).
   *
   *   - `true`  — scope check confirmed OR probe returned 200
   *   - `false` — probe returned 403 with missing-scope hint
   *   - `null`  — not yet probed (no repo connected, or probe pending)
   */
  canCreatePullRequests: boolean | null;
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
  /**
   * Plan-scoped overlay for the workspace's env priority order. Empty
   * means "inherit the workspace order"; non-empty replaces it for runs
   * of this plan. Mixes local + linked envs the same way the workspace
   * order does — see `EnvPriorityRef`.
   */
  envPriorityOrder: EnvPriorityRef[];
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

/**
 * UI text-size scaling bounds. `fontSizePercent` on `WorkspaceLocal.ui`
 * is clamped to `[MIN, MAX]` and snapped to `STEP`. Below 80% the
 * smallest chrome (10–11px bracketed Tailwind sizes) becomes unreadable;
 * above 150% layout pressure mounts in narrow panels.
 */
export const FONT_SIZE_PERCENT_MIN = 80;
export const FONT_SIZE_PERCENT_MAX = 150;
export const FONT_SIZE_PERCENT_STEP = 10;
export const FONT_SIZE_PERCENT_DEFAULT = 100;

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

/**
 * A working branch that's been retired — either the PR was merged or the
 * branch was deleted on GitHub (or both). Persisted on `local.retiredBranch`
 * so the create-branch form can surface a "this branch is done — create a
 * new one" banner pointing back at the closed PR.
 *
 * Reasons:
 *   - `pr-merged`     — PR was merged. Branch may still exist on GitHub
 *                       (no auto-delete) or may be gone; either way it's
 *                       functionally retired.
 *   - `branch-deleted` — Branch ref returns 404. PR (if any) was not
 *                        merged — most likely a deliberate delete or a
 *                        closed-without-merge cleanup.
 */
export interface RetiredBranch {
  /** Branch name that was retired. */
  branchName: string;
  /** Why the branch is retired. */
  reason: 'pr-merged' | 'branch-deleted';
  /** ISO timestamp when retirement was detected. */
  retiredAt: string;
  /** PR HTML URL if one was opened (kept across retirement so the banner can link it). */
  prUrl: string | null;
  /** PR number if known — useful for the banner copy ("PR #42 was merged"). */
  prNumber: number | null;
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
