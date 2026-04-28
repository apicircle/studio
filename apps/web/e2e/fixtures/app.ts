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

interface Fixtures {
  app: Page;
  mockApi: MockApi;
  monaco: MonacoHelpers;
}

export const test = base.extend<Fixtures>({
  // eslint-disable-next-line no-empty-pattern
  app: async ({ page }, use) => {
    await page.goto('/');
    // The shell renders the brand once the workspace is hydrated.
    await expect(page.getByText('API Circle Studio')).toBeVisible();
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
});

export { expect } from '@playwright/test';
