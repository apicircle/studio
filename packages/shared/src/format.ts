/**
 * Human-readable byte size. UTF-8 byte count, base-1024 (KiB/MiB).
 * 0 → "0 B", 1023 → "1023 B", 1024 → "1.0 KB", 1_500_000 → "1.4 MB".
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unitIdx = 0;
  while (value >= 1024 && unitIdx < units.length - 1) {
    value /= 1024;
    unitIdx++;
  }
  return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${units[unitIdx]}`;
}

/** UTF-8 byte length of a string. Falls back to char length if TextEncoder unavailable. */
export function utf8ByteLength(s: string): number {
  if (typeof TextEncoder === 'undefined') return s.length;
  return new TextEncoder().encode(s).length;
}
