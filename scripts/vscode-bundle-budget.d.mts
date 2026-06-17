// Type declarations for scripts/vscode-bundle-budget.mjs — consumed by
// apps/vscode/test/integration/bundleSize.test.ts so the typecheck doesn't
// need allowJs / checkJs across the scripts/ directory.

export const SOFT_BUDGET_BYTES: number;
export const HARD_BUDGET_BYTES: number;
export const MIN_BUNDLE_BYTES: number;
export function formatBytes(bytes: number): string;
