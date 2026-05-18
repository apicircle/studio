import { describe, expect, it } from 'vitest';
import { formatRelativeTime } from './relativeTime';

const NOW = Date.parse('2026-04-27T12:00:00.000Z');

describe('formatRelativeTime', () => {
  it('treats deltas under a minute as "just now"', () => {
    expect(formatRelativeTime('2026-04-27T11:59:30.000Z', NOW)).toBe('just now');
  });

  it('formats minutes, including the singular "1 minute ago"', () => {
    expect(formatRelativeTime('2026-04-27T11:59:00.000Z', NOW)).toBe('1 minute ago');
    expect(formatRelativeTime('2026-04-27T11:55:00.000Z', NOW)).toBe('5 minutes ago');
  });

  it('formats hours and days with proper pluralization', () => {
    expect(formatRelativeTime('2026-04-27T11:00:00.000Z', NOW)).toBe('1 hour ago');
    expect(formatRelativeTime('2026-04-27T09:00:00.000Z', NOW)).toBe('3 hours ago');
    expect(formatRelativeTime('2026-04-26T12:00:00.000Z', NOW)).toBe('1 day ago');
    expect(formatRelativeTime('2026-04-22T12:00:00.000Z', NOW)).toBe('5 days ago');
  });

  it('switches to an absolute date past 30 days', () => {
    // A timestamp ~60 days back — output should be a locale date string,
    // not "60 days ago".
    const result = formatRelativeTime('2026-02-20T00:00:00.000Z', NOW);
    expect(result).not.toMatch(/days? ago/);
  });

  it('returns "unknown" for an unparseable input', () => {
    expect(formatRelativeTime('garbage', NOW)).toBe('unknown');
  });

  it('treats future timestamps (clock skew) as "just now"', () => {
    expect(formatRelativeTime('2026-04-27T13:00:00.000Z', NOW)).toBe('just now');
  });
});
