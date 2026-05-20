import type { ThemeId } from '@apicircle/shared';

const THEME_STORAGE_KEY = 'apicircle-v2:theme';

export interface ThemeDef {
  id: ThemeId;
  label: string;
  /** Drives `color-scheme` and the picker's group placement. */
  mode: 'dark' | 'light';
  /** Optional grouping flag. High-contrast themes get their own picker section. */
  tag?: 'high-contrast';
}

export const ALL_THEMES: ReadonlyArray<ThemeDef> = [
  // Built-in defaults — preserve order so studio-dark stays the boot default.
  { id: 'studio-dark', label: 'Studio Dark', mode: 'dark' },
  { id: 'graphite-dark', label: 'Graphite Dark', mode: 'dark' },
  { id: 'midnight-blue', label: 'Midnight Blue', mode: 'dark' },
  { id: 'workbench-light', label: 'Workbench Light', mode: 'light' },
  { id: 'paper-light', label: 'Paper Light', mode: 'light' },
  // Dark — community palettes
  { id: 'dracula', label: 'Dracula', mode: 'dark' },
  { id: 'nord', label: 'Nord', mode: 'dark' },
  { id: 'tokyo-night', label: 'Tokyo Night', mode: 'dark' },
  { id: 'one-dark-pro', label: 'One Dark Pro', mode: 'dark' },
  { id: 'monokai-pro', label: 'Monokai Pro', mode: 'dark' },
  { id: 'gruvbox-dark', label: 'Gruvbox Dark', mode: 'dark' },
  { id: 'solarized-dark', label: 'Solarized Dark', mode: 'dark' },
  { id: 'catppuccin-mocha', label: 'Catppuccin Mocha', mode: 'dark' },
  { id: 'catppuccin-macchiato', label: 'Catppuccin Macchiato', mode: 'dark' },
  { id: 'synthwave-84', label: "Synthwave '84", mode: 'dark' },
  { id: 'cobalt2', label: 'Cobalt2', mode: 'dark' },
  { id: 'rose-pine', label: 'Rosé Pine', mode: 'dark' },
  { id: 'ayu-mirage', label: 'Ayu Mirage', mode: 'dark' },
  { id: 'night-owl', label: 'Night Owl', mode: 'dark' },
  { id: 'github-dark', label: 'GitHub Dark', mode: 'dark' },
  { id: 'material-palenight', label: 'Material Palenight', mode: 'dark' },
  // Light — community palettes
  { id: 'solarized-light', label: 'Solarized Light', mode: 'light' },
  { id: 'github-light', label: 'GitHub Light', mode: 'light' },
  { id: 'catppuccin-latte', label: 'Catppuccin Latte', mode: 'light' },
  { id: 'ayu-light', label: 'Ayu Light', mode: 'light' },
  { id: 'atom-one-light', label: 'Atom One Light', mode: 'light' },
  { id: 'rose-pine-dawn', label: 'Rosé Pine Dawn', mode: 'light' },
  { id: 'tokyo-night-day', label: 'Tokyo Night Day', mode: 'light' },
  // High contrast
  { id: 'high-contrast-dark', label: 'High Contrast Dark', mode: 'dark', tag: 'high-contrast' },
  { id: 'high-contrast-light', label: 'High Contrast Light', mode: 'light', tag: 'high-contrast' },
];

export function applyTheme(themeId: ThemeId): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', themeId);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, themeId);
  } catch {
    // localStorage unavailable — non-fatal
  }
}

export function getStoredThemeId(): ThemeId {
  if (typeof localStorage === 'undefined') return 'studio-dark';
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored && ALL_THEMES.some((t) => t.id === stored)) return stored as ThemeId;
  } catch {
    // ignore
  }
  return 'studio-dark';
}
