import { defineConfig, devices } from '@playwright/test';

const PORT = 5174;
const BASE_URL = `http://localhost:${PORT}`;
const E2E_MOCK_PORT = 5176;
const E2E_MOCK_BASE_URL = `http://localhost:${E2E_MOCK_PORT}`;

// Per the plan §7.5.6 — `e2e.yml` is required from P2 onward. The suite
// runs against the dev server (auto-started by webServer). Each project
// keeps a clean storageState so IndexedDB / localStorage from one spec
// can't bleed into the next.

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts$/,
  // Pre-warm the dev server's lazy module graph so the first OAuth2
  // popup test in the batch doesn't pay for cold-compile within its
  // BroadcastChannel + window.close timing window. See ./global-setup.ts.
  globalSetup: './global-setup.ts',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  // Fail loud in CI when someone leaves a `test.only` behind.
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI
    ? [
        ['github'],
        ['html', { open: 'never' }],
        // CI also emits a JSON report so scripts/e2e_coverage_report.py
        // --from-results=e2e/web/test-results.json can attribute passes
        // to TC-IDs after the run completes.
        ['json', { outputFile: 'test-results.json' }],
      ]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // Give every test a clean origin — IndexedDB + localStorage start empty.
    storageState: { cookies: [], origins: [] },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      // OAuth2 popup specs run under contention with the rest of the
      // suite — 6 workers all hitting the dev server starves the
      // popup's first navigation, even with 90s timeouts. The dedicated
      // `chromium-oauth2-popup` project below isolates them with
      // workers=1; the default project skips them.
      //
      // visual-baseline.spec.ts is gated by `testInfo.project.name` so
      // the default project would just skip every test — exclude it
      // outright to keep the chromium run focused.
      testIgnore: [
        /auth-oauth2-(cc|popup)\.spec\.ts$/,
        /visual-baseline\.spec\.ts$/,
        /live-github\.spec\.ts$/,
        /[\\/]live-github[\\/].*\.spec\.ts$/,
      ],
      // The two parameterized header sweeps are scoped down by default
      // (a representative 14-entry / first-value subset) so the suite
      // stays under ~5 min wall-time. The `chromium-full-sweep` project
      // below runs the same specs with FULL_HEADER_SWEEP / FULL_VALUE_SWEEP
      // set so every dictionary entry + every curated value gets verified.
    },
    {
      name: 'chromium-live-github',
      // Canonical live suite. Specs create/delete bot-owned ephemeral
      // repos and talk to api.github.com; see
      // `e2e/web/live-github/_helpers.ts` for the env-var contract.
      testMatch: /[\\/]live-github[\\/].*\.spec\.ts$/,
      use: {
        ...devices['Desktop Chrome'],
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        video: 'retain-on-failure',
      },
      // 240s per test: 60s of post-rate-limit Retry-After wait (see
      // `fetchWithSecondaryRateLimit` in `live-github/_github-rest.ts`)
      // plus ~180s of real test work. Full live runs create 40+ repos
      // back-to-back; GitHub's secondary content-creation limit
      // intermittently 403s a single call, the wrapper waits + retries,
      // and the test still needs room to finish.
      timeout: 240_000,
      // Serial by default: GitHub's secondary (content-creation) rate limit
      // is PER-TOKEN and the whole suite shares one bot PAT, so concurrent
      // workers mostly trade wall-clock for rate-limit backoff AND amplify the
      // Contents-API eventual-consistency races the helpers retry around. For
      // a local run against your own PAT you can opt into parallelism:
      //   LIVE_GH_WORKERS=3 LIVE_GH_PARALLEL=1 pnpm test:e2e:live-github
      // 2-3 workers is the realistic ceiling on a single PAT; going wider
      // needs a per-worker token pool. CI sets neither var, so it stays 1×1.
      fullyParallel: process.env.LIVE_GH_PARALLEL === '1',
      workers: process.env.LIVE_GH_WORKERS ? Number(process.env.LIVE_GH_WORKERS) : 1,
    },
    {
      name: 'chromium-oauth2-popup',
      testMatch: /auth-oauth2-(cc|popup)\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'] },
      // workers=1 keeps the dev server's transform queue uncluttered
      // for the popup's first-navigation roundtrip. Each popup test
      // settles in ~1-3s without contention.
      fullyParallel: false,
      timeout: 60_000,
    },
    {
      name: 'chromium-full-sweep',
      testMatch: /(headers|headers-curated-values)\.spec\.ts$/,
      use: {
        ...devices['Desktop Chrome'],
        // Per-test timeout bumped — the full sweep produces 80+ specs.
      },
      timeout: 60_000,
      // Inject the env vars the parameterized loops read so this project
      // expands to the full set of cases.
      metadata: { fullSweep: true },
    },
    // Method × Body matrix full sweep (S3). Default chromium project runs
    // a smoke subset (~14 cells); this project runs the full 56-cell
    // workbook matrix when invoked with `FULL_MM_SWEEP=1`. Kept on its
    // own project so PR CI can stay fast and the matrix run is opt-in:
    //
    //   FULL_MM_SWEEP=1 pnpm --filter @apicircle/e2e-web exec \
    //     playwright test --project=chromium-full-sweep-mm
    {
      name: 'chromium-full-sweep-mm',
      testMatch: /method-body-matrix\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'] },
      // Form-data + binary cells include Monaco wires + attachment-slot
      // round-trips; bump the per-test ceiling to cover cold compile.
      timeout: 60_000,
      fullyParallel: true,
      metadata: { fullSweep: true },
    },
    // Cross-browser smoke projects (S10). Each runs only tests tagged
    // `@smoke` so CI runtime stays bounded — the full suite remains
    // chromium-only. Firefox/WebKit smokes prove the app boots and the
    // critical paths render correctly outside Blink.
    {
      name: 'firefox-smoke',
      testMatch: /.*\.spec\.ts$/,
      testIgnore: [
        /auth-oauth2-(cc|popup)\.spec\.ts$/,
        /visual-baseline\.spec\.ts$/,
        /live-github\.spec\.ts$/,
        /[\\/]live-github[\\/].*\.spec\.ts$/,
      ],
      grep: /@smoke/,
      use: { ...devices['Desktop Firefox'] },
      timeout: 45_000,
    },
    {
      name: 'webkit-smoke',
      testMatch: /.*\.spec\.ts$/,
      testIgnore: [
        /auth-oauth2-(cc|popup)\.spec\.ts$/,
        /visual-baseline\.spec\.ts$/,
        /live-github\.spec\.ts$/,
        /[\\/]live-github[\\/].*\.spec\.ts$/,
      ],
      grep: /@smoke/,
      use: { ...devices['Desktop Safari'] },
      timeout: 45_000,
    },
    // Visual baseline project — runs only `visual-baseline.spec.ts` and
    // pins `expect.toHaveScreenshot` to deterministic settings. Screenshots
    // live under `e2e/web/__screenshots__/`. Use
    // `pnpm exec playwright test --project=visual-baseline --update-snapshots`
    // to refresh after intentional visual changes.
    {
      name: 'visual-baseline',
      testMatch: /visual-baseline\.spec\.ts$/,
      use: {
        ...devices['Desktop Chrome'],
        // Pin viewport so screenshots are reproducible across machines.
        viewport: { width: 1280, height: 800 },
        deviceScaleFactor: 1,
      },
      timeout: 30_000,
      expect: {
        toHaveScreenshot: {
          // 0.2% pixel-difference tolerance absorbs sub-pixel rendering
          // drift between CI Linux and local Windows/macOS without hiding
          // genuine regressions.
          maxDiffPixelRatio: 0.002,
          // Animations off — toHaveScreenshot already disables them, but
          // CSS transitions can leak past the disable; allow a small
          // settle window.
          animations: 'disabled',
        },
      },
    },
  ],
  webServer: [
    {
      command: 'pnpm --filter @apicircle/web dev',
      url: BASE_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    // Localhost mock server — serves /anything echo, /method/<verb>,
    // /status/:code, /delay, /json, /binary, /upload, /cookies and full
    // auth challenges (Basic, Bearer, API-Key, Digest, NTLM, Hawk, AWS
    // SigV4, JWT, OAuth2 via mounted mockIdp). E2E specs hit it via
    // E2E_MOCK_BASE_URL exposed to tests through the `e2eMock` fixture.
    {
      command: 'pnpm --filter @apicircle/e2e-mock start',
      url: `${E2E_MOCK_BASE_URL}/__health`,
      env: { E2E_MOCK_PORT: String(E2E_MOCK_PORT) },
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
});

export const E2E_MOCK_URL = E2E_MOCK_BASE_URL;
