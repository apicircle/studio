// Font family picker — orthogonal to the theme picker. Themes control colour
// tokens (`--surface`, `--accent`, etc); fonts control the `--app-font` CSS
// variable that the body and Tailwind's `font-mono` utility resolve to.
//
// Every preset includes a fallback chain so the UI keeps rendering even when
// the primary face isn't installed and the webfont hasn't loaded yet. The
// "system-mono" preset is the safe default — it picks each OS's native
// monospace font and never depends on an external download.
//
// The `FontFamilyId` union itself lives in `@apicircle/shared/types.ts`
// because it's persisted on `WorkspaceLocal.ui.fontId` so font choice
// switches with the workspace (parity with `themeId`).

import type { FontFamilyId } from '@apicircle/shared';
export type { FontFamilyId } from '@apicircle/shared';

export interface FontFamilyDef {
  id: FontFamilyId;
  label: string;
  /** Display category — drives the section divider in the picker. */
  category: 'mono' | 'sans';
  /** CSS font-family stack written into `--app-font`. */
  stack: string;
  /**
   * URL of an optional Google-Fonts (or other CDN) stylesheet. The picker
   * lazy-loads this the first time the user selects the preset; cached
   * thereafter.
   */
  webfontHref?: string;
}

export const ALL_FONTS: ReadonlyArray<FontFamilyDef> = [
  {
    id: 'system-mono',
    label: 'System Mono',
    category: 'mono',
    stack: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Courier New", monospace',
  },
  {
    id: 'jetbrains-mono',
    label: 'JetBrains Mono',
    category: 'mono',
    stack: '"JetBrains Mono", ui-monospace, Menlo, Consolas, monospace',
    webfontHref:
      'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&display=swap',
  },
  {
    id: 'fira-code',
    label: 'Fira Code',
    category: 'mono',
    stack: '"Fira Code", ui-monospace, Menlo, Consolas, monospace',
    webfontHref:
      'https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;500;600;700&display=swap',
  },
  {
    id: 'cascadia-code',
    label: 'Cascadia Code',
    category: 'mono',
    stack: '"Cascadia Code", "Cascadia Mono", Consolas, ui-monospace, monospace',
    webfontHref: 'https://cdn.jsdelivr.net/npm/@fontsource/cascadia-code@5.0.0/index.css',
  },
  {
    id: 'ibm-plex-mono',
    label: 'IBM Plex Mono',
    category: 'mono',
    stack: '"IBM Plex Mono", ui-monospace, Menlo, Consolas, monospace',
    webfontHref:
      'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&display=swap',
  },
  {
    id: 'system-sans',
    label: 'System Sans',
    category: 'sans',
    stack: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  },
  {
    id: 'inter',
    label: 'Inter',
    category: 'sans',
    stack: 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    webfontHref: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
  },
];

const WEBFONT_LINK_ATTR = 'data-apicircle-font';

export function getFontDef(id: FontFamilyId): FontFamilyDef {
  return ALL_FONTS.find((f) => f.id === id) ?? ALL_FONTS[0];
}

/**
 * Apply the font: inject the webfont stylesheet (if any) + write CSS
 * var. The chosen font is persisted on `WorkspaceLocal.ui.fontId` (the
 * store calls applyFont after hydrate / switch / create) — this
 * function no longer touches localStorage.
 */
export function applyFont(id: FontFamilyId): void {
  if (typeof document === 'undefined') return;
  const def = getFontDef(id);
  document.documentElement.style.setProperty('--app-font', def.stack);
  document.documentElement.setAttribute('data-font', id);
  if (def.webfontHref) ensureWebfontLink(def.webfontHref);
}

function ensureWebfontLink(href: string): void {
  if (typeof document === 'undefined') return;
  const existing = document.head.querySelector<HTMLLinkElement>(
    `link[${WEBFONT_LINK_ATTR}][href="${href}"]`,
  );
  if (existing) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  link.setAttribute(WEBFONT_LINK_ATTR, '');
  document.head.appendChild(link);
}
