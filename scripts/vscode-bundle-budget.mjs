// scripts/vscode-bundle-budget.mjs
//
// Single source of truth for the VS Code extension bundle-size budget.
// Imported by:
//   - scripts/check-vscode-bundle.mjs       (CI gate + local script)
//   - apps/vscode/test/integration/bundleSize.test.ts  (regression test)
//
// Keep these in sync — bumping the budget in one place but not the other
// means CI and the local test report different floors. This module is the
// reason that can't happen.
//
// Bump the ceilings deliberately per phase, with a CHANGELOG entry and an
// update to docs/vscode-extension.md §14. Never to silence a regression.

// Phase 12 publish-prep RE-BUMP — `vsce` is incompatible with pnpm
// monorepos' `workspace:*` protocol (its `npm list` dep walker fails on
// symlinked workspace deps). The cleanest fix is to bundle everything
// into `dist/extension.mjs` so `vsce package --no-dependencies` produces
// a fully self-contained .vsix. That re-inlined the ~470 KB of heavy
// MCP SDK + Hono deps that P12-1 had externalised, pushing the bundle
// back to ~2.16 MB.
//
// Could be revisited later via `pnpm deploy --prod` to produce a
// vsce-compatible deployment dir, but for now bundling is the simpler
// reliable publish path.
//
// First-install bug-fix BUMP — `proper-lockfile` was declared in
// `apps/vscode/package.json` runtime deps but missing from
// `tsup.config.ts` `noExternal`. The bundle kept it as a runtime
// `import` and activation threw `Cannot find package 'proper-lockfile'`
// because the .vsix (built with `vsce package --no-dependencies`)
// ships no node_modules. Adding it to `noExternal` adds ~50 KB
// (proper-lockfile + retry + signal-exit), pushing the bundle from
// 2.16 MB to 2.21 MB. The new manifestRegression assertion ("every
// runtime dep is in noExternal") prevents the same drift from
// recurring silently.
//
// Policy bump — peer-extension parity (5 MB ceiling). The earlier 2.5 MB
// hard cap was an aspirational discipline target, not a VS Code
// platform limit. The Marketplace allows .vsix uploads up to ~150 MB,
// and peer extensions all sit comfortably higher: Thunder Client
// (~5 MB, the closest competitor), GitLens (~5-8 MB), ESLint (~6 MB),
// GitHub Copilot (~20 MB). Our product surface (MCP host, Git
// workspace model, 17 auth schemes, embedded mock server, vault) is
// already in that league — relitigating budget per new dep was
// constant friction that pushed back against legitimate work. The
// REAL UX gate is now `test/integration/activationPerf.test.ts`:
// activate() must finish in <500ms on a 100-request workspace and
// <1000ms on a 500-request workspace. Bundle size remains the
// early-warning proxy at the new ceiling — if a single change pushes
// us past the soft warn, the reviewer still sees it; if a change
// pushes us past the hard fail, that's a real "why did we just gain
// a megabyte?" question. CHANGELOG entry: see "Bundle ceiling raised
// to 5 MB" under Unreleased.
export const SOFT_BUDGET_BYTES = 3_145_728; // 3.00 MB — warn threshold
export const HARD_BUDGET_BYTES = 5_242_880; // 5.00 MB — fail threshold

// Sanity floor — catches the corrupt-empty-build case (0-byte file that
// would otherwise pass both budgets silently). Set well below the smallest
// real Phase 7 bundle (1.46 MB) but above what an empty/partial build
// would produce.
export const MIN_BUNDLE_BYTES = 500_000; // 500 KB

// Internal invariants — fail fast if a future edit breaks the ordering.
if (!(MIN_BUNDLE_BYTES < SOFT_BUDGET_BYTES && SOFT_BUDGET_BYTES < HARD_BUDGET_BYTES)) {
  throw new Error(
    `vscode-bundle-budget: invariant violated — MIN(${MIN_BUNDLE_BYTES}) < SOFT(${SOFT_BUDGET_BYTES}) < HARD(${HARD_BUDGET_BYTES}) must hold.`,
  );
}

export function formatBytes(bytes) {
  const mb = bytes / (1024 * 1024);
  return `${bytes.toLocaleString('en-US')} bytes (~${mb.toFixed(2)} MB)`;
}
