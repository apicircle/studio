// Whole-UI text-size scaling — orthogonal to font family and theme.
// Sets `font-size` on the `<html>` element as a percentage, so every
// `rem`-based size in the codebase scales together. The repo-wide
// convention is bracketed-rem (`text-[0.6875rem]`, `text-[0.625rem]`)
// for sub-text-xs sizes — they were swept from px so they participate.
// Monaco's own `fontSize` option is a numeric px and is derived
// separately in `MonacoEditorBase`.
//
// The value lives on `WorkspaceLocal.ui.fontSizePercent`, applied by
// the workspace store after hydrate / switch / create. Parity with
// `applyFont` — this function never touches localStorage.

import {
  FONT_SIZE_PERCENT_DEFAULT,
  FONT_SIZE_PERCENT_MAX,
  FONT_SIZE_PERCENT_MIN,
  FONT_SIZE_PERCENT_STEP,
} from '@apicircle/shared';

/**
 * Snap `percent` into the supported range and round to the nearest
 * `FONT_SIZE_PERCENT_STEP`. Non-finite inputs collapse to the default.
 * Pure — exported so the store and tests share the rule.
 */
export function clampFontSizePercent(percent: number): number {
  if (!Number.isFinite(percent)) return FONT_SIZE_PERCENT_DEFAULT;
  const snapped = Math.round(percent / FONT_SIZE_PERCENT_STEP) * FONT_SIZE_PERCENT_STEP;
  if (snapped < FONT_SIZE_PERCENT_MIN) return FONT_SIZE_PERCENT_MIN;
  if (snapped > FONT_SIZE_PERCENT_MAX) return FONT_SIZE_PERCENT_MAX;
  return snapped;
}

/**
 * Write the percentage as `font-size` on `<html>`. Also sets a
 * `data-font-size-percent` attribute so CSS hooks / debugging tools can
 * see the active value without parsing inline style.
 */
export function applyFontSize(percent: number): void {
  if (typeof document === 'undefined') return;
  const clamped = clampFontSizePercent(percent);
  document.documentElement.style.fontSize = `${clamped}%`;
  document.documentElement.setAttribute('data-font-size-percent', String(clamped));
}
