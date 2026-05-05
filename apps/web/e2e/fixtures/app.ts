import { expect, test as base, type Page, type Locator } from '@playwright/test';

// Shared fixtures for the v2 E2E suite. Each test gets:
//   - `app`: a Page already booted past hydration ("API Circle Studio"
//     visible) and with a clean IDB + localStorage.
//   - `mockApi`: a tiny fluent route mocker for `httpbin.org/anything`-style
//     endpoints so specs don't depend on the public internet.
//   - `monaco`: helpers to read/write Monaco editors by their wrapper's
//     aria-label (Playwright's `.fill()` doesn't work on the wrapper div,
//     so these focus the inner textarea + use the keyboard).

interface MockApi {
  /**
   * Reply to any `https://api.example.test/*` request (or a custom matcher)
   * with the given JSON body and status. Adds `content-type:
   * application/json` automatically.
   */
  json: (
    matcher: string | RegExp,
    body: unknown,
    init?: { status?: number; headers?: Record<string, string> },
  ) => Promise<void>;
  /** Reply with raw text. */
  text: (
    matcher: string | RegExp,
    body: string,
    init?: { status?: number; contentType?: string; headers?: Record<string, string> },
  ) => Promise<void>;
  /** Capture every fetch URL hit by the app for later assertions. */
  capturedUrls: () => string[];
}

interface MonacoHelpers {
  /** Wait for Monaco's lazy import to finish for the given aria-label. */
  ready: (label: string) => Promise<Locator>;
  /** Replace the contents of a Monaco editor (focus + Ctrl+A + type). */
  fill: (label: string, value: string) => Promise<void>;
  /** Read the editor's full text via Monaco's exported value. */
  read: (label: string) => Promise<string>;
}

interface SidebarHelpers {
  /**
   * Click the sidebar's "New request" button, fill the inline-rename input
   * with `name`, press Enter, and wait for the editor to switch to the new
   * request. Replaces the old `getByLabel('New request').click()` pattern
   * which silently fell through to whatever request was active because the
   * name-first prompt requires Enter to actually create.
   */
  createRequest: (name: string) => Promise<void>;
  /** Same flow for folders. */
  createFolder: (name: string) => Promise<void>;
}

/**
 * Helpers for talking to the localhost mock server (see apps/e2e-mock/).
 * Tests assert on actual wire shape via the introspection endpoint, which
 * is more truthful than any browser-side observation can be (page.route
 * intercepts can't drive challenge-response auth).
 */
interface E2eMock {
  /** Base URL of the mock server. Defaults to env override or 5176. */
  baseUrl: string;
  /** Resolve a path against the mock server's base URL. */
  url: (path: string) => string;
  /**
   * Resolve a path against the SAME-ORIGIN proxy (i.e. through the
   * Vite dev server's `/_mock` path). Use this instead of `url()` when
   * the test cares about Cookie/Set-Cookie behavior — the browser
   * strips Cookie on cross-origin requests, so cookie-on-wire tests
   * MUST go through the same-origin proxy. Cycle 12.
   */
  sameOriginUrl: (path: string) => string;
  /**
   * Clear the introspection buffer. Useful when running serially.
   * Parallel test runs share the buffer — prefer `findLastByPath` to
   * scope assertions to the test's own request.
   */
  clearInspection: () => Promise<void>;
  /** Most recent N captured requests, newest first. Default N=1. */
  inspectLast: (n?: number) => Promise<CapturedRequestSummary[]>;
  /**
   * Wait for the most recent captured request whose path satisfies the
   * matcher. Tolerates parallel-worker contention because each test
   * uses a unique path. Throws if the deadline elapses without a match.
   */
  findLastByPath: (
    matcher: (path: string) => boolean,
    opts?: { timeout?: number },
  ) => Promise<CapturedRequestSummary>;
}

export interface CapturedRequestSummary {
  capturedAt: string;
  method: string;
  url: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  cookies: Record<string, string>;
  body:
    | { kind: 'empty' }
    | { kind: 'text'; text: string }
    | { kind: 'json'; json: unknown }
    | { kind: 'form'; form: Record<string, string> }
    | {
        kind: 'multipart';
        parts: Array<{
          name: string;
          filename?: string;
          contentType?: string;
          text?: string;
          bytes?: number;
        }>;
      }
    | { kind: 'binary'; bytes: number };
}

interface Fixtures {
  app: Page;
  mockApi: MockApi;
  monaco: MonacoHelpers;
  sidebar: SidebarHelpers;
  e2eMock: E2eMock;
}

export const test = base.extend<Fixtures>({
  // eslint-disable-next-line no-empty-pattern
  app: async ({ page }, use) => {
    await page.goto('/');
    // The shell renders the brand once the workspace is hydrated. Use
    // exact match because a welcome banner ("Welcome to API Circle Studio")
    // would otherwise match too and trip strict mode.
    await expect(page.getByText('API Circle Studio', { exact: true })).toBeVisible();
    await use(page);
  },
  mockApi: async ({ page }, use) => {
    const captured: string[] = [];
    const json: MockApi['json'] = async (matcher, body, init) => {
      await page.route(matcher, async (route) => {
        captured.push(route.request().url());
        await route.fulfill({
          status: init?.status ?? 200,
          headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
          body: JSON.stringify(body),
        });
      });
    };
    const text: MockApi['text'] = async (matcher, body, init) => {
      await page.route(matcher, async (route) => {
        captured.push(route.request().url());
        await route.fulfill({
          status: init?.status ?? 200,
          headers: {
            'content-type': init?.contentType ?? 'text/plain',
            ...(init?.headers ?? {}),
          },
          body,
        });
      });
    };
    await use({ json, text, capturedUrls: () => [...captured] });
  },
  monaco: async ({ page }, use) => {
    // Wait for the editor wrapper to mount AND for MonacoEditorBase to
    // register the instance on `window.__apicircleEditors`. The mount path
    // is async (lazy import + Monaco init) so we poll briefly.
    const ready = async (label: string): Promise<Locator> => {
      const wrapper = page.locator(`[aria-label="${label}"][data-testid="monaco-editor"]`);
      await expect(wrapper).toBeVisible({ timeout: 15_000 });
      await expect
        .poll(
          async () =>
            await page.evaluate((l) => {
              const w = window as unknown as { __apicircleEditors?: Map<string, unknown> };
              return w.__apicircleEditors?.has(l) ?? false;
            }, label),
          { timeout: 15_000, message: `Monaco editor with aria-label="${label}" never registered` },
        )
        .toBe(true);
      return wrapper;
    };

    const fill = async (label: string, value: string): Promise<void> => {
      await ready(label);
      // Use Monaco's API directly — bypasses bracket-pairing and
      // suggestion popups that fight synthetic keyboard typing.
      await page.evaluate(
        ({ l, v }) => {
          const w = window as unknown as {
            __apicircleEditors?: Map<string, { setValue: (s: string) => void }>;
          };
          w.__apicircleEditors?.get(l)?.setValue(v);
        },
        { l: label, v: value },
      );
    };

    const read = async (label: string): Promise<string> => {
      await ready(label);
      return page.evaluate((l) => {
        const w = window as unknown as {
          __apicircleEditors?: Map<string, { getValue: () => string }>;
        };
        return w.__apicircleEditors?.get(l)?.getValue() ?? '';
      }, label);
    };

    await use({ ready, fill, read });
  },
  e2eMock: async ({}, use) => {
    const port = process.env.E2E_MOCK_PORT ?? '5176';
    const baseUrl = `http://localhost:${port}`;
    const url = (path: string) => {
      if (path.startsWith('/')) return `${baseUrl}${path}`;
      return `${baseUrl}/${path}`;
    };
    // The Vite dev server (5174) proxies /_mock/* to the mock server
    // (5176). Tests that need same-origin semantics (Cookie sent on
    // wire, Set-Cookie accepted) hit `/_mock/...` on the app origin.
    const sameOriginUrl = (path: string) => {
      const suffix = path.startsWith('/') ? path : `/${path}`;
      return `http://localhost:5174/_mock${suffix}`;
    };
    const clearInspection = async (): Promise<void> => {
      await fetch(`${baseUrl}/__inspect`, { method: 'DELETE' });
    };
    const inspectLast = async (n = 1): Promise<CapturedRequestSummary[]> => {
      // Poll: the Send → mock-capture → inspect chain isn't always
      // synchronously visible. Try up to 1s for at least one entry.
      const deadline = Date.now() + 1000;
      let lastEntries: CapturedRequestSummary[] = [];
      while (Date.now() < deadline) {
        const res = await fetch(`${baseUrl}/__inspect/last?n=${n}`);
        if (!res.ok) throw new Error(`mock-server inspect failed: ${res.status}`);
        const body = (await res.json()) as { entries: CapturedRequestSummary[] };
        lastEntries = body.entries;
        if (lastEntries.length >= 1) return lastEntries;
        await new Promise((r) => setTimeout(r, 50));
      }
      return lastEntries;
    };
    const findLastByPath = async (
      matcher: (path: string) => boolean,
      opts: { timeout?: number } = {},
    ): Promise<CapturedRequestSummary> => {
      const deadline = Date.now() + (opts.timeout ?? 3000);
      // Walk the buffer newest-first, looking for the first match.
      // Buffer caps at 200 entries — large enough for the test suite.
      while (Date.now() < deadline) {
        const res = await fetch(`${baseUrl}/__inspect/last?n=200`);
        if (res.ok) {
          const body = (await res.json()) as { entries: CapturedRequestSummary[] };
          for (const entry of body.entries) {
            if (matcher(entry.path)) return entry;
          }
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      throw new Error('mock-server: no captured request matched the path predicate');
    };
    await use({ baseUrl, url, sameOriginUrl, clearInspection, inspectLast, findLastByPath });
  },
  sidebar: async ({ page }, use) => {
    const createRequest: SidebarHelpers['createRequest'] = async (name) => {
      await page.getByLabel('New request', { exact: true }).first().click();
      const input = page.getByLabel('Inline rename request');
      await expect(input).toBeVisible();
      await input.fill(name);
      await input.press('Enter');
      // Wait for the editor to switch to the freshly-created request. The
      // editor's title input shows it.
      await expect(page.getByLabel('Request name', { exact: true })).toHaveValue(name);
    };
    const createFolder: SidebarHelpers['createFolder'] = async (name) => {
      await page.getByLabel('New folder', { exact: true }).first().click();
      const input = page.getByLabel('Inline rename folder');
      await expect(input).toBeVisible();
      await input.fill(name);
      await input.press('Enter');
    };
    await use({ createRequest, createFolder });
  },
});

export { expect } from '@playwright/test';
