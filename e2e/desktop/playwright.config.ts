import { defineConfig } from '@playwright/test';

// Desktop-side E2E config. Each spec launches a fresh Electron main via
// `_electron.launch()` (see `fixtures/electronApp.ts`) and tears it down
// after the test. We don't reuse a single Electron instance across the
// suite — too much shared state in IDB / window.localStorage / native
// secrets for that to be reliable.
//
// The MCP-stdio and CLI specs spawn child processes directly via
// `child_process.spawn` (`fixtures/mcpStdio.ts`, `fixtures/cliSpawn.ts`).
// They don't go through Electron — the binary under test is the published
// `apicircle-mcp` (packages/mcp-server/dist/bin) and `apicircle`
// (packages/cli/dist) executables respectively.

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts$/,
  // Mock-response + MCP tests fan out hundreds of cases. Default timeout
  // is short — each individual case is a single roundtrip — but a few
  // groups need longer (Electron boot is ~3s; large workspace MCP boot
  // is ~5s).
  timeout: 30_000,
  expect: { timeout: 5_000 },
  // Electron tests must not run in parallel — Windows specifically gets
  // angry about multiple Electron instances against the same userData
  // dir. The MCP-stdio + CLI specs don't share that constraint but
  // staying serial keeps stdout/stderr-based assertions deterministic.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
    : [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
