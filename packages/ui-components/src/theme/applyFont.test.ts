import { beforeEach, describe, expect, it } from 'vitest';
import { ALL_FONTS, applyFont, getFontDef } from './applyFont';

beforeEach(() => {
  document.documentElement.removeAttribute('data-font');
  document.documentElement.style.removeProperty('--app-font');
  document.head.querySelectorAll('link[data-apicircle-font]').forEach((el) => el.remove());
});

describe('applyFont', () => {
  it('writes the stack to --app-font and sets data-font', () => {
    applyFont('jetbrains-mono');
    expect(document.documentElement.getAttribute('data-font')).toBe('jetbrains-mono');
    expect(document.documentElement.style.getPropertyValue('--app-font')).toContain(
      '"JetBrains Mono"',
    );
  });

  it('does NOT touch localStorage anymore — workspace owns the persistence', () => {
    // Pre-fix this test asserted localStorage write; the workspace store
    // is now the source of truth via local.ui.fontId.
    const before = localStorage.length;
    applyFont('inter');
    expect(localStorage.length).toBe(before);
  });

  it('injects the webfont link the first time only', () => {
    applyFont('fira-code');
    applyFont('fira-code');
    const links = document.head.querySelectorAll('link[data-apicircle-font]');
    expect(links.length).toBe(1);
  });

  it('does not inject a link for system-only presets', () => {
    applyFont('system-mono');
    const links = document.head.querySelectorAll('link[data-apicircle-font]');
    expect(links.length).toBe(0);
  });

  it('falls back to the first catalog entry (system-mono) when given an unknown id', () => {
    const def = getFontDef('not-a-font' as never);
    expect(def.id).toBe('system-mono');
  });
});

describe('catalog', () => {
  it('catalog has at least 50 fonts', () => {
    expect(ALL_FONTS.length).toBeGreaterThanOrEqual(50);
  });

  it('every font has a unique id, label, and stack', () => {
    const ids = new Set<string>();
    const labels = new Set<string>();
    const stacks = new Set<string>();
    for (const f of ALL_FONTS) {
      const label = f.label.toLowerCase();
      const stack = f.stack.replace(/\s+/g, ' ').toLowerCase();
      expect(ids.has(f.id)).toBe(false);
      expect(labels.has(label)).toBe(false);
      expect(stacks.has(stack)).toBe(false);
      ids.add(f.id);
      labels.add(label);
      stacks.add(stack);
      expect(f.stack.length).toBeGreaterThan(0);
    }
  });

  it('every font is categorised mono or sans', () => {
    for (const f of ALL_FONTS) {
      expect(['mono', 'sans']).toContain(f.category);
    }
  });

  it('every webfontHref is a valid https URL', () => {
    for (const f of ALL_FONTS) {
      if (f.webfontHref) {
        expect(f.webfontHref).toMatch(/^https:\/\//);
      }
    }
  });

  it('includes a macOS system stack without bundling Apple font files', () => {
    const font = ALL_FONTS.find((f) => f.id === 'macos-system');
    expect(font).toMatchObject({ label: 'macOS System', category: 'sans' });
    expect(font?.stack).toContain('-apple-system');
    expect(font?.stack).toContain('BlinkMacSystemFont');
    expect(font?.stack).toContain('"SF Pro Display"');
    expect(font?.stack).toContain('"SF Pro Text"');
    expect(font?.webfontHref).toBeUndefined();
  });
});
