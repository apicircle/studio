import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ALL_THEMES, applyTheme, getStoredThemeId } from './applyTheme';

describe('applyTheme / getStoredThemeId', () => {
  beforeEach(() => {
    document.head.querySelectorAll('link[rel="icon"]').forEach((el) => el.remove());
    document.documentElement.style.removeProperty('--accent');
  });

  afterEach(() => {
    document.head.querySelectorAll('link[rel="icon"]').forEach((el) => el.remove());
    document.documentElement.style.removeProperty('--accent');
  });
  it('catalog has at least 60 themes and unique ids', () => {
    expect(ALL_THEMES.length).toBeGreaterThanOrEqual(60);
    const ids = new Set<string>();
    for (const t of ALL_THEMES) {
      expect(ids.has(t.id)).toBe(false);
      ids.add(t.id);
    }
  });

  it('catalog labels are unique', () => {
    const labels = new Set<string>();
    for (const t of ALL_THEMES) {
      const label = t.label.toLowerCase();
      expect(labels.has(label)).toBe(false);
      labels.add(label);
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

  it('keeps studio-dark as the first entry (catalog ordering)', () => {
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
    applyTheme('github-dark-dimmed');
    expect(getStoredThemeId()).toBe('github-dark-dimmed');
  });

  it('getStoredThemeId falls back to one-dark-pro when nothing stored', () => {
    localStorage.removeItem('apicircle-v2:theme');
    expect(getStoredThemeId()).toBe('one-dark-pro');
  });

  it('getStoredThemeId rejects unknown values gracefully', () => {
    localStorage.setItem('apicircle-v2:theme', 'not-a-real-theme');
    expect(getStoredThemeId()).toBe('one-dark-pro');
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
      expect(getStoredThemeId()).toBe('one-dark-pro');
    } finally {
      getItem.mockRestore();
    }
  });

  it('does not touch the favicon link (the static PNG icon stays fixed across themes)', () => {
    const link = document.createElement('link');
    link.rel = 'icon';
    link.type = 'image/png';
    link.href = '/favicon.png';
    document.head.appendChild(link);

    applyTheme('studio-dark');
    applyTheme('paper-light');

    const links = document.querySelectorAll<HTMLLinkElement>('link[rel="icon"]');
    expect(links.length).toBe(1);
    expect(links[0].getAttribute('href')).toBe('/favicon.png');
  });
});
