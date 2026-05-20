/**
 * Detect whether the host is the API Circle Studio Desktop shell.
 *
 * The Electron preload script attaches a bridge object on `globalThis.apicircleDesktop`
 * (see `apps/desktop/src/main/preload.ts`). The web app exposes nothing, so a
 * presence check is sufficient — we don't need to inspect the bridge's shape.
 */
export function isDesktop(): boolean {
  if (typeof globalThis === 'undefined') return false;
  return (globalThis as { apicircleDesktop?: unknown }).apicircleDesktop != null;
}
