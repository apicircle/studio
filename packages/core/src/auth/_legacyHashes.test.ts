import { describe, expect, it } from 'vitest';
import { hmacMd5, md4, md5, md5Bytes } from './_legacyHashes';

describe('md5', () => {
  // RFC 1321 §A.5 published test vectors.
  it.each([
    ['', 'd41d8cd98f00b204e9800998ecf8427e'],
    ['a', '0cc175b9c0f1b6a831c399e269772661'],
    ['abc', '900150983cd24fb0d6963f7d28e17f72'],
    ['message digest', 'f96b697d7cb7938d525a2f31aaf161d0'],
    ['abcdefghijklmnopqrstuvwxyz', 'c3fcd3d76192e4007dfb496cca67e13b'],
    [
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
      'd174ab98d277d9f5a5611c2c9f419d9f',
    ],
    [
      '12345678901234567890123456789012345678901234567890123456789012345678901234567890',
      '57edf4a22be3c955ac49da2e2107b67a',
    ],
  ])('matches the RFC 1321 vector for input %j', (input, expected) => {
    expect(md5(input)).toBe(expected);
  });
});

describe('md5Bytes', () => {
  it('returns the binary form of MD5("abc")', () => {
    const hex = '900150983cd24fb0d6963f7d28e17f72';
    const bytes = md5Bytes(new TextEncoder().encode('abc'));
    const out = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    expect(out).toBe(hex);
  });
});

describe('md4', () => {
  // RFC 1320 §A.5 published test vectors.
  it.each([
    ['', '31d6cfe0d16ae931b73c59d7e0c089c0'],
    ['a', 'bde52cb31de33e46245e05fbdbd6fb24'],
    ['abc', 'a448017aaf21d8525fc10ae87aa6729d'],
    ['message digest', 'd9130a8164549fe818874806e1c7014b'],
    ['abcdefghijklmnopqrstuvwxyz', 'd79e1c308aa5bbcdeea8ed63df412da9'],
  ])('matches the RFC 1320 vector for input %j', (input, expected) => {
    const out = Array.from(md4(new TextEncoder().encode(input)), (b) =>
      b.toString(16).padStart(2, '0'),
    ).join('');
    expect(out).toBe(expected);
  });
});

describe('hmacMd5', () => {
  // RFC 2202 §2 — HMAC-MD5 published test vectors.
  it('matches RFC 2202 test 1 (key=0x0b * 16, data="Hi There")', () => {
    const key = new Uint8Array(16).fill(0x0b);
    const data = new TextEncoder().encode('Hi There');
    const out = Array.from(hmacMd5(key, data), (b) => b.toString(16).padStart(2, '0')).join('');
    expect(out).toBe('9294727a3638bb1c13f48ef8158bfc9d');
  });

  it('matches RFC 2202 test 2 (key="Jefe", data="what do ya want for nothing?")', () => {
    const key = new TextEncoder().encode('Jefe');
    const data = new TextEncoder().encode('what do ya want for nothing?');
    const out = Array.from(hmacMd5(key, data), (b) => b.toString(16).padStart(2, '0')).join('');
    expect(out).toBe('750c783e6ab0b503eaa86e310a5db738');
  });

  it('handles keys longer than 64 bytes by hashing them first', () => {
    const longKey = new Uint8Array(80).fill(0xaa);
    const data = new TextEncoder().encode('Test Using Larger Than Block-Size Key - Hash Key First');
    const out = Array.from(hmacMd5(longKey, data), (b) => b.toString(16).padStart(2, '0')).join('');
    // RFC 2202 test 6 expected.
    expect(out).toBe('6b1ab7fe4bd7bf8f0b62e6ce61b9d0cd');
  });
});
