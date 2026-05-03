import { describe, expect, it } from 'vitest';
import { formatBytes, utf8ByteLength } from './format';

describe('formatBytes', () => {
  it('renders sub-KB as raw bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1023)).toBe('1023 B');
  });

  it('switches to KB at 1024 with two decimals when small', () => {
    expect(formatBytes(1024)).toBe('1.00 KB');
    expect(formatBytes(1536)).toBe('1.50 KB');
  });

  it('drops decimal precision as the magnitude grows', () => {
    expect(formatBytes(15 * 1024)).toBe('15.0 KB');
    expect(formatBytes(150 * 1024)).toBe('150 KB');
  });

  it('escalates units past KB', () => {
    expect(formatBytes(2 * 1024 * 1024)).toBe('2.00 MB');
    expect(formatBytes(3 * 1024 * 1024 * 1024)).toBe('3.00 GB');
  });

  it('is defensive about bad inputs', () => {
    expect(formatBytes(NaN)).toBe('—');
    expect(formatBytes(-1)).toBe('—');
    expect(formatBytes(Infinity)).toBe('—');
  });
});

describe('utf8ByteLength', () => {
  it('counts ASCII at 1 byte per char', () => {
    expect(utf8ByteLength('hello')).toBe(5);
  });

  it('counts multi-byte Unicode correctly', () => {
    // "é" = 2 bytes, "🚀" = 4 bytes.
    expect(utf8ByteLength('café')).toBe(5);
    expect(utf8ByteLength('🚀')).toBe(4);
  });

  it('returns 0 for empty strings', () => {
    expect(utf8ByteLength('')).toBe(0);
  });
});
