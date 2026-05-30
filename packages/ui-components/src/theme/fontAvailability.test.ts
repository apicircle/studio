import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ALL_FONTS, type FontFamilyDef } from './applyFont';
import { clearFontAvailabilityCache, getAvailableFonts } from './fontAvailability';

beforeEach(() => {
  clearFontAvailabilityCache();
  document.head.querySelectorAll('link[data-apicircle-font]').forEach((el) => el.remove());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getAvailableFonts (jsdom fallback)', () => {
  it('returns the full catalog when the layout engine never returns a width', async () => {
    // jsdom's HTMLElement.getBoundingClientRect returns 0 widths for
    // everything because it doesn't run real layout. The detector must
    // bail out rather than collapse the catalog to system anchors.
    const fonts = await runDetector();
    expect(fonts).toBe(ALL_FONTS);
  });
});

describe('getAvailableFonts (synthetic widths)', () => {
  function installLayoutStub(widthFor: (stack: string) => number): void {
    vi.spyOn(HTMLSpanElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLSpanElement,
    ) {
      const w = widthFor(this.style.fontFamily) * (this.textContent?.length ?? 0);
      return { width: w, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON() {} };
    });
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { ready: Promise.resolve() },
    });
  }

  // The detector waits FONT_LOAD_SETTLE_MS via setTimeout. Drive it with
  // vi's fake timers so tests don't actually sleep nearly two seconds
  // each.
  async function runDetector(): Promise<readonly FontFamilyDef[]> {
    vi.useFakeTimers();
    try {
      const detectionPromise = getAvailableFonts();
      await vi.runAllTimersAsync();
      return await detectionPromise;
    } finally {
      vi.useRealTimers();
    }
  }

  it('keeps both system anchors and filters fonts whose stack matches the system width', async () => {
    // Synthetic model: walk the stack left-to-right (browser
    // font-resolution) and return the first "installed" family's
    // per-glyph width. System anchors and any font whose primary face
    // we pretend is uninstalled fall through to the same baseline.
    const monoBaseline = 7;
    const sansBaseline = 6;
    const installed: Record<string, number> = {
      'JetBrains Mono': 8,
      'Fira Code': 9,
      Inter: 10,
      'Open Sans': 11,
    };
    installLayoutStub((stack) => {
      const families = stack.split(',').map((s) => s.trim().replace(/^["']|["']$/g, ''));
      for (const f of families) {
        if (installed[f] != null) return installed[f];
      }
      return families[families.length - 1] === 'monospace' ? monoBaseline : sansBaseline;
    });

    const fonts = await runDetector();
    const ids = fonts.map((f) => f.id);

    // System anchors are always kept.
    expect(ids).toContain('system-mono');
    expect(ids).toContain('system-sans');

    // Installed webfonts whose width differs from the system baseline
    // are kept.
    expect(ids).toContain('jetbrains-mono');
    expect(ids).toContain('fira-code');
    expect(ids).toContain('inter');
    expect(ids).toContain('open-sans');

    // Webfonts whose face isn't installed in this synthetic world fall
    // through to the same width as the system anchor and are filtered.
    // `roboto`'s primary family also appears inside the system-sans
    // fallback chain — exactly the case the product should hide.
    expect(ids).not.toContain('cascadia-code');
    expect(ids).not.toContain('hack');
    expect(ids).not.toContain('lato');
    expect(ids).not.toContain('roboto');
  });

  it('preloads every webfont stylesheet so the rendered spans force a font fetch', async () => {
    installLayoutStub(() => 7);
    await runDetector();
    const links = document.head.querySelectorAll('link[data-apicircle-font]');
    const expected = ALL_FONTS.filter((f) => f.webfontHref).length;
    expect(links.length).toBe(expected);
  });

  it('cleans the measurement container off the DOM after detection', async () => {
    installLayoutStub(() => 7);
    await runDetector();
    // No leftover absolutely-positioned scratch container.
    const stray = Array.from(document.body.children).filter(
      (el) => el.getAttribute('aria-hidden') === 'true',
    );
    expect(stray.length).toBe(0);
  });

  it('memoises the result across calls and clearFontAvailabilityCache resets it', async () => {
    let measurements = 0;
    installLayoutStub(() => {
      measurements++;
      return 7;
    });
    await runDetector();
    const callsAfterFirst = measurements;
    await getAvailableFonts(); // cached — no timer flush needed
    expect(measurements).toBe(callsAfterFirst);

    clearFontAvailabilityCache();
    await runDetector();
    expect(measurements).toBeGreaterThan(callsAfterFirst);
  });
});

// jsdom-fallback test goes through the same code path but without the
// layout stub installed, so widths stay 0 and detector bails to ALL_FONTS.
async function runDetector(): Promise<readonly FontFamilyDef[]> {
  vi.useFakeTimers();
  try {
    const detectionPromise = getAvailableFonts();
    await vi.runAllTimersAsync();
    return await detectionPromise;
  } finally {
    vi.useRealTimers();
  }
}
