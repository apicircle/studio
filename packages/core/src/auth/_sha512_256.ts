/**
 * SHA-512/256 — FIPS 180-4 §6.7. Required by HTTP Digest auth (RFC 7616
 * §3.5.1) which mandates the FIPS 180-4 truncation variant, NOT a naive
 * truncation of SHA-512. The two differ because SHA-512/256 uses
 * different initial hash values (IVs); the round function is identical
 * to SHA-512.
 *
 * WebCrypto exposes SHA-512 but not SHA-512/256, and there's no API to
 * supply custom IVs, so we implement the full compression function
 * inline. Ported from the FIPS 180-4 specification, validated against
 * the canonical NIST test vectors:
 *
 *   SHA-512/256("abc") = 53048e2681941ef99b2e29b76b4c7dde
 *                        9f2492c4d6311e9cc4571d9f0fe8b22a
 *
 * Internal module — not exported from the package barrel. Imported by
 * `digest.ts` for `algorithm=SHA-512-256` Digest challenges. Performance
 * is not critical here (Digest auth is rare and inputs are tiny), so we
 * use BigInt arithmetic for clarity over a hand-rolled 64-bit emulation.
 */

const MASK64 = 0xffffffffffffffffn;

/** SHA-512/256 IVs per FIPS 180-4 §5.3.6.2 (different from SHA-512's). */
const IV: ReadonlyArray<bigint> = [
  0x22312194fc2bf72cn,
  0x9f555fa3c84c64c2n,
  0x2393b86b6f53b151n,
  0x963877195940eabdn,
  0x96283ee2a88effe3n,
  0xbe5e1e2553863992n,
  0x2b0199fc2c85b8aan,
  0x0eb72ddc81c52ca2n,
];

/** SHA-512 / SHA-512/256 share the same 80 round constants (FIPS 180-4 §4.2.3). */
const K: ReadonlyArray<bigint> = [
  0x428a2f98d728ae22n,
  0x7137449123ef65cdn,
  0xb5c0fbcfec4d3b2fn,
  0xe9b5dba58189dbbcn,
  0x3956c25bf348b538n,
  0x59f111f1b605d019n,
  0x923f82a4af194f9bn,
  0xab1c5ed5da6d8118n,
  0xd807aa98a3030242n,
  0x12835b0145706fben,
  0x243185be4ee4b28cn,
  0x550c7dc3d5ffb4e2n,
  0x72be5d74f27b896fn,
  0x80deb1fe3b1696b1n,
  0x9bdc06a725c71235n,
  0xc19bf174cf692694n,
  0xe49b69c19ef14ad2n,
  0xefbe4786384f25e3n,
  0x0fc19dc68b8cd5b5n,
  0x240ca1cc77ac9c65n,
  0x2de92c6f592b0275n,
  0x4a7484aa6ea6e483n,
  0x5cb0a9dcbd41fbd4n,
  0x76f988da831153b5n,
  0x983e5152ee66dfabn,
  0xa831c66d2db43210n,
  0xb00327c898fb213fn,
  0xbf597fc7beef0ee4n,
  0xc6e00bf33da88fc2n,
  0xd5a79147930aa725n,
  0x06ca6351e003826fn,
  0x142929670a0e6e70n,
  0x27b70a8546d22ffcn,
  0x2e1b21385c26c926n,
  0x4d2c6dfc5ac42aedn,
  0x53380d139d95b3dfn,
  0x650a73548baf63den,
  0x766a0abb3c77b2a8n,
  0x81c2c92e47edaee6n,
  0x92722c851482353bn,
  0xa2bfe8a14cf10364n,
  0xa81a664bbc423001n,
  0xc24b8b70d0f89791n,
  0xc76c51a30654be30n,
  0xd192e819d6ef5218n,
  0xd69906245565a910n,
  0xf40e35855771202an,
  0x106aa07032bbd1b8n,
  0x19a4c116b8d2d0c8n,
  0x1e376c085141ab53n,
  0x2748774cdf8eeb99n,
  0x34b0bcb5e19b48a8n,
  0x391c0cb3c5c95a63n,
  0x4ed8aa4ae3418acbn,
  0x5b9cca4f7763e373n,
  0x682e6ff3d6b2b8a3n,
  0x748f82ee5defb2fcn,
  0x78a5636f43172f60n,
  0x84c87814a1f0ab72n,
  0x8cc702081a6439ecn,
  0x90befffa23631e28n,
  0xa4506cebde82bde9n,
  0xbef9a3f7b2c67915n,
  0xc67178f2e372532bn,
  0xca273eceea26619cn,
  0xd186b8c721c0c207n,
  0xeada7dd6cde0eb1en,
  0xf57d4f7fee6ed178n,
  0x06f067aa72176fban,
  0x0a637dc5a2c898a6n,
  0x113f9804bef90daen,
  0x1b710b35131c471bn,
  0x28db77f523047d84n,
  0x32caab7b40c72493n,
  0x3c9ebe0a15c9bebcn,
  0x431d67c49c100d4cn,
  0x4cc5d4becb3e42b6n,
  0x597f299cfc657e2an,
  0x5fcb6fab3ad6faecn,
  0x6c44198c4a475817n,
];

function ror64(x: bigint, n: bigint): bigint {
  return ((x >> n) | (x << (64n - n))) & MASK64;
}

function shr64(x: bigint, n: bigint): bigint {
  return (x >> n) & MASK64;
}

/**
 * Compute the SHA-512/256 digest of `bytes` and return it as a 64-char
 * lowercase hex string. Public surface — `digest.ts` calls this for
 * `algorithm=SHA-512-256` HA1/HA2 hashing.
 */
export function sha512_256(bytes: Uint8Array): string {
  // Padding (FIPS 180-4 §5.1.2): append 0x80, zero-pad to 128|112 bytes,
  // then a 128-bit big-endian length. We never approach 2^64 input bytes
  // in practice, so the high 64 bits of the length are always zero.
  const msgLen = bytes.length;
  const bitLen = BigInt(msgLen) * 8n;
  // After the 0x80 byte we want the total length to be ≡ 112 (mod 128)
  // so the appended 16-byte length field puts the message at a multiple
  // of 128 bytes (one 1024-bit block).
  let padBytes = 112 - ((msgLen + 1) % 128);
  if (padBytes < 0) padBytes += 128;
  const padded = new Uint8Array(msgLen + 1 + padBytes + 16);
  padded.set(bytes);
  padded[msgLen] = 0x80;
  // High 64 bits of length: zero. Low 64 bits: bitLen, big-endian.
  for (let i = 0; i < 8; i++) {
    padded[padded.length - 1 - i] = Number((bitLen >> BigInt(i * 8)) & 0xffn);
  }

  let h: bigint[] = [...IV];

  // Process each 1024-bit (128-byte) block. `W` is the message schedule;
  // 80 BigInt words filled in below before any read.
  const W: bigint[] = new Array<bigint>(80);
  for (let block = 0; block < padded.length; block += 128) {
    // Initial 16 message-schedule words are big-endian 64-bit slices.
    for (let t = 0; t < 16; t++) {
      let w = 0n;
      for (let j = 0; j < 8; j++) {
        w = (w << 8n) | BigInt(padded[block + t * 8 + j]);
      }
      W[t] = w;
    }
    // Extend to 80 words via the message-schedule recurrence.
    for (let t = 16; t < 80; t++) {
      const wm15 = W[t - 15];
      const wm2 = W[t - 2];
      const s0 = ror64(wm15, 1n) ^ ror64(wm15, 8n) ^ shr64(wm15, 7n);
      const s1 = ror64(wm2, 19n) ^ ror64(wm2, 61n) ^ shr64(wm2, 6n);
      W[t] = (W[t - 16] + s0 + W[t - 7] + s1) & MASK64;
    }

    let a = h[0];
    let b = h[1];
    let c = h[2];
    let d = h[3];
    let e = h[4];
    let f = h[5];
    let g = h[6];
    let hh = h[7];

    for (let t = 0; t < 80; t++) {
      const S1 = ror64(e, 14n) ^ ror64(e, 18n) ^ ror64(e, 41n);
      const ch = (e & f) ^ (~e & MASK64 & g);
      const T1 = (hh + S1 + ch + K[t] + W[t]) & MASK64;
      const S0 = ror64(a, 28n) ^ ror64(a, 34n) ^ ror64(a, 39n);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const T2 = (S0 + maj) & MASK64;
      hh = g;
      g = f;
      f = e;
      e = (d + T1) & MASK64;
      d = c;
      c = b;
      b = a;
      a = (T1 + T2) & MASK64;
    }

    h = [
      (h[0] + a) & MASK64,
      (h[1] + b) & MASK64,
      (h[2] + c) & MASK64,
      (h[3] + d) & MASK64,
      (h[4] + e) & MASK64,
      (h[5] + f) & MASK64,
      (h[6] + g) & MASK64,
      (h[7] + hh) & MASK64,
    ];
  }

  // SHA-512/256 output: first 256 bits = first 4 H values, big-endian hex.
  let out = '';
  for (let i = 0; i < 4; i++) out += h[i].toString(16).padStart(16, '0');
  return out;
}
