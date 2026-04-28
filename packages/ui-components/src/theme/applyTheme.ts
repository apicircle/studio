import type { ThemeId } from '@apicircle/shared';

const THEME_STORAGE_KEY = 'apicircle-v2:theme';

export const ALL_THEMES: ReadonlyArray<{ id: ThemeId; label: string; mode: 'dark' | 'light' }> = [
  { id: 'studio-dark', label: 'Studio Dark', mode: 'dark' },
  { id: 'graphite-dark', label: 'Graphite Dark', mode: 'dark' },
  { id: 'midnight-blue', label: 'Midnight Blue', mode: 'dark' },
  { id: 'workbench-light', label: 'Workbench Light', mode: 'light' },
  { id: 'paper-light', label: 'Paper Light', mode: 'light' },
  { id: 'high-contrast-dark', label: 'High Contrast', mode: 'dark' },
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
