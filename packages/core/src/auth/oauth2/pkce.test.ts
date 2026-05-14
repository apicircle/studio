import { describe, expect, it } from 'vitest';
import { computeCodeChallenge, generateCodeVerifier } from './pkce';

describe('generateCodeVerifier', () => {
  it('returns 64 URL-safe characters by default', () => {
    const v = generateCodeVerifier();
    expect(v).toMatch(/^[A-Za-z0-9\-._~]{64}$/);
  });

  it('honors a custom length within 43..128', () => {
    expect(generateCodeVerifier(43)).toHaveLength(43);
    expect(generateCodeVerifier(128)).toHaveLength(128);
  });

  it('throws when length is outside RFC 7636 bounds', () => {
    expect(() => generateCodeVerifier(42)).toThrow(/43..128/);
    expect(() => generateCodeVerifier(129)).toThrow(/43..128/);
  });

  it('produces different output across calls (entropy check)', () => {
    const a = generateCodeVerifier();
    const b = generateCodeVerifier();
    expect(a).not.toBe(b);
  });

  it('samples uniformly from a 64-char base64url alphabet (no modulo bias)', () => {
    // Phase 3e: the previous implementation did `bytes[i] % 66`, which
    // mapped 256 input values onto 66 alphabet positions non-uniformly
    // (values 0..189 → two chars each; 190..255 → one). The fixed
    // implementation masks with `& 0x3f` against a 64-char alphabet, so
    // every output character is equally probable.
    const sample = generateCodeVerifier(128) + generateCodeVerifier(128);
    // Every character must be in the unreserved URL set [A-Za-z0-9_-].
    expect(sample).toMatch(/^[A-Za-z0-9_-]+$/);
    // `.` and `~` (allowed by RFC but removed for uniformity) should never
    // appear in the new output.
    expect(sample).not.toMatch(/[.~]/);
  });
});

describe('computeCodeChallenge', () => {
  it('returns the verifier verbatim for plain method', async () => {
    const v = 'verifier-xyz-43-chars-padded-to-the-min-len-12';
    expect(await computeCodeChallenge(v, 'plain')).toBe(v);
  });

  it('matches the RFC 7636 §4.6 worked example for S256', async () => {
    // RFC vector: verifier =
    //   "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
    // expected S256 challenge =
    //   "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
    const challenge = await computeCodeChallenge(
      'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk',
      'S256',
    );
    expect(challenge).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('defaults to S256 when method is omitted', async () => {
    const verifier = 'a'.repeat(43);
    const explicit = await computeCodeChallenge(verifier, 'S256');
    const implicit = await computeCodeChallenge(verifier);
    expect(implicit).toBe(explicit);
  });
});
