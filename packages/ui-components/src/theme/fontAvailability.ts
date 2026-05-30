// Runtime detector for which fonts in ALL_FONTS actually render distinctly
// on this device. Catalog entries whose stack falls through to the same OS
// face as the system mono / sans baseline are filtered out of the picker —
// otherwise the user sees options that "do nothing" when applied (a webfont
// that failed to download, a named face that isn't installed and has no
// CDN fallback, etc).
//
// We can't use document.fonts.load() because Google Fonts / jsDelivr serve
// the @font-face CSS as opaque cross-origin stylesheets — the rules apply
// at render time but never populate the FontFaceSet API, so load() returns
// empty for every face. Instead we paint each font's stack into a hidden
// span and compare its rendered width against the system mono / sans
// anchors. The browser still fetches the .woff2 files (font requests are
// independent of stylesheet CORS), so the measurement reflects real
// metrics once the load resolves.

import { ALL_FONTS, ensureWebfontLink, type FontFamilyDef } from './applyFont';

const TEST_TEXT = 'mwlilipqgjy01234567ABCDEFGHIJKLMNOPQRSTUVWXYZ!@#$%^&*().,;:';
const TEST_SIZE_PX = 64;
const WIDTH_TOLERANCE_PX = 0.5;
// Time we give the browser to download cross-origin webfont files once the
// hidden spans are in the layout tree. document.fonts.ready alone is not
// reliable here because the cross-origin loads aren't tracked by the
// FontFaceSet — we have to wait on the wall clock.
const FONT_LOAD_SETTLE_MS = 1800;

let cache: Promise<readonly FontFamilyDef[]> | null = null;

export function clearFontAvailabilityCache(): void {
  cache = null;
}

export function getAvailableFonts(): Promise<readonly FontFamilyDef[]> {
  if (cache !== null) return cache;
  cache = detectAvailableFonts().catch(() => ALL_FONTS);
  return cache;
}

async function detectAvailableFonts(): Promise<readonly FontFamilyDef[]> {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return ALL_FONTS;
  }
  if (!document.body) return ALL_FONTS;

  // 1. Inject every webfont stylesheet so the browser parses the
  //    @font-face rules. Idempotent.
  for (const font of ALL_FONTS) {
    if (font.webfontHref) ensureWebfontLink(font.webfontHref);
  }

  // 2. Create a hidden measurement container and a span per font. The
  //    span forces the browser to actually fetch each font file because
  //    a layout-included element is using the family.
  const container = document.createElement('div');
  container.setAttribute('aria-hidden', 'true');
  container.style.cssText =
    'position:absolute;left:-99999px;top:-99999px;visibility:hidden;' +
    'pointer-events:none;white-space:nowrap;font-size:' +
    String(TEST_SIZE_PX) +
    'px;line-height:1;';
  const spans = new Map<string, HTMLSpanElement>();
  for (const font of ALL_FONTS) {
    const span = document.createElement('span');
    span.style.fontFamily = font.stack;
    span.style.display = 'inline-block';
    span.textContent = TEST_TEXT;
    container.appendChild(span);
    spans.set(font.id, span);
  }
  document.body.appendChild(container);

  try {
    // 3. Force layout, then wait for font downloads to settle. We chain
    //    document.fonts.ready (catches in-flight loads the browser
    //    does track) + a fixed wall-clock delay (covers cross-origin
    //    loads that aren't tracked).
    void container.offsetWidth;
    try {
      await (document as Document & { fonts?: FontFaceSet }).fonts?.ready;
    } catch {
      // Best-effort.
    }
    await new Promise((resolve) => window.setTimeout(resolve, FONT_LOAD_SETTLE_MS));

    // 4. Measure each span. If the layout engine never resolved any
    //    real metric (jsdom), bail out instead of collapsing the
    //    catalog to system anchors only.
    const probe = spans.get('system-mono')?.getBoundingClientRect().width ?? 0;
    if (probe <= 0) return ALL_FONTS;

    const monoRef = spans.get('system-mono')?.getBoundingClientRect().width ?? 0;
    const sansRef = spans.get('system-sans')?.getBoundingClientRect().width ?? 0;

    const distinctIds = new Set<string>();
    for (const font of ALL_FONTS) {
      if (font.id === 'system-mono' || font.id === 'system-sans') {
        distinctIds.add(font.id);
        continue;
      }
      const span = spans.get(font.id);
      if (!span) continue;
      const width = span.getBoundingClientRect().width;
      const reference = font.category === 'mono' ? monoRef : sansRef;
      if (Math.abs(width - reference) > WIDTH_TOLERANCE_PX) {
        distinctIds.add(font.id);
      }
    }
    return ALL_FONTS.filter((f) => distinctIds.has(f.id));
  } finally {
    container.remove();
  }
}
