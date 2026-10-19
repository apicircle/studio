import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatResponseForView, isLargeResponsePayload } from './formatResponseForView';

const FIVE_MB = 5 * 1024 * 1024;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('formatResponseForView', () => {
  it('pretty-prints JSON', () => {
    expect(formatResponseForView('{"a":[1,2]}', 'json')).toBe('{\n  "a": [\n    1,\n    2\n  ]\n}');
  });

  it('shows JSON it cannot parse, and anything that is not JSON, as it came', () => {
    expect(formatResponseForView('{"a":', 'json')).toBe('{"a":');
    expect(formatResponseForView('{"a":1}', 'plaintext')).toBe('{"a":1}');
  });

  it('leaves a body too large to format as it came', () => {
    const big = `{"pad":"${'x'.repeat(FIVE_MB)}"}`;
    expect(formatResponseForView(big, 'json')).toBe(big);
  });
});

describe('isLargeResponsePayload', () => {
  it('measures the body in bytes, at 5 MB', () => {
    expect(isLargeResponsePayload('x'.repeat(FIVE_MB - 1))).toBe(false);
    expect(isLargeResponsePayload('x'.repeat(FIVE_MB))).toBe(true);
    // A two-byte character counts twice.
    expect(isLargeResponsePayload('é'.repeat(FIVE_MB / 2))).toBe(true);
  });

  it('counts characters where there is no TextEncoder', () => {
    vi.stubGlobal('TextEncoder', undefined);
    expect(isLargeResponsePayload('é'.repeat(FIVE_MB / 2))).toBe(false);
    expect(isLargeResponsePayload('x'.repeat(FIVE_MB))).toBe(true);
  });
});
