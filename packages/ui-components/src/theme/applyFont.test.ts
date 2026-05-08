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

  it('falls back to system-mono when given an unknown id', () => {
    const def = getFontDef('not-a-font' as never);
    expect(def.id).toBe('system-mono');
  });
});

describe('catalog', () => {
  it('every font has a unique id and a non-empty stack', () => {
    const seen = new Set<string>();
    for (const f of ALL_FONTS) {
      expect(seen.has(f.id)).toBe(false);
      seen.add(f.id);
      expect(f.stack.length).toBeGreaterThan(0);
    }
  });

  it('every font is categorised mono or sans', () => {
    for (const f of ALL_FONTS) {
      expect(['mono', 'sans']).toContain(f.category);
    }
  });
});
