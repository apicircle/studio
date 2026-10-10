// Type declarations for scripts/gen-status-fg.mjs — consumed by
// apps/web/src/__tests__/theme-contrast.test.ts so the typecheck doesn't need
// allowJs / checkJs across the scripts/ directory.

export type Rgb = [number, number, number];

export const FG_TONES: readonly string[];
export const FG_TINTS: readonly number[];
export const FG_MIN_CONTRAST: number;
export const DIFF_TINTS: Readonly<Record<'add' | 'del', string>>;
export const DIFF_PAGE: string;
export const DIFF_CODE: string;
export const DIFF_NUMBER: string;
export const DIFF_TINT_FLOOR: number;
export const DIFF_TINT_TARGET: number;
export const DIFF_CODE_MIN_CONTRAST: number;
export const DIFF_NUMBER_MIN_CONTRAST: number;
export function contrast(a: readonly number[], b: readonly number[]): number;
export function composite(fg: readonly number[], bg: readonly number[], alpha: number): number[];
export function difference(a: readonly number[], b: readonly number[]): number;
export function solveFg(
  tone: readonly number[],
  text: readonly number[],
  surfaces: readonly (readonly number[])[],
): number[];
export function solveDiffTint(
  tone: readonly number[],
  page: readonly number[],
  code: readonly number[],
  number: readonly number[],
): number[];
export function generate(css: string): string;
