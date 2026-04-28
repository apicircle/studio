// Monaco theme definitions that mirror studio-v2's six CSS-variable
// themes. Monaco can't read CSS variables, so each theme is hardcoded
// here with hex equivalents derived from `apps/web/src/styles/global.css`.
//
// On first Monaco mount we register all six via `registerMonacoThemes`,
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

export const THEME_REGISTRY: ReadonlyArray<ThemeMonacoBinding> = [
  {
    themeId: 'studio-dark',
    monaco: {
      base: 'vs-dark',
      inherit: true,
      rules: COMMON_DARK_RULES,
      colors: {
        'editor.background': '#0d131e',
        'editor.foreground': '#edf4ff',
        'editorLineNumber.foreground': '#4b5c74',
        'editorLineNumber.activeForeground': '#8fa5c0',
        'editor.selectionBackground': '#67b3ff44',
        'editor.lineHighlightBackground': '#142031',
        'editorCursor.foreground': '#67b3ff',
        'editorWhitespace.foreground': '#243246',
        'editorIndentGuide.background': '#243246',
      },
    },
  },
  {
    themeId: 'graphite-dark',
    monaco: {
      base: 'vs-dark',
      inherit: true,
      rules: COMMON_DARK_RULES,
      colors: {
        'editor.background': '#121316',
        'editor.foreground': '#e8eaed',
        'editorLineNumber.foreground': '#505660',
        'editorLineNumber.activeForeground': '#9ca1aa',
        'editor.selectionBackground': '#a8b2c544',
        'editor.lineHighlightBackground': '#1e2024',
        'editorCursor.foreground': '#c7d2e2',
        'editorWhitespace.foreground': '#2a2d33',
      },
    },
  },
  {
    themeId: 'midnight-blue',
    monaco: {
      base: 'vs-dark',
      inherit: true,
      rules: COMMON_DARK_RULES,
      colors: {
        'editor.background': '#080c1a',
        'editor.foreground': '#e0eaff',
        'editorLineNumber.foreground': '#40547a',
        'editorLineNumber.activeForeground': '#90a2c6',
        'editor.selectionBackground': '#7c9cff44',
        'editor.lineHighlightBackground': '#10162e',
        'editorCursor.foreground': '#7c9cff',
        'editorWhitespace.foreground': '#1c2646',
      },
    },
  },
  {
    themeId: 'workbench-light',
    monaco: {
      base: 'vs',
      inherit: true,
      rules: COMMON_LIGHT_RULES,
      colors: {
        'editor.background': '#fafafc',
        'editor.foreground': '#181c24',
        'editorLineNumber.foreground': '#a8aebc',
        'editorLineNumber.activeForeground': '#58606e',
        'editor.selectionBackground': '#1877f244',
        'editor.lineHighlightBackground': '#eef0f4',
        'editorCursor.foreground': '#1877f2',
        'editorWhitespace.foreground': '#e8ecf2',
      },
    },
  },
  {
    themeId: 'paper-light',
    monaco: {
      base: 'vs',
      inherit: true,
      rules: COMMON_LIGHT_RULES,
      colors: {
        'editor.background': '#fcfaf5',
        'editor.foreground': '#262016',
        'editorLineNumber.foreground': '#b8ae9c',
        'editorLineNumber.activeForeground': '#665c4c',
        'editor.selectionBackground': '#c0662444',
        'editor.lineHighlightBackground': '#f3eedf',
        'editorCursor.foreground': '#c06624',
        'editorWhitespace.foreground': '#eee9de',
      },
    },
  },
  {
    themeId: 'high-contrast-dark',
    monaco: {
      base: 'hc-black',
      inherit: true,
      rules: COMMON_DARK_RULES,
      colors: {
        'editor.background': '#000000',
        'editor.foreground': '#ffffff',
        'editorLineNumber.foreground': '#8c8c8c',
        'editorLineNumber.activeForeground': '#ffd700',
        'editor.selectionBackground': '#ffd70066',
        'editor.lineHighlightBackground': '#0e0e0e',
        'editorCursor.foreground': '#ffd700',
      },
    },
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
 * Register all six v2 themes with a Monaco editor instance. Idempotent
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
