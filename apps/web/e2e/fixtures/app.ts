import { expect, test as base, type Page } from '@playwright/test';

// Shared fixtures for the v2 E2E suite. Each test gets:
//   - `app`: a Page already booted past hydration ("API Circle Studio"
//     visible) and with a clean IDB + localStorage.
//   - `mockApi`: a tiny fluent route mocker for `httpbin.org/anything`-style
//     endpoints so specs don't depend on the public internet.

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

interface Fixtures {
  app: Page;
  mockApi: MockApi;
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
});

export { expect } from '@playwright/test';
