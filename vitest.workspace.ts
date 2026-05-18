import { defineWorkspace } from 'vitest/config';

// `e2e/mock` is the only `e2e/*` package with Vitest unit tests — the
// `e2e/web` + `e2e/desktop` Playwright suites are run by Playwright, not
// Vitest, so they are deliberately not listed here.
export default defineWorkspace(['packages/*', 'apps/*', 'e2e/mock', 'examples/mock-server']);
