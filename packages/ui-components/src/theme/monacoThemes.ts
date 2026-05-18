// Monaco theme definitions that mirror the studio CSS-variable themes.
// Monaco can't read CSS variables, so each theme is hardcoded here with
// hex equivalents derived from `apps/web/src/styles/global.css`.
//
// On first Monaco mount we register every theme via `registerMonacoThemes`,
// then `getMonacoThemeId(themeId)` resolves the active theme name. Theme
// switches at runtime call `monaco.editor.setTheme(...)` — handled by
// the editor wrapper hook, not the global applyTheme.

import type { ThemeId } from '@apicircle/shared';

interface MonacoThemeRule {
  token: string;
  foreground?: string;
  background?: string;
  fontStyle?: string;
}

interface MonacoThemeDef {
  base: 'vs' | 'vs-dark' | 'hc-black' | 'hc-light';
  inherit: boolean;
  rules: MonacoThemeRule[];
  colors: Record<string, string>;
}

interface MonacoLike {
  defineTheme: (name: string, def: MonacoThemeDef) => void;
}

export interface ThemeMonacoBinding {
  themeId: ThemeId;
  monaco: MonacoThemeDef;
}

// Shared token rules. Same syntax color across themes; only the editor
// chrome changes per theme. Keeps the visual signature consistent.
const COMMON_DARK_RULES: MonacoThemeRule[] = [
  { token: 'comment', foreground: '7d8590', fontStyle: 'italic' },
  { token: 'keyword', foreground: 'ff7b72' },
  { token: 'string', foreground: 'a5d6ff' },
  { token: 'number', foreground: '79c0ff' },
  { token: 'type', foreground: 'ffa657' },
  { token: 'identifier', foreground: 'd2a8ff' },
  { token: 'constant', foreground: '79c0ff' },
  { token: 'string.key.json', foreground: '7ee787' },
  { token: 'string.value.json', foreground: 'a5d6ff' },
];

const COMMON_LIGHT_RULES: MonacoThemeRule[] = [
  { token: 'comment', foreground: '6a737d', fontStyle: 'italic' },
  { token: 'keyword', foreground: 'd73a49' },
  { token: 'string', foreground: '032f62' },
  { token: 'number', foreground: '005cc5' },
  { token: 'type', foreground: '6f42c1' },
  { token: 'identifier', foreground: '24292e' },
  { token: 'string.key.json', foreground: '22863a' },
  { token: 'string.value.json', foreground: '032f62' },
];

interface ChromePalette {
  /** `vs-dark` | `vs` | `hc-black` | `hc-light` */
  base: 'vs' | 'vs-dark' | 'hc-black' | 'hc-light';
  /** Editor canvas. Hex without `#`. */
  bg: string;
  /** Body text. Hex without `#`. */
  fg: string;
  /** Accent-tinted line numbers + cursor. Hex without `#`. */
  accent: string;
  /** Gutter inactive line numbers. Hex without `#`. */
  gutter: string;
  /** Active line highlight. Hex without `#`. */
  lineHighlight: string;
  /** Whitespace indent guides. Hex without `#`. */
  whitespace: string;
}

function makeMonaco(p: ChromePalette): MonacoThemeDef {
  return {
    base: p.base,
    inherit: true,
    rules: p.base === 'vs' || p.base === 'hc-light' ? COMMON_LIGHT_RULES : COMMON_DARK_RULES,
    colors: {
      'editor.background': `#${p.bg}`,
      'editor.foreground': `#${p.fg}`,
      'editorLineNumber.foreground': `#${p.gutter}`,
      'editorLineNumber.activeForeground': `#${p.accent}`,
      'editor.selectionBackground': `#${p.accent}44`,
      'editor.lineHighlightBackground': `#${p.lineHighlight}`,
      'editorCursor.foreground': `#${p.accent}`,
      'editorWhitespace.foreground': `#${p.whitespace}`,
      'editorIndentGuide.background': `#${p.whitespace}`,
    },
  };
}

const THEME_REGISTRY: ReadonlyArray<ThemeMonacoBinding> = [
  // Built-in defaults
  {
    themeId: 'studio-dark',
    monaco: makeMonaco({
      base: 'vs-dark',
      bg: '0d131e',
      fg: 'edf4ff',
      accent: '67b3ff',
      gutter: '4b5c74',
      lineHighlight: '142031',
      whitespace: '243246',
    }),
  },
  {
    themeId: 'graphite-dark',
    monaco: makeMonaco({
      base: 'vs-dark',
      bg: '121316',
      fg: 'e8eaed',
      accent: 'c7d2e2',
      gutter: '505660',
      lineHighlight: '1e2024',
      whitespace: '2a2d33',
    }),
  },
  {
    themeId: 'midnight-blue',
    monaco: makeMonaco({
      base: 'vs-dark',
      bg: '080c1a',
      fg: 'e0eaff',
      accent: '7c9cff',
      gutter: '40547a',
      lineHighlight: '10162e',
      whitespace: '1c2646',
    }),
  },
  {
    themeId: 'workbench-light',
    monaco: makeMonaco({
      base: 'vs',
      bg: 'fafafc',
      fg: '181c24',
      accent: '1877f2',
      gutter: 'a8aebc',
      lineHighlight: 'eef0f4',
      whitespace: 'e8ecf2',
    }),
  },
  {
    themeId: 'paper-light',
    monaco: makeMonaco({
      base: 'vs',
      bg: 'fcfaf5',
      fg: '262016',
      accent: 'c06624',
      gutter: 'b8ae9c',
      lineHighlight: 'f3eedf',
      whitespace: 'eee9de',
    }),
  },
  // High contrast
  {
    themeId: 'high-contrast-dark',
    monaco: makeMonaco({
      base: 'hc-black',
      bg: '000000',
      fg: 'ffffff',
      accent: 'ffd700',
      gutter: '8c8c8c',
      lineHighlight: '0e0e0e',
      whitespace: '333333',
    }),
  },
  {
    themeId: 'high-contrast-light',
    monaco: makeMonaco({
      base: 'hc-light',
      bg: 'ffffff',
      fg: '000000',
      accent: '0000c8',
      gutter: '666666',
      lineHighlight: 'f0f0f0',
      whitespace: 'd0d0d0',
    }),
  },
  // Dark — community palettes
  {
    themeId: 'dracula',
    monaco: makeMonaco({
      base: 'vs-dark',
      bg: '282a36',
      fg: 'f8f8f2',
      accent: 'bd93f9',
      gutter: '6272a4',
      lineHighlight: '44475a',
      whitespace: '383a4c',
    }),
  },
  {
    themeId: 'nord',
    monaco: makeMonaco({
      base: 'vs-dark',
      bg: '2e3440',
      fg: 'eceff4',
      accent: '88c0d0',
      gutter: '4c566a',
      lineHighlight: '3b4252',
      whitespace: '434c5e',
    }),
  },
  {
    themeId: 'tokyo-night',
    monaco: makeMonaco({
      base: 'vs-dark',
      bg: '1a1b26',
      fg: 'c0caf5',
      accent: '7aa2f7',
      gutter: '565f89',
      lineHighlight: '292e42',
      whitespace: '3b4261',
    }),
  },
  {
    themeId: 'one-dark-pro',
    monaco: makeMonaco({
      base: 'vs-dark',
      bg: '282c34',
      fg: 'abb2bf',
      accent: '61afef',
      gutter: '5c6370',
      lineHighlight: '2c313c',
      whitespace: '3c4049',
    }),
  },
  {
    themeId: 'monokai-pro',
    monaco: makeMonaco({
      base: 'vs-dark',
      bg: '2d2a2e',
      fg: 'fcfcfa',
      accent: 'ff6188',
      gutter: '727072',
      lineHighlight: '383539',
      whitespace: '4c494c',
    }),
  },
  {
    themeId: 'gruvbox-dark',
    monaco: makeMonaco({
      base: 'vs-dark',
      bg: '282828',
      fg: 'ebdbb2',
      accent: 'fe8019',
      gutter: '7c6f64',
      lineHighlight: '3c3836',
      whitespace: '504945',
    }),
  },
  {
    themeId: 'solarized-dark',
    monaco: makeMonaco({
      base: 'vs-dark',
      bg: '002b36',
      fg: 'eee8d5',
      accent: '268bd2',
      gutter: '586e75',
      lineHighlight: '073642',
      whitespace: '0e3c48',
    }),
  },
  {
    themeId: 'catppuccin-mocha',
    monaco: makeMonaco({
      base: 'vs-dark',
      bg: '1e1e2e',
      fg: 'cdd6f4',
      accent: 'cba6f7',
      gutter: '6c7086',
      lineHighlight: '313244',
      whitespace: '45475a',
    }),
  },
  {
    themeId: 'catppuccin-macchiato',
    monaco: makeMonaco({
      base: 'vs-dark',
      bg: '24273a',
      fg: 'cad3f5',
      accent: 'c6a0f6',
      gutter: '6e738d',
      lineHighlight: '363a4f',
      whitespace: '494d64',
    }),
  },
  {
    themeId: 'synthwave-84',
    monaco: makeMonaco({
      base: 'vs-dark',
      bg: '2a2139',
      fg: 'f8f8f2',
      accent: 'ff7edb',
      gutter: '495495',
      lineHighlight: '241b2f',
      whitespace: '322846',
    }),
  },
  {
    themeId: 'cobalt2',
    monaco: makeMonaco({
      base: 'vs-dark',
      bg: '193549',
      fg: 'ffffff',
      accent: 'ffc600',
      gutter: '0088ff',
      lineHighlight: '122738',
      whitespace: '1c3c52',
    }),
  },
  {
    themeId: 'rose-pine',
    monaco: makeMonaco({
      base: 'vs-dark',
      bg: '191724',
      fg: 'e0def4',
      accent: 'c4a7e7',
      gutter: '6e6a86',
      lineHighlight: '1f1d2e',
      whitespace: '26233a',
    }),
  },
  {
    themeId: 'ayu-mirage',
    monaco: makeMonaco({
      base: 'vs-dark',
      bg: '1f2430',
      fg: 'cccac2',
      accent: 'ffae57',
      gutter: '5c6773',
      lineHighlight: '1a1f29',
      whitespace: '262c38',
    }),
  },
  {
    themeId: 'night-owl',
    monaco: makeMonaco({
      base: 'vs-dark',
      bg: '011627',
      fg: 'd6deeb',
      accent: '82aaff',
      gutter: '637777',
      lineHighlight: '001b33',
      whitespace: '0e293f',
    }),
  },
  {
    themeId: 'github-dark',
    monaco: makeMonaco({
      base: 'vs-dark',
      bg: '0d1117',
      fg: 'c9d1d9',
      accent: '58a6ff',
      gutter: '6e7681',
      lineHighlight: '161b22',
      whitespace: '21262d',
    }),
  },
  {
    themeId: 'material-palenight',
    monaco: makeMonaco({
      base: 'vs-dark',
      bg: '292d3e',
      fg: 'a6accd',
      accent: 'c792ea',
      gutter: '676e95',
      lineHighlight: '1f2230',
      whitespace: '383c54',
    }),
  },
  // Light — community palettes
  {
    themeId: 'solarized-light',
    monaco: makeMonaco({
      base: 'vs',
      bg: 'fdf6e3',
      fg: '586e75',
      accent: '268bd2',
      gutter: '93a1a1',
      lineHighlight: 'eee8d5',
      whitespace: 'e8e2cf',
    }),
  },
  {
    themeId: 'github-light',
    monaco: makeMonaco({
      base: 'vs',
      bg: 'ffffff',
      fg: '24292f',
      accent: '0969da',
      gutter: '6e7781',
      lineHighlight: 'f6f8fa',
      whitespace: 'eaeef2',
    }),
  },
  {
    themeId: 'catppuccin-latte',
    monaco: makeMonaco({
      base: 'vs',
      bg: 'eff1f5',
      fg: '4c4f69',
      accent: '8839ef',
      gutter: '9ca0b0',
      lineHighlight: 'e6e9ef',
      whitespace: 'ccd0da',
    }),
  },
  {
    themeId: 'ayu-light',
    monaco: makeMonaco({
      base: 'vs',
      bg: 'fafafa',
      fg: '5c6773',
      accent: 'fa8d3e',
      gutter: 'abb0b6',
      lineHighlight: 'f3f4f5',
      whitespace: 'e7eaed',
    }),
  },
  {
    themeId: 'atom-one-light',
    monaco: makeMonaco({
      base: 'vs',
      bg: 'fafafa',
      fg: '383a42',
      accent: '4078f2',
      gutter: 'a0a1a7',
      lineHighlight: 'f0f0f1',
      whitespace: 'd9d9db',
    }),
  },
  {
    themeId: 'rose-pine-dawn',
    monaco: makeMonaco({
      base: 'vs',
      bg: 'faf4ed',
      fg: '575279',
      accent: '907aa9',
      gutter: '9893a5',
      lineHighlight: 'fffaf3',
      whitespace: 'f2e9e1',
    }),
  },
  {
    themeId: 'tokyo-night-day',
    monaco: makeMonaco({
      base: 'vs',
      bg: 'e1e2e7',
      fg: '3760bf',
      accent: '2e7de9',
      gutter: '848cb5',
      lineHighlight: 'd0d5e3',
      whitespace: 'c4c8da',
    }),
  },
];

const REGISTRY_BY_ID = new Map(THEME_REGISTRY.map((t) => [t.themeId, t.monaco]));

/**
 * Stable Monaco theme name for a given studio themeId. Accepts a plain
 * string for callers that haven't yet narrowed (e.g. raw values from
 * persisted `data-theme` attributes).
 */
export function getMonacoThemeId(themeId: string): string {
  return `apicircle-v2-${themeId}`;
}

/**
 * Register every studio theme with a Monaco editor instance. Idempotent
 * — Monaco's defineTheme overwrites silently on second call. Module-
 * level cache prevents redundant work across editor remounts.
 */
let registered = false;
export function __resetMonacoThemesForTests(): void {
  registered = false;
}

export function registerMonacoThemes(monaco: MonacoLike): void {
  if (registered) return;
  for (const [themeId, def] of REGISTRY_BY_ID) {
    monaco.defineTheme(getMonacoThemeId(themeId), def);
  }
  registered = true;
}
