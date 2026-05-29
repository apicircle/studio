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
  // Dark - expanded developer palettes
  {
    themeId: 'vscode-dark',
    monaco: makeMonaco({
      base: 'vs-dark',
      bg: '1e1e1e',
      fg: 'd4d4d4',
      accent: '007acc',
      gutter: '696969',
      lineHighlight: '252526',
      whitespace: '2d2d30',
    }),
  },
  {
    themeId: 'github-dark-dimmed',
    monaco: makeMonaco({
      base: 'vs-dark',
      bg: '22272e',
      fg: 'cdd9e5',
      accent: '539bf5',
      gutter: '636e7b',
      lineHighlight: '2d333b',
      whitespace: '373e47',
    }),
  },
  {
    themeId: 'terminal-green',
    monaco: makeMonaco({
      base: 'vs-dark',
      bg: '05120c',
      fg: 'dcffe8',
      accent: '50ff96',
      gutter: '407e58',
      lineHighlight: '081d14',
      whitespace: '0c301f',
    }),
  },
  {
    themeId: 'terminal-amber',
    monaco: makeMonaco({
      base: 'vs-dark',
      bg: '160e06',
      fg: 'fff2d4',
      accent: 'ffbe58',
      gutter: '846034',
      lineHighlight: '23170a',
      whitespace: '3e2812',
    }),
  },
  {
    themeId: 'oled-black',
    monaco: makeMonaco({
      base: 'vs-dark',
      bg: '000000',
      fg: 'f5f8fc',
      accent: '00e1ff',
      gutter: '606876',
      lineHighlight: '07080a',
      whitespace: '24282e',
    }),
  },
  {
    themeId: 'carbon-dark',
    monaco: makeMonaco({
      base: 'vs-dark',
      bg: '161616',
      fg: 'f4f4f4',
      accent: '0f62fe',
      gutter: '787878',
      lineHighlight: '262626',
      whitespace: '393939',
    }),
  },
  {
    themeId: 'slate-dark',
    monaco: makeMonaco({
      base: 'vs-dark',
      bg: '0f172a',
      fg: 'f1f5f9',
      accent: '38bdf8',
      gutter: '64748b',
      lineHighlight: '1e293b',
      whitespace: '334155',
    }),
  },
  {
    themeId: 'zinc-dark',
    monaco: makeMonaco({
      base: 'vs-dark',
      bg: '18181b',
      fg: 'f4f4f5',
      accent: '84cc16',
      gutter: '71717a',
      lineHighlight: '27272a',
      whitespace: '3f3f46',
    }),
  },
  {
    themeId: 'everforest-dark',
    monaco: makeMonaco({
      base: 'vs-dark',
      bg: '2d353b',
      fg: 'd3c6aa',
      accent: '83c092',
      gutter: '7f897d',
      lineHighlight: '343f44',
      whitespace: '4b5658',
    }),
  },
  {
    themeId: 'kanagawa-wave',
    monaco: makeMonaco({
      base: 'vs-dark',
      bg: '1f1f28',
      fg: 'dcd7ba',
      accent: '7e9cd8',
      gutter: '72778c',
      lineHighlight: '2a2a37',
      whitespace: '363648',
    }),
  },
  {
    themeId: 'kanagawa-dragon',
    monaco: makeMonaco({
      base: 'vs-dark',
      bg: '181616',
      fg: 'c5c9c5',
      accent: '8ba4b0',
      gutter: '5e695e',
      lineHighlight: '222020',
      whitespace: '3a3432',
    }),
  },
  {
    themeId: 'horizon-dark',
    monaco: makeMonaco({
      base: 'vs-dark',
      bg: '1c1e26',
      fg: 'd5d8da',
      accent: 'e95678',
      gutter: '687084',
      lineHighlight: '242832',
      whitespace: '3e4352',
    }),
  },
  {
    themeId: 'city-lights',
    monaco: makeMonaco({
      base: 'vs-dark',
      bg: '1d252c',
      fg: 'e8f4fc',
      accent: '5ec4ff',
      gutter: '5c7686',
      lineHighlight: '242f38',
      whitespace: '34434e',
    }),
  },
  {
    themeId: 'nightfox-dark',
    monaco: makeMonaco({
      base: 'vs-dark',
      bg: '192330',
      fg: 'cdd6e5',
      accent: '719cd6',
      gutter: '68758f',
      lineHighlight: '212d3e',
      whitespace: '3b4c62',
    }),
  },
  {
    themeId: 'command-center',
    monaco: makeMonaco({
      base: 'vs-dark',
      bg: '0e1218',
      fg: 'e8eef6',
      accent: '22c55e',
      gutter: '5c6a7e',
      lineHighlight: '181e26',
      whitespace: '2a3442',
    }),
  },
  {
    themeId: 'ink-dark',
    monaco: makeMonaco({
      base: 'vs-dark',
      bg: '090a0f',
      fg: 'eff2f8',
      accent: '6366f1',
      gutter: '5c6680',
      lineHighlight: '12141d',
      whitespace: '272b3a',
    }),
  },
  {
    themeId: 'muted-teal-dark',
    monaco: makeMonaco({
      base: 'vs-dark',
      bg: '0e1b1e',
      fg: 'e5f4f2',
      accent: '2dd4bf',
      gutter: '5c807e',
      lineHighlight: '16282c',
      whitespace: '27464b',
    }),
  },
  {
    themeId: 'redwood-dark',
    monaco: makeMonaco({
      base: 'vs-dark',
      bg: '231a18',
      fg: 'faeee6',
      accent: 'e85d4f',
      gutter: '846058',
      lineHighlight: '302320',
      whitespace: '503832',
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
  {
    themeId: 'vscode-light',
    monaco: makeMonaco({
      base: 'vs',
      bg: 'ffffff',
      fg: '1f1f1f',
      accent: '007acc',
      gutter: '969696',
      lineHighlight: 'f3f3f3',
      whitespace: 'e0e0e0',
    }),
  },
  {
    themeId: 'xcode-light',
    monaco: makeMonaco({
      base: 'vs',
      bg: 'fbfbfd',
      fg: '1d1d1f',
      accent: '0066cc',
      gutter: '979eaa',
      lineHighlight: 'f0f2f5',
      whitespace: 'dbdee5',
    }),
  },
  {
    themeId: 'minimal-light',
    monaco: makeMonaco({
      base: 'vs',
      bg: 'f7f7f8',
      fg: '202124',
      accent: '2563eb',
      gutter: '9699a0',
      lineHighlight: 'ffffff',
      whitespace: 'dddde1',
    }),
  },
  {
    themeId: 'porcelain-light',
    monaco: makeMonaco({
      base: 'vs',
      bg: 'f7f9fb',
      fg: '1f2937',
      accent: '0f766e',
      gutter: '94a3b8',
      lineHighlight: 'ffffff',
      whitespace: 'd5dee8',
    }),
  },
  {
    themeId: 'cloud-light',
    monaco: makeMonaco({
      base: 'vs',
      bg: 'f4f7fb',
      fg: '172033',
      accent: '3867d6',
      gutter: '8f9eb6',
      lineHighlight: 'ffffff',
      whitespace: 'd6dfeb',
    }),
  },
  {
    themeId: 'everforest-light',
    monaco: makeMonaco({
      base: 'vs',
      bg: 'f3ead5',
      fg: '4c5656',
      accent: '2d79a6',
      gutter: '949a8e',
      lineHighlight: 'fffbeb',
      whitespace: 'dcccb4',
    }),
  },
  {
    themeId: 'kanagawa-lotus',
    monaco: makeMonaco({
      base: 'vs',
      bg: 'f2ecbc',
      fg: '545464',
      accent: '5d57a3',
      gutter: '98948e',
      lineHighlight: 'fff7d1',
      whitespace: 'dccf9a',
    }),
  },
  {
    themeId: 'clarity-light',
    monaco: makeMonaco({
      base: 'vs',
      bg: 'f8fafc',
      fg: '0f172a',
      accent: '0284c7',
      gutter: '94a3b8',
      lineHighlight: 'ffffff',
      whitespace: 'e2e8f0',
    }),
  },
  {
    themeId: 'nord-light',
    monaco: makeMonaco({
      base: 'vs',
      bg: 'eceff4',
      fg: '2e3440',
      accent: '5e81ac',
      gutter: '768094',
      lineHighlight: 'e5e9f0',
      whitespace: 'd8dee9',
    }),
  },
  {
    themeId: 'sage-light',
    monaco: makeMonaco({
      base: 'vs',
      bg: 'f4f7f2',
      fg: '233026',
      accent: '40826d',
      gutter: '92a08c',
      lineHighlight: 'fffffc',
      whitespace: 'dae2d6',
    }),
  },
  {
    themeId: 'github-dark-high-contrast',
    monaco: makeMonaco({
      base: 'hc-black',
      bg: '010409',
      fg: 'f0f6fc',
      accent: '2f81f7',
      gutter: '8b949e',
      lineHighlight: '0d1117',
      whitespace: '484f58',
    }),
  },
  {
    themeId: 'github-light-high-contrast',
    monaco: makeMonaco({
      base: 'hc-light',
      bg: 'ffffff',
      fg: '0a0c10',
      accent: '0349b4',
      gutter: '6e7781',
      lineHighlight: 'f6f8fa',
      whitespace: 'd0d7de',
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
