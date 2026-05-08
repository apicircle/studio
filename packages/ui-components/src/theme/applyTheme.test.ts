import { describe, expect, it, vi } from 'vitest';
import { ALL_THEMES, applyTheme, getStoredThemeId } from './applyTheme';

describe('applyTheme / getStoredThemeId', () => {
  it('catalog has at least 30 themes and unique ids', () => {
    expect(ALL_THEMES.length).toBeGreaterThanOrEqual(30);
    const ids = new Set<string>();
    for (const t of ALL_THEMES) {
      expect(ids.has(t.id)).toBe(false);
      ids.add(t.id);
    }
  });

  it('every theme is dark or light, and HC themes carry the tag', () => {
    for (const t of ALL_THEMES) {
      expect(['dark', 'light']).toContain(t.mode);
      if (t.id.startsWith('high-contrast-')) {
        expect(t.tag).toBe('high-contrast');
      }
    }
  });

  it('keeps studio-dark as the first entry (boot default)', () => {
    expect(ALL_THEMES[0].id).toBe('studio-dark');
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

  it('getStoredThemeId returns newly-added community themes', () => {
    applyTheme('dracula');
    expect(getStoredThemeId()).toBe('dracula');
  });

  it('getStoredThemeId falls back to studio-dark when nothing stored', () => {
    localStorage.removeItem('apicircle-v2:theme');
    expect(getStoredThemeId()).toBe('studio-dark');
  });

  it('getStoredThemeId rejects unknown values gracefully', () => {
    localStorage.setItem('apicircle-v2:theme', 'not-a-real-theme');
    expect(getStoredThemeId()).toBe('studio-dark');
  });

  it('applyTheme survives a localStorage that throws on setItem', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    try {
      // Should not throw — the catch block in applyTheme swallows the error.
      expect(() => applyTheme('paper-light')).not.toThrow();
      // The data-theme attribute is still applied even though persistence failed.
      expect(document.documentElement.getAttribute('data-theme')).toBe('paper-light');
    } finally {
      setItem.mockRestore();
    }
  });

  it('getStoredThemeId survives a localStorage that throws on getItem', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('access denied');
    });
    try {
      expect(getStoredThemeId()).toBe('studio-dark');
    } finally {
      getItem.mockRestore();
    }
  });
});
