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

  describe('favicon repaint', () => {
    function decodeFaviconHref(): string {
      const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
      expect(link).not.toBeNull();
      const href = link!.getAttribute('href') ?? '';
      const prefix = 'data:image/svg+xml,';
      expect(href.startsWith(prefix)).toBe(true);
      return decodeURIComponent(href.slice(prefix.length));
    }

    it('repaints the favicon in the active theme accent color', () => {
      document.documentElement.style.setProperty('--accent', '103 179 255');
      applyTheme('studio-dark');
      expect(decodeFaviconHref()).toContain('stroke="rgb(103,179,255)"');
    });

    it('switches the favicon color when the theme changes', () => {
      document.documentElement.style.setProperty('--accent', '103 179 255');
      applyTheme('studio-dark');
      const first = decodeFaviconHref();

      document.documentElement.style.setProperty('--accent', '203 166 247');
      applyTheme('catppuccin-mocha');
      const second = decodeFaviconHref();

      expect(first).toContain('stroke="rgb(103,179,255)"');
      expect(second).toContain('stroke="rgb(203,166,247)"');
      expect(first).not.toEqual(second);
    });

    it('uses the lucide Orbit shape so the favicon mirrors the TopBar mark', () => {
      document.documentElement.style.setProperty('--accent', '103 179 255');
      applyTheme('studio-dark');
      const svg = decodeFaviconHref();
      // Distinctive Orbit path commands + the three orbiting circles.
      expect(svg).toContain('M20.341 6.484A10 10 0 0 1 10.266 21.85');
      expect(svg).toContain('M3.659 17.516A10 10 0 0 1 13.74 2.152');
      expect(svg).toContain('<circle cx="12" cy="12" r="3"/>');
      expect(svg).toContain('<circle cx="19" cy="5" r="2"/>');
      expect(svg).toContain('<circle cx="5" cy="19" r="2"/>');
    });

    it('creates a favicon link element when none exists', () => {
      expect(document.querySelector('link[rel="icon"]')).toBeNull();
      document.documentElement.style.setProperty('--accent', '103 179 255');
      applyTheme('studio-dark');
      expect(document.querySelector('link[rel="icon"]')).not.toBeNull();
    });

    it('reuses an existing favicon link instead of duplicating it', () => {
      const link = document.createElement('link');
      link.rel = 'icon';
      link.href = '/favicon.svg';
      document.head.appendChild(link);

      document.documentElement.style.setProperty('--accent', '103 179 255');
      applyTheme('studio-dark');

      const links = document.querySelectorAll('link[rel="icon"]');
      expect(links.length).toBe(1);
    });

    it('skips the favicon swap gracefully when --accent is unset', () => {
      // No setProperty call — getComputedStyle returns "" for the variable.
      expect(() => applyTheme('studio-dark')).not.toThrow();
      expect(document.querySelector('link[rel="icon"]')).toBeNull();
    });
  });
});
