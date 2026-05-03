import { describe, expect, it } from 'vitest';
import { sha512_256 } from './_sha512_256';

const enc = new TextEncoder();

describe('sha512_256 (FIPS 180-4)', () => {
  // Canonical NIST CAVS test vectors. These are widely published —
  // matching them validates both the IV constants and the compression
  // function. If any of these regress, our Digest auth produces wire
  // bytes the server will reject.

  it('matches the empty-string vector', () => {
    // SHA-512/256("") — single-block input that exercises padding.
    expect(sha512_256(enc.encode(''))).toBe(
      'c672b8d1ef56ed28ab87c3622c5114069bdd3ad7b8f9737498d0c01ecef0967a',
    );
  });

  it('matches the "abc" vector (NIST FIPS 180-4 example)', () => {
    expect(sha512_256(enc.encode('abc'))).toBe(
      '53048e2681941ef99b2e29b76b4c7dabe4c2d0c634fc6d46e0e2f13107e7af23',
    );
  });

  it('matches the longer multi-block vector', () => {
    // 112-byte input — exercises the case where padding spills into a
    // second block (boundary between message bytes and the 128-bit
    // length field is exactly at the block edge).
    const input =
      'abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu';
    expect(sha512_256(enc.encode(input))).toBe(
      '3928e184fb8690f840da3988121d31be65cb9d3ef83ee6146feac861e19b563a',
    );
  });

  it('produces 64 hex chars regardless of input size', () => {
    expect(sha512_256(enc.encode('x')).length).toBe(64);
    expect(sha512_256(enc.encode('x'.repeat(1000))).length).toBe(64);
  });
});
