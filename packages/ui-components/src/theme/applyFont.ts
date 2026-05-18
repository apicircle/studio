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
    id: 'source-code-pro',
    label: 'Source Code Pro',
    category: 'mono',
    stack: '"Source Code Pro", ui-monospace, Menlo, Consolas, monospace',
    webfontHref:
      'https://fonts.googleapis.com/css2?family=Source+Code+Pro:wght@400;500;600;700&display=swap',
  },
  {
    id: 'roboto-mono',
    label: 'Roboto Mono',
    category: 'mono',
    stack: '"Roboto Mono", ui-monospace, Menlo, Consolas, monospace',
    webfontHref:
      'https://fonts.googleapis.com/css2?family=Roboto+Mono:wght@400;500;600;700&display=swap',
  },
  {
    id: 'space-mono',
    label: 'Space Mono',
    category: 'mono',
    stack: '"Space Mono", ui-monospace, Menlo, Consolas, monospace',
    webfontHref: 'https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&display=swap',
  },
  {
    id: 'hack',
    label: 'Hack',
    category: 'mono',
    stack: 'Hack, ui-monospace, Menlo, Consolas, monospace',
    webfontHref: 'https://cdn.jsdelivr.net/npm/@fontsource/hack@5.0.0/index.css',
  },
  {
    id: 'inconsolata',
    label: 'Inconsolata',
    category: 'mono',
    stack: 'Inconsolata, ui-monospace, Menlo, Consolas, monospace',
    webfontHref:
      'https://fonts.googleapis.com/css2?family=Inconsolata:wght@400;500;600;700&display=swap',
  },
  {
    id: 'anonymous-pro',
    label: 'Anonymous Pro',
    category: 'mono',
    stack: '"Anonymous Pro", ui-monospace, Menlo, Consolas, monospace',
    webfontHref: 'https://fonts.googleapis.com/css2?family=Anonymous+Pro:wght@400;700&display=swap',
  },
  {
    id: 'ubuntu-mono',
    label: 'Ubuntu Mono',
    category: 'mono',
    stack: '"Ubuntu Mono", ui-monospace, Menlo, Consolas, monospace',
    webfontHref: 'https://fonts.googleapis.com/css2?family=Ubuntu+Mono:wght@400;700&display=swap',
  },
  {
    id: 'dm-mono',
    label: 'DM Mono',
    category: 'mono',
    stack: '"DM Mono", ui-monospace, Menlo, Consolas, monospace',
    webfontHref: 'https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&display=swap',
  },
  {
    id: 'geist-mono',
    label: 'Geist Mono',
    category: 'mono',
    stack: '"Geist Mono", ui-monospace, Menlo, Consolas, monospace',
    webfontHref:
      'https://fonts.googleapis.com/css2?family=Geist+Mono:wght@400;500;600;700&display=swap',
  },
  {
    id: 'red-hat-mono',
    label: 'Red Hat Mono',
    category: 'mono',
    stack: '"Red Hat Mono", ui-monospace, Menlo, Consolas, monospace',
    webfontHref:
      'https://fonts.googleapis.com/css2?family=Red+Hat+Mono:wght@400;500;600;700&display=swap',
  },
  {
    id: 'azeret-mono',
    label: 'Azeret Mono',
    category: 'mono',
    stack: '"Azeret Mono", ui-monospace, Menlo, Consolas, monospace',
    webfontHref:
      'https://fonts.googleapis.com/css2?family=Azeret+Mono:wght@400;500;600;700&display=swap',
  },
  {
    id: 'victor-mono',
    label: 'Victor Mono',
    category: 'mono',
    stack: '"Victor Mono", ui-monospace, Menlo, Consolas, monospace',
    webfontHref:
      'https://fonts.googleapis.com/css2?family=Victor+Mono:wght@400;500;600;700&display=swap',
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
  {
    id: 'roboto',
    label: 'Roboto',
    category: 'sans',
    stack: 'Roboto, system-ui, -apple-system, "Segoe UI", sans-serif',
    webfontHref: 'https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap',
  },
  {
    id: 'open-sans',
    label: 'Open Sans',
    category: 'sans',
    stack: '"Open Sans", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    webfontHref:
      'https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;500;600;700&display=swap',
  },
  {
    id: 'lato',
    label: 'Lato',
    category: 'sans',
    stack: 'Lato, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    webfontHref: 'https://fonts.googleapis.com/css2?family=Lato:wght@400;700&display=swap',
  },
  {
    id: 'source-sans-3',
    label: 'Source Sans 3',
    category: 'sans',
    stack: '"Source Sans 3", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    webfontHref:
      'https://fonts.googleapis.com/css2?family=Source+Sans+3:wght@400;500;600;700&display=swap',
  },
  {
    id: 'nunito-sans',
    label: 'Nunito Sans',
    category: 'sans',
    stack: '"Nunito Sans", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    webfontHref:
      'https://fonts.googleapis.com/css2?family=Nunito+Sans:wght@400;500;600;700&display=swap',
  },
  {
    id: 'manrope',
    label: 'Manrope',
    category: 'sans',
    stack: 'Manrope, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    webfontHref:
      'https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700&display=swap',
  },
  {
    id: 'dm-sans',
    label: 'DM Sans',
    category: 'sans',
    stack: '"DM Sans", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    webfontHref:
      'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap',
  },
  {
    id: 'geist',
    label: 'Geist',
    category: 'sans',
    stack: 'Geist, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    webfontHref: 'https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&display=swap',
  },
  {
    id: 'plus-jakarta-sans',
    label: 'Plus Jakarta Sans',
    category: 'sans',
    stack: '"Plus Jakarta Sans", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    webfontHref:
      'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap',
  },
  {
    id: 'ibm-plex-sans',
    label: 'IBM Plex Sans',
    category: 'sans',
    stack: '"IBM Plex Sans", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    webfontHref:
      'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&display=swap',
  },
  {
    id: 'work-sans',
    label: 'Work Sans',
    category: 'sans',
    stack: '"Work Sans", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    webfontHref:
      'https://fonts.googleapis.com/css2?family=Work+Sans:wght@400;500;600;700&display=swap',
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
