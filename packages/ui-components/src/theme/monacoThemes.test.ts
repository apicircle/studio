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
  it('defines all six themes on first call', () => {
    const defineTheme = vi.fn();
    registerMonacoThemes({ defineTheme });
    const names = defineTheme.mock.calls.map((c) => c[0]);
    expect(names).toContain('apicircle-v2-studio-dark');
    expect(names).toContain('apicircle-v2-graphite-dark');
    expect(names).toContain('apicircle-v2-midnight-blue');
    expect(names).toContain('apicircle-v2-workbench-light');
    expect(names).toContain('apicircle-v2-paper-light');
    expect(names).toContain('apicircle-v2-high-contrast-dark');
    expect(names).toHaveLength(6);
  });

  it('is idempotent — second call is a no-op', () => {
    const defineTheme = vi.fn();
    registerMonacoThemes({ defineTheme });
    registerMonacoThemes({ defineTheme });
    expect(defineTheme).toHaveBeenCalledTimes(6);
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
