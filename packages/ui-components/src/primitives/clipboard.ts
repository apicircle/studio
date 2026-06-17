/**
 * Safe clipboard write with fallback. Wraps `navigator.clipboard.writeText`
 * in a try-catch and falls back to the legacy `document.execCommand('copy')`
 * path for non-secure contexts (HTTP, file://, some embedded webviews).
 */
export async function safeCopyToClipboard(
  text: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return { ok: true };
    }
    if (fallbackCopy(text)) {
      return { ok: true };
    }
    return { ok: false, reason: 'Clipboard API unavailable' };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : 'Copy failed' };
  }
}

function fallbackCopy(text: string): boolean {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  document.body.removeChild(ta);
  return ok;
}
