import { expect, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import {
  type LiveGithubConfig,
  assertRemoteWorkspaceHasNoLocalOnlyData,
  createRepo,
  createPullRequest,
  deleteBranch,
  deleteRepo,
  fetchWorkspaceJson,
  makeDeterministicWorkspace,
  mergePullRequest,
  publishReleaseOnSource,
  seedRepoIfEmpty,
  setRepoTopics,
  updateWorkspaceJson,
  writeWorkspaceJson,
} from './_github-rest';

const ENABLE_ENV = 'APICIRCLE_E2E_LIVE_GITHUB';
const TOKEN_ENV = 'APICIRCLE_E2E_GITHUB_PAT';
const BOT_OWNER_ENV = 'APICIRCLE_E2E_BOT_OWNER';
const DEDICATED_TOKEN_ENV = 'APICIRCLE_E2E_BOT_PAT_LINK_DEDICATED';
const KEEP_ENV = 'APICIRCLE_E2E_KEEP_REPOS';
const LEGACY_KEEP_ENV = 'APICIRCLE_E2E_V2_KEEP_REPOS';

export interface V2BotConfig {
  token: string;
  owner: string;
  dedicatedToken: string | null;
}

export interface V2Tracker {
  trackRepo: (cfg: LiveGithubConfig) => LiveGithubConfig;
  trackBranch: (cfg: LiveGithubConfig, branch: string) => void;
  cleanup: () => Promise<void>;
}

export interface SeededSource {
  cfg: LiveGithubConfig;
  branch: string;
}

export interface SeedSourceAttachmentRequestArgs {
  slotId: string;
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
  url?: string;
  method?: 'POST' | 'PUT' | 'PATCH';
  requestName?: string;
  textFields?: Array<{ key: string; value: string }>;
  bodySchemaId?: string;
  graphqlSchemaId?: string;
}

export { assertRemoteWorkspaceHasNoLocalOnlyData, fetchWorkspaceJson, updateWorkspaceJson };
export { createPullRequest, mergePullRequest };
export { seedRepoIfEmpty };

export function v2SkipReason(): string | null {
  if (process.env[ENABLE_ENV] !== '1') return `Set ${ENABLE_ENV}=1 to run Live GitHub tests.`;
  if (!process.env[TOKEN_ENV]?.trim())
    return `Set ${TOKEN_ENV} to a classic PAT with repo + delete_repo.`;
  if (!process.env[BOT_OWNER_ENV]?.trim())
    return `Set ${BOT_OWNER_ENV} to the bot account or org login.`;
  return null;
}

export function getV2BotConfig(): V2BotConfig {
  const token = process.env[TOKEN_ENV]?.trim();
  const owner = process.env[BOT_OWNER_ENV]?.trim();
  if (!token || !owner) throw new Error('Live GitHub config missing after skip guard');
  return {
    token,
    owner,
    dedicatedToken: process.env[DEDICATED_TOKEN_ENV]?.trim() || null,
  };
}

export function keepV2Repos(): boolean {
  return process.env[KEEP_ENV] === '1' || process.env[LEGACY_KEEP_ENV] === '1';
}

export function createV2Tracker(): V2Tracker {
  const repos: LiveGithubConfig[] = [];
  const branches: Array<{ cfg: LiveGithubConfig; branch: string }> = [];
  return {
    trackRepo: (cfg) => {
      repos.push(cfg);
      return cfg;
    },
    trackBranch: (cfg, branch) => {
      branches.push({ cfg, branch });
    },
    cleanup: async () => {
      if (keepV2Repos()) {
        console.log(
          `[live-github] ${KEEP_ENV}=1, keeping repos: ${
            repos.map((repo) => `https://github.com/${repo.fullName}`).join(', ') || '<none>'
          }`,
        );
        return;
      }
      for (const item of branches.splice(0).reverse()) {
        await deleteBranch(item.cfg, item.branch);
      }
      for (const repo of repos.splice(0).reverse()) {
        try {
          await deleteRepo(repo.token, repo.owner, repo.name);
        } catch {
          /* orphan sweep catches cleanup misses */
        }
      }
    },
  };
}

export function makeV2BranchName(workerIndex: number, label: string): string {
  return `apicircle/e2e-live-${workerIndex}-${Date.now()}-${slug(label)}`;
}

export function v2Bytes(input: string): Uint8Array {
  return new Uint8Array(Buffer.from(input, 'utf8'));
}

export function sha256HexV2(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function attachmentBlobPathV2(slotId: string): string {
  return `.apicircle/attachments/${slotId}`;
}

export async function createV2Repo(
  bot: V2BotConfig,
  label: string,
  visibility: 'private' | 'public' = 'private',
): Promise<LiveGithubConfig> {
  const created = await createRepo(bot.token, {
    owner: bot.owner,
    name: `apicircle-e2e-live-${slug(label).slice(0, 34)}-${visibility}-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 8)}`,
    visibility,
  });
  console.log(`[live-github] created ${visibility} repo: https://github.com/${created.fullName}`);
  return {
    token: bot.token,
    owner: created.owner,
    name: created.name,
    fullName: created.fullName,
  };
}

export async function createV2HostRepo(
  tracker: V2Tracker,
  bot: V2BotConfig,
  label: string,
  visibility: 'private' | 'public' = 'private',
): Promise<LiveGithubConfig> {
  const cfg = tracker.trackRepo(await createV2Repo(bot, `host-${label}`, visibility));
  await seedRepoIfEmpty(cfg, { workspaceJson: true });
  return cfg;
}

export async function createV2SourceRepo(
  tracker: V2Tracker,
  bot: V2BotConfig,
  label: string,
  visibility: 'private' | 'public' = 'private',
  opts: { version?: string; notes?: string } = {},
): Promise<SeededSource> {
  const cfg = tracker.trackRepo(await createV2Repo(bot, `source-${label}`, visibility));
  const head = await seedRepoIfEmpty(cfg);
  await writeWorkspaceJson(
    cfg,
    head.name,
    makeDeterministicWorkspace(`live-${label}`, {
      version: opts.version ?? '1.0.0',
      notes: opts.notes ?? `# V2 ${label} v1\n\n- Seeded by Live GitHub E2E.`,
    }),
    `e2e live: seed ${label}`,
  );
  if (visibility === 'public') {
    await setRepoTopics(cfg, ['apicircle', 'apicircle-e2e', 'apicircle-e2e-live']);
  }
  return { cfg, branch: head.name };
}

export async function connectAndBranchV2(
  page: Page,
  cfg: LiveGithubConfig,
  branch: string,
  tracker?: V2Tracker,
): Promise<{ branchSha: string }> {
  const result = await page.evaluate(
    async ({ token, owner, name, fullName, branchName }) => {
      const store = window.__apicircleStore;
      if (!store) throw new Error('__apicircleStore not exposed in this build');
      const api = store.getState() as any;
      const session = await api.connectGitHubSession(token);
      const repo = await api.connectRepo(owner, name);
      const created = await api.createWorkingBranch({ branchName });
      const state = store.getState() as any;
      return {
        accountLogin: session?.accountLogin ?? null,
        grantedScopes: session?.grantedScopes ?? [],
        repoFullName: repo?.fullName ?? state.local?.connectedRepo?.fullName ?? null,
        requestedBranch: branchName,
        createdBranch: created?.name ?? null,
        localBranch: state.local?.workingBranch?.name ?? null,
        expectedRepo: fullName,
      };
    },
    {
      token: cfg.token,
      owner: cfg.owner,
      name: cfg.name,
      fullName: cfg.fullName,
      branchName: branch,
    },
  );
  expect(result.accountLogin, 'GitHub session should connect').toBeTruthy();
  expect(result.repoFullName?.toLowerCase(), 'connected repo should match').toBe(
    cfg.fullName.toLowerCase(),
  );
  expect(result.createdBranch, 'createWorkingBranch should return requested branch').toBe(branch);
  expect(result.localBranch, 'local.workingBranch.name should equal requested branch').toBe(branch);
  const ref = await fetchBranchRefV2(cfg, branch);
  expect(ref.sha, 'GitHub ref should exist for requested branch').toMatch(/^[a-f0-9]{40}$/);
  tracker?.trackBranch(cfg, branch);
  return { branchSha: ref.sha };
}

export async function disconnectV2(page: Page): Promise<void> {
  await page
    .evaluate(async () => {
      try {
        await window.__apicircleStore?.getState().disconnectGitHubSession();
      } catch {
        /* ignore */
      }
    })
    .catch(() => undefined);
}

export async function pushAndFetchWorkspaceV2(
  page: Page,
  cfg: LiveGithubConfig,
  branch: string,
  message: string,
): Promise<Record<string, any>> {
  const pushed = await page.evaluate(async (commitMessage) => {
    const api = window.__apicircleStore!.getState() as any;
    return api.pushWorkspace(commitMessage);
  }, message);
  expect(pushed.commitSha).toMatch(/^[a-f0-9]{40}$/);
  return (await fetchWorkspaceJson(cfg, branch)).json as Record<string, any>;
}

export async function publishSourceVersionV2(
  source: SeededSource,
  label: string,
  opts: { version?: string; deprecated?: boolean; yanked?: boolean } = {},
): Promise<void> {
  const version = opts.version ?? '1.1.0';
  await publishReleaseOnSource(
    source.cfg,
    source.branch,
    version,
    `# V2 ${label} ${version}\n\n- Updated by live E2E.`,
    (ws) => {
      const safe = slug(label);
      const requests = ((ws.collections as any)?.requests ?? {}) as Record<string, any>;
      const req = Object.values(requests)[0] as any;
      if (req) {
        req.name = `V2 ${label} request ${version}`;
        req.method = 'PATCH';
        req.url = `https://source.example.test/${safe}/${version}`;
        req.body = { type: 'json', content: JSON.stringify({ version }) };
      }
      const env = Object.values(
        ((ws.environments as any)?.items ?? {}) as Record<string, any>,
      )[0] as any;
      if (env?.variables) {
        env.variables = env.variables.map((v: any) =>
          v.key === 'BASE_URL' ? { ...v, value: `https://env.example.test/${safe}/${version}` } : v,
        );
      }
    },
  );
  if (opts.deprecated || opts.yanked) {
    await updateWorkspaceJson(source.cfg, source.branch, `e2e live: flag ${version}`, (ws) => {
      const versions = ((ws.releases as any)?.self?.versions ?? []) as Array<
        Record<string, unknown>
      >;
      const target = versions.find((v) => v.version === version);
      if (target) {
        if (opts.deprecated) target.deprecated = true;
        if (opts.yanked) target.yanked = true;
      }
    });
  }
}

export async function seedSourceAttachmentRequestV2(
  source: SeededSource,
  args: SeedSourceAttachmentRequestArgs,
): Promise<{ sha256: string }> {
  const sha256 = sha256HexV2(args.bytes);
  await updateWorkspaceJson(
    source.cfg,
    source.branch,
    `e2e live: seed attachment ${args.slotId}`,
    (ws) => {
      const typed = ws as Record<string, any>;
      const req = Object.values(typed.collections.requests)[0] as any;
      if (!req)
        throw new Error(
          `source workspace ${source.cfg.fullName} has no request to attach ${args.slotId}`,
        );
      req.name = args.requestName ?? req.name;
      req.method = args.method ?? 'POST';
      req.url = args.url ?? req.url;
      req.body = {
        type: 'form-data',
        content: '',
        formRows: [
          ...(args.textFields ?? [{ key: 'source', value: 'linked' }]).map((field) => ({
            kind: 'text',
            key: field.key,
            value: field.value,
            enabled: true,
          })),
          {
            kind: 'file',
            key: 'upload',
            slotId: args.slotId,
            filename: args.filename,
            size: args.bytes.length,
            mimeType: args.mimeType,
            sha256,
            enabled: true,
          },
        ],
      };
      if (args.bodySchemaId) req.bodySchemaId = args.bodySchemaId;
      if (args.graphqlSchemaId) req.graphqlSchemaId = args.graphqlSchemaId;
    },
  );
  await writeRepoFileV2(
    source.cfg,
    source.branch,
    attachmentBlobPathV2(args.slotId),
    args.bytes,
    `e2e live: write attachment ${args.slotId}`,
  );
  return { sha256 };
}

export async function waitForLinkedLedgerVersionV2(
  page: Page,
  linkedWorkspaceId: string,
  version: string,
): Promise<void> {
  await page.evaluate(
    async ({ id, targetVersion }) => {
      let lastVersion: string | null = null;
      for (let attempt = 0; attempt < 12; attempt += 1) {
        const api = window.__apicircleStore!.getState() as any;
        await api.refreshLinkedWorkspace(id);
        const ledger = (window.__apicircleStore!.getState() as any).synced.releases.perLink[id];
        lastVersion = ledger?.currentVersion ?? null;
        if (lastVersion === targetVersion) return;
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      throw new Error(
        `Timed out waiting for linked ledger ${id} to reach ${targetVersion}; last=${lastVersion}`,
      );
    },
    { id: linkedWorkspaceId, targetVersion: version },
  );
}

export async function fetchBranchRefV2(
  cfg: LiveGithubConfig,
  branch: string,
): Promise<{ ref: string; sha: string }> {
  const refPath = branch.split('/').map(encodeURIComponent).join('/');
  const res = await fetch(
    `https://api.github.com/repos/${cfg.owner}/${cfg.name}/git/ref/heads/${refPath}`,
    {
      headers: ghNodeHeaders(cfg.token),
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '<no-body>');
    throw new Error(`fetchBranchRefV2 ${cfg.fullName}@${branch} failed (${res.status}): ${text}`);
  }
  const body = (await res.json()) as { ref: string; object: { sha: string } };
  return { ref: body.ref, sha: body.object.sha };
}

export async function writeRepoFileV2(
  cfg: LiveGithubConfig,
  branch: string,
  path: string,
  bytes: Uint8Array,
  message: string,
): Promise<{ commitSha: string; contentSha: string }> {
  const res = await fetch(
    `https://api.github.com/repos/${cfg.owner}/${cfg.name}/contents/${path
      .split('/')
      .map(encodeURIComponent)
      .join('/')}`,
    {
      method: 'PUT',
      headers: { ...ghNodeHeaders(cfg.token), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        branch,
        content: Buffer.from(bytes).toString('base64'),
      }),
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '<no-body>');
    throw new Error(
      `writeRepoFileV2 ${cfg.fullName}@${branch}:${path} failed (${res.status}): ${text}`,
    );
  }
  const body = (await res.json()) as { commit: { sha: string }; content: { sha: string } };
  return { commitSha: body.commit.sha, contentSha: body.content.sha };
}

export async function fetchRepoFileBytesV2(
  cfg: LiveGithubConfig,
  branch: string,
  path: string,
): Promise<Uint8Array> {
  const res = await fetch(
    `https://api.github.com/repos/${cfg.owner}/${cfg.name}/contents/${path
      .split('/')
      .map(encodeURIComponent)
      .join('/')}?ref=${encodeURIComponent(branch)}`,
    { headers: ghNodeHeaders(cfg.token) },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '<no-body>');
    throw new Error(
      `fetchRepoFileBytesV2 ${cfg.fullName}@${branch}:${path} failed (${res.status}): ${text}`,
    );
  }
  const body = (await res.json()) as { content: string; encoding: string };
  if (body.encoding !== 'base64') throw new Error(`Expected base64 file content for ${path}`);
  return new Uint8Array(Buffer.from(body.content.replace(/\n/g, ''), 'base64'));
}

export async function assertRepoReadableWithTokenV2(
  token: string,
  cfg: LiveGithubConfig,
): Promise<void> {
  const res = await fetch(`https://api.github.com/repos/${cfg.owner}/${cfg.name}`, {
    headers: ghNodeHeaders(token),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '<no-body>');
    throw new Error(`Expected token to read ${cfg.fullName}, got ${res.status}: ${text}`);
  }
}

export async function waitForMarketplaceResultV2(
  page: Page,
  repoFullName: string,
  query: string,
): Promise<void> {
  await page.evaluate(
    async ({ fullName, searchQuery }) => {
      for (let attempt = 0; attempt < 12; attempt += 1) {
        const api = window.__apicircleStore!.getState() as any;
        const items = await api.searchMarketplace(searchQuery);
        if (
          items.some((item: any) => String(item.fullName).toLowerCase() === fullName.toLowerCase())
        )
          return;
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
      throw new Error(`Marketplace search did not return ${fullName}`);
    },
    { fullName: repoFullName, searchQuery: query },
  );
}

function ghNodeHeaders(token: string): Record<string, string> {
  return {
    Authorization: `token ${token}`,
    Accept: 'application/vnd.github+json',
    'Cache-Control': 'no-cache',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

function slug(input: string): string {
  return (
    input
      .replace(/[^a-z0-9-]/gi, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase() || 'case'
  );
}
