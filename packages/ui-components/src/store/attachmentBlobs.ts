// Helpers for shipping attachment bytes through the GitHub Tree API. Bytes
// land at `.apicircle/attachments/<slotId>` so the CLI (future package) can
// read them straight off disk.

const CHUNK = 0x8000; // 32 KiB — small enough to never blow the call stack

/**
 * Browser-safe binary → base64. `btoa` only handles 8-bit strings, so we
 * convert via `String.fromCharCode` in chunks. This works in jsdom too.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, Math.min(i + CHUNK, bytes.length));
    binary += String.fromCharCode.apply(null, Array.from(slice));
  }
  return btoa(binary);
}
