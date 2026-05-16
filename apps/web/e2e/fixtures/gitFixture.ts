// E2E git fixture (S4). Two responsibilities:
//
//   1. Intercept `https://api.github.com/**` and `https://github.com/login/**`
//      from the page and rewrite them to the localhost mock server's
//      `/_gh/*` endpoints. This is how the workspaceStore's
//      `new GitHubClient()` calls reach our in-memory mock.
//
//   2. Expose a `mockGithub` helper for spec setup — seed mock repos,
//      reset state, inspect mock state.
//
// The mock state lives in `apps/e2e-mock/src/routes/github.ts` and is
// shared across the test process via the mock server. The fixture
// resets the entire mock state on test setup so parallel workers don't
// step on each other; tests that need cross-worker isolation should
// scope their repo name by the worker index.

import { test as base, expect, type BrowserContext, type Page } from '@playwright/test';

export interface MockRepoSeed {
  owner: string;
  name: string;
  defaultBranch?: string;
  isPrivate?: boolean;
  pushable?: boolean;
  visibility?: 'public' | 'private' | 'internal';
  topics?: string[];
  seedFiles?: Array<{ path: string; content: string }>;
}

export interface MockGithubControl {
  /** Base URL of the mock server (the e2e-mock `webServer` config). */
  baseUrl: string;
  /** Reset all mock GitHub state (repos + device codes + viewer). */
  reset: () => Promise<void>;
  /** Create or replace a mock repo. */
  seedRepo: (seed: MockRepoSeed) => Promise<void>;
  /** Read the current mock state for a repo. */
  inspectRepo: (
    owner: string,
    name: string,
  ) => Promise<{
    repo: {
      name: string;
      full_name: string;
      default_branch: string;
      private: boolean;
      visibility: string;
    };
    refs: Record<string, string>;
    contents: Record<string, Record<string, { sha: string; content: string }>>;
    pulls: Array<{ number: number; head: string; base: string; title: string }>;
    releases: Array<{ id: number; tagName: string; htmlUrl: string }>;
  } | null>;
  /**
   * Install the redirect-routes onto the given context. Tests rarely
   * need this — `gitFixture` does it automatically. Exposed for the
   * twoContexts fixture which spawns its own contexts.
   */
  attachRoutes: (context: BrowserContext) => Promise<void>;
}

const MOCK_PORT = process.env.E2E_MOCK_PORT ?? '5176';
const MOCK_BASE = `http://localhost:${MOCK_PORT}`;

async function proxyToMock(
  route: import('@playwright/test').Route,
  rewrittenPath: string,
): Promise<void> {
  // route.continue({ url }) cannot change the protocol (https → http), so
  // fulfill the route by fetching the mock server directly and piping
  // the response back.
  const req = route.request();
  const init: RequestInit = {
    method: req.method(),
    // The browser's CORS/forbidden-header rules don't apply here since
    // we're running in Node — pass headers through verbatim.
    headers: req.headers(),
  };
  const post = req.postData();
  if (post !== null && post !== undefined) init.body = post;
  const target = `${MOCK_BASE}${rewrittenPath}`;
  const res = await fetch(target, init);
  const body = Buffer.from(await res.arrayBuffer());
  // Strip hop-by-hop / connection headers that fulfill() rejects.
  const headers: Record<string, string> = {};
  for (const [k, v] of res.headers) {
    const lk = k.toLowerCase();
    if (lk === 'content-encoding' || lk === 'transfer-encoding' || lk === 'connection') continue;
    headers[k] = v;
  }
  await route.fulfill({ status: res.status, headers, body });
}

async function installRoutes(context: BrowserContext): Promise<void> {
  // Rewrite api.github.com → mock /_gh/*
  await context.route('https://api.github.com/**', async (route) => {
    const url = new URL(route.request().url());
    await proxyToMock(route, `/_gh${url.pathname}${url.search}`);
  });
  // Rewrite github.com/login/* → mock /_gh/login/*
  await context.route('https://github.com/login/**', async (route) => {
    const url = new URL(route.request().url());
    await proxyToMock(route, `/_gh${url.pathname}${url.search}`);
  });
  // The web build proxies through `/_gh-oauth` on the same origin.
  await context.route('**/_gh-oauth/**', async (route) => {
    const url = new URL(route.request().url());
    const sub = url.pathname.replace(/^\/_gh-oauth/, '');
    await proxyToMock(route, `/_gh${sub}${url.search}`);
  });
}

interface GitFixture {
  mockGithub: MockGithubControl;
  appWithGithubMock: Page;
}

export const test = base.extend<GitFixture>({
  mockGithub: async ({}, use) => {
    const control: MockGithubControl = {
      baseUrl: MOCK_BASE,
      reset: async () => {
        await fetch(`${MOCK_BASE}/__gh`, { method: 'DELETE' });
      },
      seedRepo: async (seed) => {
        const res = await fetch(`${MOCK_BASE}/__gh/repos`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(seed),
        });
        if (!res.ok) {
          throw new Error(`mockGithub.seedRepo failed: HTTP ${res.status}`);
        }
      },
      inspectRepo: async (owner, name) => {
        const res = await fetch(`${MOCK_BASE}/__gh/repos/${owner}/${name}`);
        if (res.status === 404) return null;
        if (!res.ok) {
          throw new Error(`mockGithub.inspectRepo failed: HTTP ${res.status}`);
        }
        return (await res.json()) as Awaited<ReturnType<MockGithubControl['inspectRepo']>>;
      },
      attachRoutes: installRoutes,
    };
    await use(control);
  },

  appWithGithubMock: async ({ page, context, mockGithub }, use) => {
    // Don't reset the mock state here — parallel workers across spec
    // files would race on the shared global. Each test owns a unique
    // owner/name (via workerIndex + test scope) so the state is
    // additive-safe across concurrent runs.
    void mockGithub.baseUrl;
    await installRoutes(context);
    await page.goto('/');
    await expect(page.getByText('API Circle Studio', { exact: true })).toBeVisible();
    // Pre-seed an OAuth token in localStorage so the app sees a
    // "logged in" GitHub session — sidesteps the device-flow UI.
    await page.evaluate(() => {
      try {
        const token = 'ghp_mock_test_token';
        localStorage.setItem(
          'apicircle:github-session',
          JSON.stringify({ token, login: 'mock-user', scopes: ['repo', 'read:user'] }),
        );
      } catch {
        /* localStorage unavailable — ignore. */
      }
    });
    await use(page);
  },
});

export { expect } from '@playwright/test';
