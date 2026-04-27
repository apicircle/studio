import { describe, expect, it } from 'vitest';
import { ALL_THEMES, applyTheme, getStoredThemeId } from './applyTheme';

describe('applyTheme / getStoredThemeId', () => {
  it('lists all six theme presets', () => {
    expect(ALL_THEMES.map((t) => t.id)).toEqual([
      'studio-dark',
      'graphite-dark',
      'midnight-blue',
      'workbench-light',
      'paper-light',
      'high-contrast-dark',
    ]);
  });

  it('writes data-theme on documentElement', () => {
    applyTheme('paper-light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('paper-light');
  });

  it('persists the chosen theme into localStorage', () => {
    applyTheme('midnight-blue');
    expect(localStorage.getItem('apicircle-v2:theme')).toBe('midnight-blue');
  });

  it('getStoredThemeId returns the persisted value when valid', () => {
    applyTheme('graphite-dark');
    expect(getStoredThemeId()).toBe('graphite-dark');
  });

  it('getStoredThemeId falls back to studio-dark when nothing stored', () => {
    expect(getStoredThemeId()).toBe('studio-dark');
  });

  it('getStoredThemeId rejects unknown values gracefully', () => {
    localStorage.setItem('apicircle-v2:theme', 'not-a-real-theme');
    expect(getStoredThemeId()).toBe('studio-dark');
  });
});
