// Plan §11.1 inline guide text: "Last sync N minutes ago. Refresh to
// pull remote changes." Returns a coarse human label so the UI doesn't
// flicker every second; pages re-render on store updates anyway.
//
// Pure — no Date.now() inside; the caller passes `now` (defaulting to
// system time) so tests get deterministic output.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function formatRelativeTime(isoTimestamp: string, now: number = Date.now()): string {
  const t = Date.parse(isoTimestamp);
  if (Number.isNaN(t)) return 'unknown';
  const delta = now - t;
  if (delta < 0) return 'just now';
  if (delta < MINUTE) return 'just now';
  if (delta < HOUR) {
    const m = Math.floor(delta / MINUTE);
    return `${m} minute${m === 1 ? '' : 's'} ago`;
  }
  if (delta < DAY) {
    const h = Math.floor(delta / HOUR);
    return `${h} hour${h === 1 ? '' : 's'} ago`;
  }
  const d = Math.floor(delta / DAY);
  if (d < 30) return `${d} day${d === 1 ? '' : 's'} ago`;
  // Past a month, switch to absolute date — relative time at that
  // distance is more confusing than informative.
  return new Date(t).toLocaleDateString();
}
