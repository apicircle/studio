import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  __resetMonacoThemesForTests,
  getMonacoThemeId,
  registerMonacoThemes,
} from './monacoThemes';

afterEach(() => {
  __resetMonacoThemesForTests();
});

describe('getMonacoThemeId', () => {
  it('namespaces every studio theme under apicircle-v2-*', () => {
    expect(getMonacoThemeId('studio-dark')).toBe('apicircle-v2-studio-dark');
    expect(getMonacoThemeId('paper-light')).toBe('apicircle-v2-paper-light');
    expect(getMonacoThemeId('high-contrast-dark')).toBe('apicircle-v2-high-contrast-dark');
  });
});

describe('registerMonacoThemes', () => {
  it('defines every studio theme on first call', () => {
    const defineTheme = vi.fn();
    registerMonacoThemes({ defineTheme });
    const names = defineTheme.mock.calls.map((c) => c[0]);
    // Built-ins
    expect(names).toContain('apicircle-v2-studio-dark');
    expect(names).toContain('apicircle-v2-graphite-dark');
    expect(names).toContain('apicircle-v2-midnight-blue');
    expect(names).toContain('apicircle-v2-workbench-light');
    expect(names).toContain('apicircle-v2-paper-light');
    expect(names).toContain('apicircle-v2-high-contrast-dark');
    expect(names).toContain('apicircle-v2-high-contrast-light');
    // Community palettes (spot-check)
    expect(names).toContain('apicircle-v2-dracula');
    expect(names).toContain('apicircle-v2-nord');
    expect(names).toContain('apicircle-v2-tokyo-night');
    expect(names).toContain('apicircle-v2-github-dark');
    expect(names).toContain('apicircle-v2-github-light');
    expect(names).toContain('apicircle-v2-catppuccin-latte');
    expect(names.length).toBeGreaterThanOrEqual(30);
    expect(new Set(names).size).toBe(names.length); // unique
  });

  it('is idempotent — second call is a no-op', () => {
    const defineTheme = vi.fn();
    registerMonacoThemes({ defineTheme });
    const firstCallCount = defineTheme.mock.calls.length;
    registerMonacoThemes({ defineTheme });
    expect(defineTheme).toHaveBeenCalledTimes(firstCallCount);
  });

  it('passes a Monaco-shaped theme def with base + colors', () => {
    const defineTheme = vi.fn();
    registerMonacoThemes({ defineTheme });
    const [, def] = defineTheme.mock.calls[0];
    expect(def).toMatchObject({
      base: expect.stringMatching(/^(vs|vs-dark|hc-black|hc-light)$/),
      inherit: true,
      rules: expect.any(Array),
      colors: expect.objectContaining({
        'editor.background': expect.stringMatching(/^#[0-9a-f]+$/i),
        'editor.foreground': expect.stringMatching(/^#[0-9a-f]+$/i),
      }),
    });
  });
});
