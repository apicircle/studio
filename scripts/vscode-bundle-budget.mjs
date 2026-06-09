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

// Phase 12 RESTORED the pre-Phase-10 ceilings — externalising
// `@modelcontextprotocol/sdk`, `@hono/node-server`, and `hono` from the
// tsup bundle (resolved at runtime via the .vsix's `node_modules`) cut
// `dist/extension.js` by ~470 KB. The heavy SDK is still shipped to users
// but lives in a separate file Node lazily requires when the embedded
// host (P10) or mock-server runtime (P3) actually fires.
//
// Phase 10 had to bump to 2.5 MB to accommodate the SDK; Phase 12 brought
// the bundle back to ~1.69 MB so the original 2.0 MB ceiling fits with
// generous headroom for future work.
export const SOFT_BUDGET_BYTES = 1_800_000; // ~1.72 MB — warn threshold
export const HARD_BUDGET_BYTES = 2_097_152; // 2.00 MB — fail threshold

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
