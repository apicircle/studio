import { describe, expect, it } from 'vitest';
import { assertHttpUrl } from './assertHttpUrl';

describe('assertHttpUrl', () => {
  it('returns the normalized URL for an https: input', () => {
    expect(assertHttpUrl('https://idp.example.com/authorize', 'url')).toBe(
      'https://idp.example.com/authorize',
    );
  });

  it('allows http: for loopback hosts', () => {
    for (const host of ['localhost', '127.0.0.1', '[::1]']) {
      expect(assertHttpUrl(`http://${host}:8080/cb`, 'url')).toContain(host);
    }
  });

  it('rejects http: for a non-loopback host', () => {
    expect(() => assertHttpUrl('http://evil.example.com/cb', 'url')).toThrow(
      /only permitted for localhost/,
    );
  });

  it('rejects a non-http(s) scheme', () => {
    expect(() => assertHttpUrl('file:///etc/passwd', 'url')).toThrow(/must use https: or http:/);
  });

  it('rejects a non-string, empty, or over-long value', () => {
    expect(() => assertHttpUrl(123, 'url')).toThrow(/non-empty string/);
    expect(() => assertHttpUrl('', 'url')).toThrow(/non-empty string/);
    expect(() => assertHttpUrl('https://x/' + 'a'.repeat(9000), 'url')).toThrow(/under 8192 chars/);
  });

  it('rejects a malformed URL', () => {
    expect(() => assertHttpUrl('not a url', 'url')).toThrow(/is not a valid URL/);
  });
});
