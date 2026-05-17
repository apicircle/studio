/**
 * Re-export of the canonical mock IdP — the implementation lives at
 * `packages/core/src/auth/oauth2/__fixtures__/mockIdp.ts` so the same
 * file is used by BOTH the core unit tests and the web e2e suite. The
 * fixture sits under `src/` (rather than a sibling `test/` dir) because
 * tsc's `rootDir: src` would otherwise reject the cross-dir import.
 * Web's Playwright suite reaches in via this re-export to keep its
 * relative paths shallow.
 */
export {
  startMockIdp,
  type MockIdp,
} from '../../../packages/core/src/auth/oauth2/__fixtures__/mockIdp';
