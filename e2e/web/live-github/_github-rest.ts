// Node-side REST helpers for the canonical live GitHub Playwright suite
// (`e2e/web/live-github/*.spec.ts`). All flows in here hit the real
// `api.github.com`; the in-process GitHub mock is not used.
//
// Token rule: PATs are read from process.env at runtime. Never hard-code,
// never log, never echo them into error messages.

import type { Page } from '@playwright/test';

const ENABLE_ENV = 'APICIRCLE_E2E_LIVE_GITHUB';
const TOKEN_ENV = 'APICIRCLE_E2E_GITHUB_PAT';

/** On-disk path for the synced workspace document inside a Git repo. */
export const WORKSPACE_JSON_PATH = '.apicircle/workspace.json';

function buildContentsUrl(cfg: LiveGithubConfig, path: string, ref?: string): string {
  const base = `https://api.github.com/repos/${cfg.owner}/${cfg.name}/contents/${path
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`;
  return ref ? `${base}?ref=${encodeURIComponent(ref)}` : base;
}

export interface LiveGithubConfig {
  token: string;
  owner: string;
  name: string;
  fullName: string;
}

export interface StoreCommit {
  commitSha: string;
}

export interface StoreSession {
  accountLogin: string;
  grantedScopes: string[];
  canCreatePullRequests?: boolean | null;
}

export interface StoreRepo {
  fullName: string;
  pushable?: boolean;
  visibility?: string;
  defaultBranch?: string;
}

export interface StoreWorkingBranch {
  name: string;
  headSha?: string;
  baseBranch?: string;
}

export interface StoreApi {
  // GitHub session + repo
  connectGitHubSession: (token: string) => Promise<StoreSession>;
  connectRepo: (owner: string, name: string) => Promise<StoreRepo>;
  disconnectGitHubSession: () => Promise<void>;
  disconnectRepo: () => void;

  // Working branch + push + refresh
  createWorkingBranch: (opts?: { branchName?: string; baseBranch?: string }) => Promise<unknown>;
  pushWorkspace: (commitMessage?: string) => Promise<StoreCommit>;
  refreshWorkspace: () => Promise<{ status: string }>;

  // Workspace lifecycle
  createNewWorkspace: (name: string) => Promise<string>;
  switchWorkspace: (id: string) => Promise<void>;
  captureSnapshot: (args?: { trigger?: string; note?: string }) => string | null;
  restoreSnapshot: (id: string) => boolean;

  // Editor / Env / Plans / Mocks CRUD
  addRequest: (parentFolderId: string | null, name?: string) => string;
  removeRequest: (id: string) => void;
  renameRequest: (id: string, name: string) => void;
  setRequestMethod: (id: string, method: string) => void;
  setRequestUrl: (id: string, url: string) => void;
  setRequestBody: (id: string, body: unknown) => void;
  setRequestHeaders: (id: string, headers: unknown[]) => void;
  setRequestQuery: (id: string, query: unknown[]) => void;
  setRequestPathParams: (id: string, pathParams: Record<string, string>) => void;
  setRequestCookies: (id: string, cookies: unknown[]) => void;
  setRequestAssertions: (id: string, assertions: unknown[]) => void;
  setRequestAuth: (id: string, auth: unknown) => void;
  addFolder: (parentFolderId: string | null, name?: string) => string;
  removeFolder: (id: string) => void;
  renameFolder: (id: string, name: string) => void;
  addEnvironment: (name: string) => void;
  removeEnvironment: (name: string) => void;
  setVariables: (envName: string, variables: unknown) => void;
  setActiveEnvironment: (name: string | null) => void;
  setPriorityOrder: (order: unknown[]) => void;
  addPlan: (name?: string) => string;
  removePlan: (id: string) => void;
  renamePlan: (id: string, name: string) => void;
  addPlanStep: (planId: string, requestId: string, linkedWorkspaceId?: string) => void;
  removePlanStep: (planId: string, stepIndex: number) => void;
  setPlanStopOnFailure: (planId: string, stopOnAssertionFailure: boolean) => void;
  setPlanVariables: (planId: string, variables: unknown[]) => void;
  createMockServer: (args: { name: string; source: unknown }) => string;
  removeMockServer: (id: string) => void;
  addMockEndpoint: (serverId: string) => string;
  updateMockEndpoint: (serverId: string, endpointId: string, patch: unknown) => void;
  removeMockEndpoint: (serverId: string, endpointId: string) => void;

  // Secrets
  setupPassphrase: (passphrase: string) => Promise<{ ok: true } | { ok: false; reason: string }>;
  addSecret: (args: {
    label: string;
    value: string;
    origin: unknown;
    linkedWorkspaceId?: string;
    linkedKeyId?: string;
  }) => Promise<string>;
  bindVariableToSecretKey: (
    envName: string,
    index: number,
    secretKeyId: string,
  ) => Promise<boolean>;

  // Releases
  publishRelease: (args: { version: string; notes: string }) => Promise<{ commitSha?: string }>;
  deprecateRelease: (version: string) => void;
  yankRelease: (version: string) => void;

  // Linked workspaces
  linkPrivateWorkspace: (args: {
    repoFullName: string;
    branch: string;
    pinnedVersion?: string | null;
    sessionMode?: 'workspace' | 'dedicated';
    linkSessionToken?: string;
  }) => Promise<{ id: string }>;
  linkPublicWorkspace: (args: {
    repoFullName: string;
    branch: string;
    pinnedVersion?: string | null;
  }) => Promise<{ id: string }>;
  unlinkWorkspace: (id: string) => void;
  addLinkSession: (linkedWorkspaceId: string, token: string) => Promise<StoreSession>;
  refreshLinkedWorkspace: (id: string) => Promise<void>;
  previewLinkedUpdateForLink: (id: string) => Promise<void>;
  applyLinkedUpdateForLink: (resolutions: Record<string, unknown>) => Promise<void>;
  setLinkedRequestOverride: (linkedWorkspaceId: string, itemId: string, patch: unknown) => void;
  clearLinkedRequestOverride: (linkedWorkspaceId: string, itemId: string) => void;
  setLinkedEnvVarOverride: (
    linkedWorkspaceId: string,
    envName: string,
    varKey: string,
    patch: unknown,
  ) => void;
  clearLinkedEnvVarOverride: (linkedWorkspaceId: string, envName: string, varKey: string) => void;
  searchMarketplace: (query: string) => Promise<unknown[]>;
  commitRefresh: (resolutions: Record<string, 'mine' | 'theirs'>) => Promise<void>;
  cancelRefresh: () => void;

  // State (read-only views)
  local?: {
    connectedRepo?: { fullName: string; defaultBranch?: string } | null;
    workingBranch?: StoreWorkingBranch | null;
    retiredBranch?: { reason: string } | null;
    sync?: { lastPulledSnapshot?: unknown | null; lastPulledSha?: string | null };
    linkedCollections?: Record<string, unknown>;
    sessions?: {
      github?: {
        workspace?: { accountLogin?: string; grantedScopes?: string[] } | null;
        links?: Record<string, { accountLogin?: string; tokenSecretId?: string }>;
      };
    };
    snapshots?: { entries?: Array<{ id: string; triggeredBy?: string; note?: string }> };
    history?: { snapshots?: Array<{ id: string }> };
  };
  synced?: {
    id?: string;
    workspaceId?: string;
    secretKeys?: any;
    releases?: {
      self?: { versions: Array<{ version: string; deprecated?: boolean; yanked?: boolean }> };
    };
    collections?: { requests?: Record<string, unknown> };
    environments?: { items?: Record<string, unknown> };
    executionPlans?: Record<string, unknown>;
    mockServers?: Record<string, unknown>;
    linkedWorkspaces?: any;
    linkedOverrides?: {
      requests?: Record<string, unknown>;
      environmentVars?: Record<string, unknown>;
    };
  };
}

declare global {
  interface Window {
    __apicircleStore?: { getState: () => StoreApi; setState: (partial: unknown) => void };
  }
}

/**
 * Make a unique working-branch name for this run. Worker index +
 * unix-ms + a short slug keeps parallel branches distinct even if a
 * stray prior run failed to clean up.
 */
export function makeBranchName(workerIndex: number, slug: string): string {
  const safe = slug.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
  return `apicircle/e2e-${workerIndex}-${Date.now()}-${safe}`;
}

/**
 * Connect the workspace session + repo + create a fresh working
 * branch. Returns the branch name so afterAll can delete it.
 */
export async function connectAndBranch(
  page: Page,
  cfg: LiveGithubConfig,
  branchName: string,
): Promise<void> {
  await page.evaluate(
    async ({ token, owner, name, branch }) => {
      const store = window.__apicircleStore;
      if (!store) throw new Error('__apicircleStore not exposed in this build');
      const api = store.getState();
      await api.connectGitHubSession(token);
      await api.connectRepo(owner, name);
      await api.createWorkingBranch({ branchName: branch });
    },
    { token: cfg.token, owner: cfg.owner, name: cfg.name, branch: branchName },
  );
}

/**
 * Disconnect the session in `test.afterAll`. Wraps in catch so a
 * disconnect failure doesn't mask a real test failure.
 */
export async function disconnect(page: Page): Promise<void> {
  await page
    .evaluate(async () => {
      const store = window.__apicircleStore;
      if (!store) return;
      try {
        await store.getState().disconnectGitHubSession();
      } catch {
        /* ignore */
      }
    })
    .catch(() => undefined);
}

/**
 * Delete a working branch via raw GitHub REST. Idempotent - a 404 or
 * 422 is fine (branch already gone or never reached push). Calls go
 * directly to api.github.com from the test process (Node fetch), NOT
 * via the browser, so this works even after the page has navigated
 * away.
 */
export async function deleteBranch(cfg: LiveGithubConfig, branchName: string): Promise<void> {
  const ref = `heads/${branchName.split('/').map(encodeURIComponent).join('/')}`;
  const url = `https://api.github.com/repos/${cfg.owner}/${cfg.name}/git/refs/${ref}`;
  try {
    await fetch(url, {
      method: 'DELETE',
      headers: {
        Authorization: `token ${cfg.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
  } catch {
    /* network failure is non-fatal in cleanup */
  }
}

// --- Repo bootstrap (empty-repo handling) ---
//
// Production workflow expectation: an APICircle user can point a brand-new,
// freshly-created (and therefore empty) GitHub repository at the workspace
// and start working. The live-github E2E suite mirrors that workflow by
// seeding the sandbox repo on first run if it has no commits yet - no
// out-of-band UI clicks required.
//
// The three primitives below are idempotent so re-runs are cheap:
//   1. `getDefaultBranchHead` - `{name, sha}` if the default branch has a
//      HEAD commit; `{name, sha: null}` if the repo is empty.
//   2. `seedRepoIfEmpty` - `PUT /contents/README.md` on an empty repo to
//      create the first commit on the default branch.
//   3. `ensureWorkspaceJsonOnMain` - make sure the default branch carries
//      a valid `workspace.json` (the `linkPrivateWorkspace` precondition).

function ghHeaders(token: string): Record<string, string> {
  return {
    Authorization: `token ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

/**
 * Wrap `fetch` with retry-on-secondary-rate-limit. GitHub returns 403
 * with a body containing "secondary rate limit" (or 429) when the bot
 * PAT exceeds the per-minute content-creation budget — common when a
 * single live-github run creates 40+ repos in ~80 s. The response
 * carries a `Retry-After` header (seconds) that says when to retry;
 * we honor it, capping each wait at 75 s and the total attempt count
 * at 3. All other responses (including non-secondary 403s such as a
 * missing scope) pass through unchanged so caller error messages stay
 * specific.
 */
async function fetchWithSecondaryRateLimit(
  url: string,
  init: RequestInit,
  opts: { maxAttempts?: number; defaultRetryAfterSeconds?: number } = {},
): Promise<Response> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const defaultWaitSeconds = opts.defaultRetryAfterSeconds ?? 60;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const res = await fetch(url, init);
    if (res.ok || attempt === maxAttempts) return res;
    if (res.status !== 403 && res.status !== 429) return res;
    // Body must be inspected to distinguish secondary-rate-limit from
    // (e.g.) scope errors. `res.text()` consumes the body, so clone first
    // — failed-but-non-rate-limit responses still need their body for the
    // caller's error message.
    const bodyText = await res
      .clone()
      .text()
      .catch(() => '');
    const isSecondary =
      res.status === 429 ||
      /secondary rate limit|abuse detection|too many requests/i.test(bodyText);
    if (!isSecondary) return res;
    const retryAfterHeader = res.headers.get('retry-after');
    const retryAfter = Number(retryAfterHeader);
    const waitSeconds =
      Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 75) : defaultWaitSeconds;
    // Small jitter so concurrent callers don't unblock at the exact same
    // instant and re-trigger the secondary limit.
    const jitterMs = Math.floor(((attempt * 31) % 17) * 50);
    await wait(waitSeconds * 1000 + jitterMs);
  }
  // Unreachable: the final attempt returns above.
  throw new Error('fetchWithSecondaryRateLimit: loop exhausted without returning');
}

export interface DefaultBranchHead {
  name: string;
  sha: string | null;
}

/**
 * Resolve the repo's default branch name and current HEAD SHA. Returns
 * `{name, sha: null}` for a brand-new empty repo (default branch chosen
 * by GitHub but never created - `git/refs/heads/<branch>` 404s).
 */
export async function getDefaultBranchHead(cfg: LiveGithubConfig): Promise<DefaultBranchHead> {
  const repoRes = await fetch(`https://api.github.com/repos/${cfg.owner}/${cfg.name}`, {
    headers: ghHeaders(cfg.token),
  });
  if (!repoRes.ok) {
    throw new Error(
      `Sandbox repo ${cfg.fullName} not accessible to the test PAT (status ${repoRes.status}). Check the repo exists and the PAT has 'repo' scope.`,
    );
  }
  const repo = (await repoRes.json()) as { default_branch: string };
  const branch = repo.default_branch;
  const refRes = await fetch(
    `https://api.github.com/repos/${cfg.owner}/${cfg.name}/git/refs/heads/${encodeURIComponent(branch)}`,
    { headers: ghHeaders(cfg.token) },
  );
  if (refRes.status === 404 || refRes.status === 409) {
    // 404 - branch literally has no commits yet. 409 (Git Repository is
    // empty) is the older GitHub response for the same condition.
    return { name: branch, sha: null };
  }
  if (!refRes.ok) {
    throw new Error(`getRef on ${cfg.fullName}@${branch} failed: ${refRes.status}`);
  }
  const refBody = (await refRes.json()) as { object: { sha: string } };
  return { name: branch, sha: refBody.object.sha };
}

export interface SeedRepoOptions {
  /**
   * When true, also seed `workspace.json` on the default branch if it
   * doesn't already exist there. Required for the `linkPrivateWorkspace`
   * test to have something to probe.
   */
  workspaceJson?: boolean;
}

/**
 * Seed a `README.md` on the default branch if the repo is empty. Sequel
 * call: optionally also seed `workspace.json`. Idempotent - the second
 * and subsequent invocations are no-ops.
 *
 * Returns the resulting `DefaultBranchHead` (with a non-null `sha`) so
 * callers can chain on the seeded state.
 */
/**
 * Wait until `GET /repos/{owner}/{name}` returns 2xx. GitHub takes
 * ~500-3000 ms after `POST /user/repos` returns 201 to make the new repo
 * resolvable; calling `getDefaultBranchHead` immediately races that
 * propagation and 404s. Exponential backoff: 0.5/1/2/4/8/16/32 s, total
 * ~64 s ceiling — well below the suite's 90s per-test budget.
 *
 * The retry only swallows the 404 ("repo not propagated yet") case. Any
 * other error (403 missing scope, 401 bad token, transient 5xx) re-throws
 * immediately so we don't mask real failures behind silent retries.
 */
async function getDefaultBranchHeadWithPropagation(
  cfg: LiveGithubConfig,
): Promise<DefaultBranchHead> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      return await getDefaultBranchHead(cfg);
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      // `getDefaultBranchHead` throws on non-OK repo info — the propagation
      // race surfaces as `status 404`. Anything else is a real error.
      if (!msg.includes('status 404')) throw err;
      if (attempt === 7) break;
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
    }
  }
  throw lastErr ?? new Error('getDefaultBranchHeadWithPropagation: exhausted retries');
}

export async function seedRepoIfEmpty(
  cfg: LiveGithubConfig,
  opts: SeedRepoOptions = {},
): Promise<DefaultBranchHead> {
  // First call goes through the propagation-aware wrapper because callers
  // hit this immediately after `createRepo` and GitHub takes ~500-3000 ms
  // to make `GET /repos/{owner}/{name}` resolvable. The post-PUT refresh
  // below has its own polling loop for the parallel race where the
  // `git/refs/heads/<branch>` endpoint lags the PUT response.
  let head = await getDefaultBranchHeadWithPropagation(cfg);
  if (head.sha === null) {
    const putRes = await fetchWithSecondaryRateLimit(
      `https://api.github.com/repos/${cfg.owner}/${cfg.name}/contents/README.md`,
      {
        method: 'PUT',
        headers: { ...ghHeaders(cfg.token), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'e2e bootstrap: seed README on empty sandbox',
          content: Buffer.from(
            `# ${cfg.fullName}\n\nSeeded by APICircle E2E live-github suite.\n`,
          ).toString('base64'),
          branch: head.name,
        }),
      },
    );
    if (!putRes.ok) {
      const text = await putRes.text().catch(() => '<no-body>');
      throw new Error(`seedRepoIfEmpty: README seed failed (${putRes.status}): ${text}`);
    }
    // Refresh: poll until the new branch HEAD is visible. The PUT returns
    // 201 with the new commit, but the `GET /git/refs/heads/<branch>`
    // endpoint can take another ~500-3000 ms before it reflects the ref —
    // a one-shot bare `getDefaultBranchHead` here races that window and
    // throws `README PUT succeeded but default branch still has no SHA`
    // intermittently in CI. Backoff: 0.5/1/2/4/8/16/32 s, ~64 s ceiling,
    // mirroring the propagation-aware reader above.
    for (let attempt = 0; attempt < 8; attempt += 1) {
      head = await getDefaultBranchHead(cfg);
      if (head.sha !== null) break;
      if (attempt === 7) break;
      await wait(500 * 2 ** attempt);
    }
    if (head.sha === null) {
      throw new Error('seedRepoIfEmpty: README PUT succeeded but default branch still has no SHA');
    }
  }

  if (opts.workspaceJson) {
    await ensureWorkspaceJsonOnMain(cfg, head.name);
  }
  return head;
}

/**
 * Minimal `WorkspaceSynced`-compatible JSON used as the seed for an empty
 * `workspace.json` on the default branch. Mirrors the shape produced by
 * a fresh `createNewWorkspace()` - enough that `linkPrivateWorkspace`'s
 * probe round-trips successfully.
 */
const MIN_WORKSPACE_JSON = {
  workspaceId: 'e2e-seed-workspace',
  schemaVersion: 1,
  collections: { requests: {}, folders: {}, tree: { id: 'root', type: 'root', children: [] } },
  environments: { items: {}, activeName: null, priorityOrder: [] },
  executionPlans: {},
  mockServers: {},
  secretKeys: {},
  linkedWorkspaces: {},
  linkedOverrides: { requests: {}, environmentVars: {} },
  releases: { self: null, perLink: {} },
  // `files: {}` matches the shape the hydration normalizer backfills in
  // packages/ui-components/src/persistence/workspaceStorage.ts. Keep these
  // aligned — if the renderer adds `files: {}` after readback but the seed
  // omits it, deep-equality assertions against the original seeded shape
  // fail (the failure mode that broke
  // 15-execution-with-linked-assets.spec.ts and the file-asset paths of
  // 13-global-assets-live + 14-attachments-live).
  globalAssets: { schemas: {}, graphql: {}, files: {} },
  secretCrypto: null,
  meta: {
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    appVersion: 'e2e-live-github',
  },
} as const;

/**
 * Idempotently ensure a valid `.apicircle/workspace.json` exists on the
 * named branch. If absent, seeds it via the Contents API; otherwise no-op.
 * Required precondition for `linkPrivateWorkspace` tests against the
 * sandbox repo's default branch.
 */
export async function ensureWorkspaceJsonOnMain(
  cfg: LiveGithubConfig,
  branch: string,
): Promise<void> {
  const probeRes = await fetch(buildContentsUrl(cfg, WORKSPACE_JSON_PATH, branch), {
    headers: ghHeaders(cfg.token),
  });
  if (probeRes.ok) return; // already present — nothing to do.
  if (probeRes.status !== 404) {
    throw new Error(`workspace.json probe on ${cfg.fullName}@${branch} failed: ${probeRes.status}`);
  }
  const putRes = await fetchWithSecondaryRateLimit(buildContentsUrl(cfg, WORKSPACE_JSON_PATH), {
    method: 'PUT',
    headers: { ...ghHeaders(cfg.token), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'e2e bootstrap: seed .apicircle/workspace.json',
      content: Buffer.from(`${JSON.stringify(MIN_WORKSPACE_JSON, null, 2)}\n`).toString('base64'),
      branch,
    }),
  });
  if (!putRes.ok) {
    const text = await putRes.text().catch(() => '<no-body>');
    throw new Error(`ensureWorkspaceJsonOnMain: PUT failed (${putRes.status}): ${text}`);
  }
}

export interface WorkspaceFile<T = Record<string, unknown>> {
  json: T;
  sha: string;
}

function isTransientWorkspaceReadFailure(status: number, body: string): boolean {
  if (status === 409) return true;
  if (status !== 404) return false;
  // GitHub Contents-API propagation race signatures we recover from:
  //   * "No commit found for the ref" / "Git Repository is empty" — the
  //     branch HEAD lags the PUT that created it.
  //   * Generic `{"message":"Not Found"}` from the Contents API — the
  //     branch HEAD has the new commit but the per-file Contents read
  //     replica still serves the pre-PUT 404 (observed back-to-back after
  //     `writeWorkspaceJson` returns 201, e.g. `createV2SourceRepo` →
  //     immediate `updateWorkspaceJson` in 15-execution-with-linked-assets).
  // `fetchWorkspaceJson` is only invoked against repos we expect to contain
  // `workspace.json` (we just seeded or pushed it), so generic 404s are
  // interpreted as propagation lag rather than "file truly absent". True
  // absence probes use a bare `fetch(...)` that bypasses this helper (see
  // `ensureWorkspaceJsonOnMain` and the existence check inside
  // `writeWorkspaceJson`).
  return (
    body.includes('No commit found for the ref') ||
    body.includes('Git Repository is empty') ||
    /"message"\s*:\s*"Not Found"/.test(body)
  );
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Read `workspace.json` from a repo branch through the GitHub Contents API.
 * Specs use this to assert the exact payload that collaborators would pull.
 *
 * Stale-read guard: when the caller knows the SHA of the commit they want
 * to observe (e.g. the `commitSha` returned by `api.pushWorkspace`), pass
 * it as `expectedCommitSha`. The request then uses `?ref=<commitSha>` so
 * GitHub serves the content addressed by the immutable commit hash rather
 * than the current branch HEAD — bypassing the Contents-API
 * eventual-consistency window where `?ref=<branchName>` can still return a
 * pre-push snapshot of the file for several seconds after `updateRef`
 * succeeds. The propagation race is exactly what broke
 * `10-snapshot-data-loss.spec.ts:73`: the host repo was seeded with an
 * empty `workspace.json` (`MIN_WORKSPACE_JSON.collections.requests = {}`),
 * the push committed the real workspace including the new request, but
 * the immediately-following branch-ref read kept serving the seed —
 * `requests[<uuid>]` was `undefined` and the assertion blew up.
 *
 * Cache-Control: no-cache is sent on every read so any intermediate HTTP
 * cache (rare on Node fetch but possible on hosted runners) is bypassed.
 */
export async function fetchWorkspaceJson<T = Record<string, unknown>>(
  cfg: LiveGithubConfig,
  branchOrSha: string,
  opts: { expectedCommitSha?: string } = {},
): Promise<WorkspaceFile<T>> {
  // Prefer the immutable commit SHA when provided — see docblock above.
  const ref = opts.expectedCommitSha ?? branchOrSha;
  let lastStatus = 0;
  let lastText = '<no-body>';
  // Exponential backoff 500/1000/2000/4000/8000/16000/32000 ms ≈ 63.5s
  // total, mirroring `getDefaultBranchHeadWithPropagation` above. The
  // previous 8 × `750 * (attempt + 1)` linear budget (~21s) intermittently
  // timed out against the Contents-API replica lag observed when
  // `createV2SourceRepo` is immediately followed by `updateWorkspaceJson`
  // (15-execution-with-linked-assets). 63s sits comfortably below the
  // 90s per-test timeout used by the `chromium-live-github` project.
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const res = await fetch(buildContentsUrl(cfg, WORKSPACE_JSON_PATH, ref), {
      headers: { ...ghHeaders(cfg.token), 'Cache-Control': 'no-cache' },
    });
    if (res.ok) {
      const body = (await res.json()) as { content: string; encoding: string; sha: string };
      if (body.encoding !== 'base64')
        throw new Error(`workspace.json had unexpected encoding: ${body.encoding}`);
      return {
        json: JSON.parse(Buffer.from(body.content, 'base64').toString('utf-8')) as T,
        sha: body.sha,
      };
    }
    lastStatus = res.status;
    lastText = await res.text().catch(() => '<no-body>');
    // A 404 on a known-committed SHA is itself a propagation race (the
    // commit hasn't replicated to the read replica yet) — treat it as
    // transient when we're reading by SHA.
    const transient =
      isTransientWorkspaceReadFailure(lastStatus, lastText) ||
      (opts.expectedCommitSha !== undefined && lastStatus === 404);
    if (!transient || attempt === 7) break;
    await wait(500 * 2 ** attempt);
  }
  throw new Error(`fetchWorkspaceJson ${cfg.fullName}@${ref} failed (${lastStatus}): ${lastText}`);
}

/**
 * Put a complete `workspace.json` document on a branch. If the file already
 * exists its SHA is supplied, otherwise the PUT creates the file.
 */
export async function writeWorkspaceJson(
  cfg: LiveGithubConfig,
  branch: string,
  workspace: Record<string, unknown>,
  message = 'e2e: update workspace.json',
): Promise<string> {
  // Retry budget: 6 attempts × ~0.75-4.5 s backoff covers the GitHub
  // Contents-API propagation window that opens after a recent push or
  // concurrent write. The two transient failure modes we recover from:
  //   * Probe transients (409 "empty repo" / 404 "no commit for the ref")
  //     — re-read on backoff.
  //   * PUT 409/422 SHA mismatch — Contents API returned a stale `sha` on
  //     the probe; re-read and retry with the fresh one.
  let lastStatus = 0;
  let lastText = '<no-body>';
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const existing = await fetch(buildContentsUrl(cfg, WORKSPACE_JSON_PATH, branch), {
      headers: ghHeaders(cfg.token),
    });
    let sha: string | undefined;
    if (existing.ok) {
      sha = ((await existing.json()) as { sha: string }).sha;
    } else if (existing.status !== 404) {
      const text = await existing.text().catch(() => '<no-body>');
      if (isTransientWorkspaceReadFailure(existing.status, text) && attempt < 5) {
        await wait(750 * (attempt + 1));
        continue;
      }
      throw new Error(`writeWorkspaceJson probe failed (${existing.status}): ${text}`);
    }
    const res = await fetchWithSecondaryRateLimit(buildContentsUrl(cfg, WORKSPACE_JSON_PATH), {
      method: 'PUT',
      headers: { ...ghHeaders(cfg.token), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        content: Buffer.from(`${JSON.stringify(workspace, null, 2)}\n`).toString('base64'),
        branch,
        ...(sha ? { sha } : {}),
      }),
    });
    if (res.ok) {
      const body = (await res.json()) as { content?: { sha?: string } };
      return body.content?.sha ?? '';
    }
    lastStatus = res.status;
    lastText = await res.text().catch(() => '<no-body>');
    if ((res.status === 409 || res.status === 422) && attempt < 5) {
      await wait(750 * (attempt + 1));
      continue;
    }
    throw new Error(
      `writeWorkspaceJson ${cfg.fullName}@${branch} failed (${res.status}): ${lastText}`,
    );
  }
  throw new Error(
    `writeWorkspaceJson ${cfg.fullName}@${branch} exhausted retries (last ${lastStatus}): ${lastText}`,
  );
}

export async function updateWorkspaceJson<T extends Record<string, unknown>>(
  cfg: LiveGithubConfig,
  branch: string,
  message: string,
  mutate: (workspace: T) => void,
): Promise<T> {
  const file = await fetchWorkspaceJson<T>(cfg, branch);
  mutate(file.json);
  await writeWorkspaceJson(cfg, branch, file.json, message);
  return file.json;
}

export interface DeterministicWorkspaceOptions {
  version?: string;
  notes?: string;
  requestUrl?: string;
  envValue?: string;
  deprecated?: boolean;
  yanked?: boolean;
}

/**
 * A full current-schema WorkspaceSynced document with one request, one
 * environment, one secret metadata slot, and one release. Source repos use
 * this instead of the legacy minimal seed so linked flows always have real
 * Editor + Environment material to adopt.
 */
export function makeDeterministicWorkspace(
  label: string,
  opts: DeterministicWorkspaceOptions = {},
): Record<string, unknown> {
  const safe = label.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
  const version = opts.version ?? '1.0.0';
  const now = '2026-01-01T00:00:00.000Z';
  const workspaceId = `e2e-${safe}-workspace`;
  const reqId = `e2e-${safe}-request`;
  const envName = `e2e-${safe}-env`;
  const secretId = `e2e-${safe}-secret`;
  return {
    workspaceId,
    schemaVersion: 1,
    collections: {
      tree: { id: 'root', type: 'root', children: [{ kind: 'request', id: reqId }] },
      folders: {},
      requests: {
        [reqId]: {
          id: reqId,
          name: `E2E ${label} request ${version}`,
          folderId: null,
          method: 'GET',
          url: opts.requestUrl ?? `https://source.example.test/${safe}/${version}`,
          headers: [{ key: 'Accept', value: 'application/json', enabled: true }],
          query: [{ key: 'version', value: version, enabled: true }],
          pathParams: {},
          cookies: [],
          body: { type: 'json', content: JSON.stringify({ version }) },
          auth: { type: 'none' },
          contextVars: [],
          extractions: [],
          assertions: [{ id: `assert-${safe}`, kind: 'status', op: 'equals', expected: 200 }],
          createdAt: now,
          updatedAt: now,
        },
      },
    },
    environments: {
      items: {
        [envName]: {
          name: envName,
          variables: [
            {
              key: 'BASE_URL',
              value: opts.envValue ?? `https://env.example.test/${safe}/${version}`,
              encrypted: false,
            },
            {
              key: 'API_TOKEN',
              value: `enc:v1:${safe}:${version}`,
              encrypted: true,
              secretKeyId: secretId,
            },
          ],
        },
      },
      activeName: envName,
      priorityOrder: [{ kind: 'local', name: envName }],
    },
    linkedWorkspaces: {},
    linkedOverrides: { requests: {}, environmentVars: {} },
    releases: {
      self: {
        versions: [
          {
            version,
            notes: opts.notes ?? `# ${label} ${version}\n\n- Seeded by live GitHub E2E.`,
            publishedAt: now,
            workspaceSnapshot: `${workspaceId}@${version}`,
            deprecated: opts.deprecated ?? false,
            yanked: opts.yanked ?? false,
          },
        ],
        currentVersion: version,
      },
      perLink: {},
    },
    // Same `files: {}` invariant as MIN_WORKSPACE_JSON above — keep them
    // aligned with the hydration normalizer.
    globalAssets: { schemas: {}, graphql: {}, files: {} },
    mockServers: {},
    executionPlans: {},
    secretKeys: {
      [secretId]: {
        id: secretId,
        label: `E2E_${safe.toUpperCase()}_TOKEN`,
        salt: Buffer.from(`salt:${safe}`).toString('base64'),
        createdAt: now,
      },
    },
    secretCrypto: null,
    meta: { createdAt: now, updatedAt: now, appVersion: 'e2e-live-github' },
  };
}

export function assertRemoteWorkspaceHasNoLocalOnlyData(
  workspace: unknown,
  opts: { forbiddenNeedles?: string[] } = {},
): void {
  const text = JSON.stringify(workspace);
  const forbiddenKeys = [
    '"sessions"',
    '"tokenSecretId"',
    '"linkedCollections"',
    '"snapshots"',
    '"history"',
    '"requestRuns"',
    '"planRuns"',
    '"secretIndex"',
    '"pendingRefresh"',
    '"activeLinkedUpdate"',
  ];
  for (const key of forbiddenKeys) {
    if (text.includes(key)) {
      throw new Error(`workspace.json contains local-only key ${key}`);
    }
  }
  for (const needle of opts.forbiddenNeedles ?? []) {
    if (needle && text.includes(needle)) {
      throw new Error(
        `workspace.json contains forbidden secret/material: ${needle.slice(0, 12)}...`,
      );
    }
  }
}

export async function setRepoTopics(cfg: LiveGithubConfig, topics: string[]): Promise<string[]> {
  assertBotOwner(cfg.owner, 'setRepoTopics');
  const res = await fetch(`https://api.github.com/repos/${cfg.owner}/${cfg.name}/topics`, {
    method: 'PUT',
    headers: { ...ghHeaders(cfg.token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ names: topics.map((t) => t.trim().toLowerCase()).filter(Boolean) }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '<no-body>');
    throw new Error(`setRepoTopics ${cfg.fullName} failed (${res.status}): ${text}`);
  }
  const body = (await res.json()) as { names?: string[] };
  return body.names ?? [];
}

// --- Repo lifecycle (create / delete via REST) ---
//
// Used by the live pipeline + by specs that need a fresh repo per run
// (e.g. cross-repo-linking creates a third repo at test time). The
// safety guard: every repo-mutating call asserts the owner matches the
// configured bot owner so a typo can't destroy something that matters.

const BOT_OWNER_ENV = 'APICIRCLE_E2E_BOT_OWNER';

export function getBotOwner(): string | null {
  return process.env[BOT_OWNER_ENV]?.trim() || null;
}

/**
 * Bot-owner safety guard. Refuses to operate on any repo whose owner
 * doesn't match `APICIRCLE_E2E_BOT_OWNER`. When the env var is unset
 * (local dev against your own repo), the guard is permissive but logs
 * a one-time warning so you know the safety rail is off.
 */
function assertBotOwner(owner: string, action: string): void {
  const bot = getBotOwner();
  if (bot === null) return; // local dev: no guard
  if (owner !== bot) {
    throw new Error(
      `${action} refused: owner "${owner}" does not match APICIRCLE_E2E_BOT_OWNER="${bot}". This guard exists so a typo cannot delete a non-bot repo.`,
    );
  }
}

export interface CreateRepoArgs {
  owner: string;
  name: string;
  visibility: 'public' | 'private';
  /** If `owner` is an org, pass true. Otherwise the call goes to /user/repos. */
  isOrg?: boolean;
  description?: string;
}

export interface CreatedRepo {
  fullName: string;
  owner: string;
  name: string;
  defaultBranch: string;
  isPrivate: boolean;
}

/**
 * Create a repository under the bot owner. Returns metadata once
 * GitHub returns 201. Throws on conflict - caller is expected to use
 * a unique name per run (e.g. `apicircle-e2e-private-<run_id>`).
 */
export async function createRepo(token: string, args: CreateRepoArgs): Promise<CreatedRepo> {
  assertBotOwner(args.owner, 'createRepo');
  const url = args.isOrg
    ? `https://api.github.com/orgs/${args.owner}/repos`
    : `https://api.github.com/user/repos`;
  const res = await fetchWithSecondaryRateLimit(url, {
    method: 'POST',
    headers: { ...ghHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: args.name,
      private: args.visibility === 'private',
      visibility: args.visibility,
      description: args.description ?? 'APICircle e2e ephemeral auto-managed repository',
      auto_init: false,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '<no-body>');
    throw new Error(`createRepo ${args.owner}/${args.name} failed (${res.status}): ${text}`);
  }
  const body = (await res.json()) as {
    full_name: string;
    owner: { login: string };
    name: string;
    default_branch: string;
    private: boolean;
  };
  return {
    fullName: body.full_name,
    owner: body.owner.login,
    name: body.name,
    defaultBranch: body.default_branch,
    isPrivate: body.private,
  };
}

/**
 * Delete a repository under the bot owner. Idempotent - a 404 is fine
 * (already deleted). Requires `delete_repo` scope on the token.
 */
export async function deleteRepo(token: string, owner: string, name: string): Promise<void> {
  assertBotOwner(owner, 'deleteRepo');
  const res = await fetch(`https://api.github.com/repos/${owner}/${name}`, {
    method: 'DELETE',
    headers: ghHeaders(token),
  });
  if (res.status === 404) return;
  if (!res.ok) {
    const text = await res.text().catch(() => '<no-body>');
    throw new Error(`deleteRepo ${owner}/${name} failed (${res.status}): ${text}`);
  }
}

// --- Pull request lifecycle ---

export interface CreatePullRequestArgs {
  head: string;
  base: string;
  title: string;
  body?: string;
}

export interface PullRequestSummary {
  number: number;
  htmlUrl: string;
  state: string;
}

export async function createPullRequest(
  cfg: LiveGithubConfig,
  args: CreatePullRequestArgs,
): Promise<PullRequestSummary> {
  const res = await fetch(`https://api.github.com/repos/${cfg.owner}/${cfg.name}/pulls`, {
    method: 'POST',
    headers: { ...ghHeaders(cfg.token), 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '<no-body>');
    throw new Error(`createPullRequest failed (${res.status}): ${text}`);
  }
  const body = (await res.json()) as { number: number; html_url: string; state: string };
  return { number: body.number, htmlUrl: body.html_url, state: body.state };
}

export interface MergePullRequestResult {
  merged: boolean;
  sha: string;
  message: string;
}

export async function mergePullRequest(
  cfg: LiveGithubConfig,
  prNumber: number,
  opts: { method?: 'merge' | 'squash' | 'rebase'; commitTitle?: string } = {},
): Promise<MergePullRequestResult> {
  const res = await fetch(
    `https://api.github.com/repos/${cfg.owner}/${cfg.name}/pulls/${prNumber}/merge`,
    {
      method: 'PUT',
      headers: { ...ghHeaders(cfg.token), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        merge_method: opts.method ?? 'merge',
        commit_title: opts.commitTitle,
      }),
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '<no-body>');
    throw new Error(`mergePullRequest #${prNumber} failed (${res.status}): ${text}`);
  }
  const body = (await res.json()) as { merged: boolean; sha: string; message: string };
  return body;
}

/**
 * Force-update a branch ref to a different SHA. Used to simulate the
 * history-rewritten path in refresh tests.
 */
export async function forceUpdateRef(
  cfg: LiveGithubConfig,
  branchName: string,
  sha: string,
): Promise<void> {
  const ref = `heads/${branchName.split('/').map(encodeURIComponent).join('/')}`;
  const res = await fetch(`https://api.github.com/repos/${cfg.owner}/${cfg.name}/git/refs/${ref}`, {
    method: 'PATCH',
    headers: { ...ghHeaders(cfg.token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ sha, force: true }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '<no-body>');
    throw new Error(`forceUpdateRef ${branchName} failed (${res.status}): ${text}`);
  }
}

// --- Multi-workspace browser helpers ---

/**
 * Create + switch to a fresh workspace inside the same Playwright page,
 * run `fn`, then return to the original workspace id. Models the
 * "open the app on a different machine / different workspace" user story
 * without needing a separate browser context.
 *
 * Returns whatever `fn` returns so call sites can keep the result.
 */
export async function inNewWorkspace<T>(
  page: import('@playwright/test').Page,
  workspaceName: string,
  fn: () => Promise<T>,
): Promise<T> {
  const originalId = await page.evaluate(() => {
    const store = window.__apicircleStore;
    return store?.getState().synced?.id ?? null;
  });
  await page.evaluate(async (name) => {
    const api = window.__apicircleStore!.getState();
    const newId = await api.createNewWorkspace(name);
    await api.switchWorkspace(newId);
  }, workspaceName);
  try {
    return await fn();
  } finally {
    if (originalId) {
      await page
        .evaluate(async (id) => {
          await window.__apicircleStore!.getState().switchWorkspace(id);
        }, originalId)
        .catch(() => undefined);
    }
  }
}

/**
 * Delete the active workspace + switch to a freshly created one. Models
 * the "I'm done with this workspace, start fresh" user story (step 8 of
 * the live narrative).
 */
export async function deleteAndCreateWorkspace(
  page: import('@playwright/test').Page,
  newName: string,
): Promise<string> {
  return page.evaluate(async (name) => {
    const api = window.__apicircleStore!.getState() as unknown as StoreApi & {
      deleteWorkspaceById: (id: string) => Promise<void>;
      synced?: { id?: string };
    };
    const activeId = api.synced?.id;
    const newId = await api.createNewWorkspace(name);
    await api.switchWorkspace(newId);
    if (activeId && activeId !== newId) {
      try {
        await api.deleteWorkspaceById(activeId);
      } catch {
        /* tolerate - the new workspace is already active */
      }
    }
    return newId;
  }, newName);
}

// --- Orphan repo sweep (used by pipeline + local cleanup) ---

// --- Repo-mutation helpers (rename / archive / fork / branch-protection) ---

export async function archiveRepo(cfg: LiveGithubConfig, archived: boolean): Promise<void> {
  assertBotOwner(cfg.owner, 'archiveRepo');
  const res = await fetch(`https://api.github.com/repos/${cfg.owner}/${cfg.name}`, {
    method: 'PATCH',
    headers: { ...ghHeaders(cfg.token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ archived }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '<no-body>');
    throw new Error(`archiveRepo(${archived}) failed (${res.status}): ${text}`);
  }
}

export async function renameRepo(
  cfg: LiveGithubConfig,
  newName: string,
): Promise<LiveGithubConfig> {
  assertBotOwner(cfg.owner, 'renameRepo');
  const res = await fetch(`https://api.github.com/repos/${cfg.owner}/${cfg.name}`, {
    method: 'PATCH',
    headers: { ...ghHeaders(cfg.token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: newName }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '<no-body>');
    throw new Error(`renameRepo to "${newName}" failed (${res.status}): ${text}`);
  }
  return { token: cfg.token, owner: cfg.owner, name: newName, fullName: `${cfg.owner}/${newName}` };
}

export async function forkRepo(
  token: string,
  source: { owner: string; name: string },
  destOwner: string,
): Promise<CreatedRepo> {
  assertBotOwner(destOwner, 'forkRepo');
  const res = await fetch(`https://api.github.com/repos/${source.owner}/${source.name}/forks`, {
    method: 'POST',
    headers: { ...ghHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '<no-body>');
    throw new Error(`forkRepo failed (${res.status}): ${text}`);
  }
  const body = (await res.json()) as {
    full_name: string;
    owner: { login: string };
    name: string;
    default_branch: string;
    private: boolean;
  };
  return {
    fullName: body.full_name,
    owner: body.owner.login,
    name: body.name,
    defaultBranch: body.default_branch,
    isPrivate: body.private,
  };
}

/**
 * Set branch protection on the default branch - `required_status_checks`
 * with a non-existent check name, which the bot will never satisfy, so
 * any direct push gets rejected. Used by the branch-protection edge case.
 */
export async function setBranchProtection(
  cfg: LiveGithubConfig,
  branch: string,
  opts: { requiredCheck?: string; allowForcePushes?: boolean } = {},
): Promise<void> {
  assertBotOwner(cfg.owner, 'setBranchProtection');
  const res = await fetch(
    `https://api.github.com/repos/${cfg.owner}/${cfg.name}/branches/${encodeURIComponent(branch)}/protection`,
    {
      method: 'PUT',
      headers: { ...ghHeaders(cfg.token), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        required_status_checks: {
          strict: true,
          contexts: [opts.requiredCheck ?? 'apicircle-e2e-never-satisfied'],
        },
        enforce_admins: true,
        required_pull_request_reviews: null,
        restrictions: null,
        allow_force_pushes: opts.allowForcePushes ?? false,
        allow_deletions: false,
      }),
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '<no-body>');
    throw new Error(`setBranchProtection failed (${res.status}): ${text}`);
  }
}

export async function removeBranchProtection(cfg: LiveGithubConfig, branch: string): Promise<void> {
  assertBotOwner(cfg.owner, 'removeBranchProtection');
  await fetch(
    `https://api.github.com/repos/${cfg.owner}/${cfg.name}/branches/${encodeURIComponent(branch)}/protection`,
    { method: 'DELETE', headers: ghHeaders(cfg.token) },
  ).catch(() => undefined);
}

/**
 * Append a release entry to a source repo's main `workspace.json` and
 * push the update - used by linked-version-transition tests to simulate
 * "source publishes a new version" without spinning up a second app
 * instance. Writes via the Contents API (auto-commits to the branch).
 */
export async function publishReleaseOnSource(
  cfg: LiveGithubConfig,
  branch: string,
  newVersion: string,
  notes: string,
  patch?: (ws: Record<string, unknown>) => void,
): Promise<void> {
  assertBotOwner(cfg.owner, 'publishReleaseOnSource');
  const getRes = await fetch(buildContentsUrl(cfg, WORKSPACE_JSON_PATH, branch), {
    headers: ghHeaders(cfg.token),
  });
  if (!getRes.ok) throw new Error(`publishReleaseOnSource: read failed (${getRes.status})`);
  const body = (await getRes.json()) as { content: string; sha: string };
  const decoded = JSON.parse(Buffer.from(body.content, 'base64').toString('utf-8')) as Record<
    string,
    unknown
  > & { releases?: { self?: { versions?: Array<{ version: string }>; currentVersion?: string } } };
  const releases = decoded.releases ?? { self: { versions: [], currentVersion: null } };
  const self = releases.self ?? { versions: [], currentVersion: null };
  self.versions = [
    ...(self.versions ?? []),
    {
      version: newVersion,
      notes,
      publishedAt: new Date().toISOString(),
      workspaceSnapshot: 'e2e-published-without-real-snapshot-hash',
      deprecated: false,
      yanked: false,
    } as unknown as { version: string },
  ];
  self.currentVersion = newVersion;
  decoded.releases = { ...releases, self } as unknown as typeof decoded.releases;
  if (patch) patch(decoded);
  const putRes = await fetch(buildContentsUrl(cfg, WORKSPACE_JSON_PATH), {
    method: 'PUT',
    headers: { ...ghHeaders(cfg.token), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: `e2e publish ${newVersion}`,
      content: Buffer.from(`${JSON.stringify(decoded, null, 2)}\n`).toString('base64'),
      sha: body.sha,
      branch,
    }),
  });
  if (!putRes.ok) {
    const text = await putRes.text().catch(() => '<no-body>');
    throw new Error(`publishReleaseOnSource: write failed (${putRes.status}): ${text}`);
  }
}

/**
 * Append a `linkedWorkspaces` entry to a source repo's `workspace.json`
 * on the named branch. Used by the chain-link test to set up
 * "source-middle links source-leaf" without standing up a second app
 * instance. Idempotent: skips when a same-`repoFullName` link is
 * already present.
 */
export async function addLinkedWorkspaceOnSource(
  cfg: LiveGithubConfig,
  branch: string,
  link: { id: string; repoFullName: string; sourceBranch: string; pinnedVersion?: string | null },
): Promise<void> {
  assertBotOwner(cfg.owner, 'addLinkedWorkspaceOnSource');
  const getRes = await fetch(buildContentsUrl(cfg, WORKSPACE_JSON_PATH, branch), {
    headers: ghHeaders(cfg.token),
  });
  if (!getRes.ok) throw new Error(`addLinkedWorkspaceOnSource: read failed (${getRes.status})`);
  const body = (await getRes.json()) as { content: string; sha: string };
  const decoded = JSON.parse(Buffer.from(body.content, 'base64').toString('utf-8')) as Record<
    string,
    unknown
  > & {
    linkedWorkspaces?:
      | Record<string, { id: string; source?: { repoFullName?: string } }>
      | Array<{ id: string; source?: { repoFullName?: string } }>;
  };
  const rawExisting = decoded.linkedWorkspaces ?? {};
  const existingArray = Array.isArray(rawExisting) ? rawExisting : Object.values(rawExisting);
  const already = existingArray.find((l) => l.source?.repoFullName === link.repoFullName);
  if (already) return;
  const nextLink = {
    id: link.id,
    kind: 'private',
    name: link.repoFullName,
    source: {
      provider: 'github',
      repoFullName: link.repoFullName,
      branch: link.sourceBranch,
      sessionMode: 'workspace',
    } as unknown as { repoFullName: string },
    scope: ['collections', 'environments'],
    pinnedVersion: link.pinnedVersion ?? null,
    updatePolicy: 'manual',
    linkedAt: new Date().toISOString(),
    requiredSecretKeyIds: [],
  };
  decoded.linkedWorkspaces = Array.isArray(rawExisting)
    ? [...rawExisting, nextLink]
    : { ...rawExisting, [link.id]: nextLink };
  const putRes = await fetch(buildContentsUrl(cfg, WORKSPACE_JSON_PATH), {
    method: 'PUT',
    headers: { ...ghHeaders(cfg.token), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: `e2e add linked: ${link.repoFullName}`,
      content: Buffer.from(`${JSON.stringify(decoded, null, 2)}\n`).toString('base64'),
      sha: body.sha,
      branch,
    }),
  });
  if (!putRes.ok) {
    const text = await putRes.text().catch(() => '<no-body>');
    throw new Error(`addLinkedWorkspaceOnSource: write failed (${putRes.status}): ${text}`);
  }
}

// --- Extra env-var readers (org repos + dedicated link sessions) ---

export function getBotOrg(): string | null {
  return process.env.APICIRCLE_E2E_BOT_ORG?.trim() || null;
}

export function getDedicatedLinkToken(): string | null {
  return process.env.APICIRCLE_E2E_BOT_PAT_LINK_DEDICATED?.trim() || null;
}

// --- Rate-limit budget probe ---

/**
 * Read the bot PAT's current rate-limit budget. Returns the core API
 * remaining count and reset epoch. Specs can probe this and skip / fail
 * with a directed message rather than burn through 30+ tests under a
 * near-exhausted quota.
 */
export async function getRateLimit(
  token: string,
): Promise<{ remaining: number; limit: number; resetAt: Date }> {
  const res = await fetch('https://api.github.com/rate_limit', { headers: ghHeaders(token) });
  if (!res.ok) throw new Error(`getRateLimit failed (${res.status})`);
  const body = (await res.json()) as {
    resources: { core: { remaining: number; limit: number; reset: number } };
  };
  const core = body.resources.core;
  return { remaining: core.remaining, limit: core.limit, resetAt: new Date(core.reset * 1000) };
}

/**
 * List bot-owned repos matching a prefix that are older than `maxAgeMs`
 * and delete them. Returns the list of deleted full-names. Used by the
 * `scripts/live-github/sweep-orphans.mjs` entry point.
 */
export async function sweepOrphans(
  token: string,
  botOwner: string,
  prefix: string,
  maxAgeMs: number,
): Promise<string[]> {
  assertBotOwner(botOwner, 'sweepOrphans');
  const deleted: string[] = [];
  let page = 1;
  while (true) {
    const res = await fetch(
      `https://api.github.com/users/${botOwner}/repos?per_page=100&page=${page}&sort=created&direction=desc`,
      { headers: ghHeaders(token) },
    );
    if (!res.ok) throw new Error(`list repos failed (${res.status})`);
    const repos = (await res.json()) as Array<{ name: string; created_at: string }>;
    if (repos.length === 0) break;
    const cutoff = Date.now() - maxAgeMs;
    for (const r of repos) {
      if (!r.name.startsWith(prefix)) continue;
      if (new Date(r.created_at).getTime() > cutoff) continue;
      await deleteRepo(token, botOwner, r.name);
      deleted.push(`${botOwner}/${r.name}`);
    }
    if (repos.length < 100) break;
    page += 1;
  }
  return deleted;
}
