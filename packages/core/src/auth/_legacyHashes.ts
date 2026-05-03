/**
 * Legacy MD5 / MD4 + HMAC-MD5 — required for Digest auth (RFC 7616) and
 * NTLMv2 (RFC 4178). Both are obsolete cryptographically but mandated
 * for interop with servers that still use them. Implemented inline so
 * we don't take a runtime dep for two specific protocols, and so the
 * web bundle stays browser-safe (WebCrypto doesn't expose MD5/MD4).
 *
 * Internal module — not exported from the package barrel. Importers go
 * through `digest.ts` / `ntlm.ts`. Algorithms ported verbatim from the
 * v1 reference (`studio_old/packages/core/src/request/executionEngine.ts`)
 * which was tested against RFC vectors in production.
 *
 * Do NOT use these for any new use case — they're leaks of legacy
 * protocols, kept here for compatibility only.
 */

// ── MD5 (RFC 1321) ─────────────────────────────────────────────────────────────
export function md5(str: string): string {
  function safeAdd(x: number, y: number) {
    const lsw = (x & 0xffff) + (y & 0xffff);
    const msw = (x >> 16) + (y >> 16) + (lsw >> 16);
    return (msw << 16) | (lsw & 0xffff);
  }
  const rol = (n: number, c: number) => (n << c) | (n >>> (32 - c));
  const cmn = (q: number, a: number, b: number, x: number, s: number, t: number) =>
    safeAdd(rol(safeAdd(safeAdd(a, q), safeAdd(x, t)), s), b);
  const ff = (a: number, b: number, c: number, d: number, x: number, s: number, t: number) =>
    cmn((b & c) | (~b & d), a, b, x, s, t);
  const gg = (a: number, b: number, c: number, d: number, x: number, s: number, t: number) =>
    cmn((b & d) | (c & ~d), a, b, x, s, t);
  const hh = (a: number, b: number, c: number, d: number, x: number, s: number, t: number) =>
    cmn(b ^ c ^ d, a, b, x, s, t);
  const ii = (a: number, b: number, c: number, d: number, x: number, s: number, t: number) =>
    cmn(c ^ (b | ~d), a, b, x, s, t);

  const n = str.length;
  const nblk = ((n + 8) >> 6) + 1;
  const blks = new Array<number>(nblk * 16).fill(0);
  for (let i = 0; i < n; i++) {
    blks[i >> 2] = (blks[i >> 2] ?? 0) | (str.charCodeAt(i) << ((i % 4) * 8));
  }
  blks[n >> 2] = (blks[n >> 2] ?? 0) | (0x80 << ((n % 4) * 8));
  blks[nblk * 16 - 2] = n * 8;

  let a = 0x67452301,
    b = 0xefcdab89,
    c = 0x98badcfe,
    d = 0x10325476;
  for (let i = 0; i < blks.length; i += 16) {
    const [oa, ob, oc, od] = [a, b, c, d];
    const x = blks.slice(i, i + 16);
    a = ff(a, b, c, d, x[0], 7, 0xd76aa478);
    d = ff(d, a, b, c, x[1], 12, 0xe8c7b756);
    c = ff(c, d, a, b, x[2], 17, 0x242070db);
    b = ff(b, c, d, a, x[3], 22, 0xc1bdceee);
    a = ff(a, b, c, d, x[4], 7, 0xf57c0faf);
    d = ff(d, a, b, c, x[5], 12, 0x4787c62a);
    c = ff(c, d, a, b, x[6], 17, 0xa8304613);
    b = ff(b, c, d, a, x[7], 22, 0xfd469501);
    a = ff(a, b, c, d, x[8], 7, 0x698098d8);
    d = ff(d, a, b, c, x[9], 12, 0x8b44f7af);
    c = ff(c, d, a, b, x[10], 17, 0xffff5bb1);
    b = ff(b, c, d, a, x[11], 22, 0x895cd7be);
    a = ff(a, b, c, d, x[12], 7, 0x6b901122);
    d = ff(d, a, b, c, x[13], 12, 0xfd987193);
    c = ff(c, d, a, b, x[14], 17, 0xa679438e);
    b = ff(b, c, d, a, x[15], 22, 0x49b40821);
    a = gg(a, b, c, d, x[1], 5, 0xf61e2562);
    d = gg(d, a, b, c, x[6], 9, 0xc040b340);
    c = gg(c, d, a, b, x[11], 14, 0x265e5a51);
    b = gg(b, c, d, a, x[0], 20, 0xe9b6c7aa);
    a = gg(a, b, c, d, x[5], 5, 0xd62f105d);
    d = gg(d, a, b, c, x[10], 9, 0x02441453);
    c = gg(c, d, a, b, x[15], 14, 0xd8a1e681);
    b = gg(b, c, d, a, x[4], 20, 0xe7d3fbc8);
    a = gg(a, b, c, d, x[9], 5, 0x21e1cde6);
    d = gg(d, a, b, c, x[14], 9, 0xc33707d6);
    c = gg(c, d, a, b, x[3], 14, 0xf4d50d87);
    b = gg(b, c, d, a, x[8], 20, 0x455a14ed);
    a = gg(a, b, c, d, x[13], 5, 0xa9e3e905);
    d = gg(d, a, b, c, x[2], 9, 0xfcefa3f8);
    c = gg(c, d, a, b, x[7], 14, 0x676f02d9);
    b = gg(b, c, d, a, x[12], 20, 0x8d2a4c8a);
    a = hh(a, b, c, d, x[5], 4, 0xfffa3942);
    d = hh(d, a, b, c, x[8], 11, 0x8771f681);
    c = hh(c, d, a, b, x[11], 16, 0x6d9d6122);
    b = hh(b, c, d, a, x[14], 23, 0xfde5380c);
    a = hh(a, b, c, d, x[1], 4, 0xa4beea44);
    d = hh(d, a, b, c, x[4], 11, 0x4bdecfa9);
    c = hh(c, d, a, b, x[7], 16, 0xf6bb4b60);
    b = hh(b, c, d, a, x[10], 23, 0xbebfbc70);
    a = hh(a, b, c, d, x[13], 4, 0x289b7ec6);
    d = hh(d, a, b, c, x[0], 11, 0xeaa127fa);
    c = hh(c, d, a, b, x[3], 16, 0xd4ef3085);
    b = hh(b, c, d, a, x[6], 23, 0x04881d05);
    a = hh(a, b, c, d, x[9], 4, 0xd9d4d039);
    d = hh(d, a, b, c, x[12], 11, 0xe6db99e5);
    c = hh(c, d, a, b, x[15], 16, 0x1fa27cf8);
    b = hh(b, c, d, a, x[2], 23, 0xc4ac5665);
    a = ii(a, b, c, d, x[0], 6, 0xf4292244);
    d = ii(d, a, b, c, x[7], 10, 0x432aff97);
    c = ii(c, d, a, b, x[14], 15, 0xab9423a7);
    b = ii(b, c, d, a, x[5], 21, 0xfc93a039);
    a = ii(a, b, c, d, x[12], 6, 0x655b59c3);
    d = ii(d, a, b, c, x[3], 10, 0x8f0ccc92);
    c = ii(c, d, a, b, x[10], 15, 0xffeff47d);
    b = ii(b, c, d, a, x[1], 21, 0x85845dd1);
    a = ii(a, b, c, d, x[8], 6, 0x6fa87e4f);
    d = ii(d, a, b, c, x[15], 10, 0xfe2ce6e0);
    c = ii(c, d, a, b, x[6], 15, 0xa3014314);
    b = ii(b, c, d, a, x[13], 21, 0x4e0811a1);
    a = ii(a, b, c, d, x[4], 6, 0xf7537e82);
    d = ii(d, a, b, c, x[11], 10, 0xbd3af235);
    c = ii(c, d, a, b, x[2], 15, 0x2ad7d2bb);
    b = ii(b, c, d, a, x[9], 21, 0xeb86d391);
    a = safeAdd(a, oa);
    b = safeAdd(b, ob);
    c = safeAdd(c, oc);
    d = safeAdd(d, od);
  }
  const hex = (v: number) =>
    [v, v >>> 8, v >>> 16, v >>> 24].map((n) => (n & 0xff).toString(16).padStart(2, '0')).join('');
  return hex(a) + hex(b) + hex(c) + hex(d);
}

// ── MD4 (RFC 1320) — used for NTLM NT-hash ─────────────────────────────────────
export function md4(input: Uint8Array): Uint8Array {
  const rol = (x: number, n: number): number => ((x << n) | (x >>> (32 - n))) >>> 0;
  const add = (x: number, y: number): number => (x + y) >>> 0;
  const F = (x: number, y: number, z: number): number => ((x & y) | (~x & z)) >>> 0;
  const G = (x: number, y: number, z: number): number => ((x & y) | (x & z) | (y & z)) >>> 0;
  const H = (x: number, y: number, z: number): number => (x ^ y ^ z) >>> 0;
  const padLen = (56 - ((input.length + 1) % 64) + 64) % 64;
  const buf = new Uint8Array(input.length + 1 + padLen + 8);
  buf.set(input);
  buf[input.length] = 0x80;
  const v = new DataView(buf.buffer);
  v.setUint32(buf.length - 8, (input.length * 8) >>> 0, true);
  v.setUint32(buf.length - 4, Math.floor(input.length / 0x20000000), true);
  let a = 0x67452301,
    b = 0xefcdab89,
    c = 0x98badcfe,
    d = 0x10325476;
  for (let i = 0; i < buf.length; i += 64) {
    const x = Array.from({ length: 16 }, (_, k) => v.getUint32(i + k * 4, true));
    const [sa, sb, sc, sd] = [a, b, c, d];
    a = rol(add(add(a, F(b, c, d)), x[0]), 3);
    d = rol(add(add(d, F(a, b, c)), x[1]), 7);
    c = rol(add(add(c, F(d, a, b)), x[2]), 11);
    b = rol(add(add(b, F(c, d, a)), x[3]), 19);
    a = rol(add(add(a, F(b, c, d)), x[4]), 3);
    d = rol(add(add(d, F(a, b, c)), x[5]), 7);
    c = rol(add(add(c, F(d, a, b)), x[6]), 11);
    b = rol(add(add(b, F(c, d, a)), x[7]), 19);
    a = rol(add(add(a, F(b, c, d)), x[8]), 3);
    d = rol(add(add(d, F(a, b, c)), x[9]), 7);
    c = rol(add(add(c, F(d, a, b)), x[10]), 11);
    b = rol(add(add(b, F(c, d, a)), x[11]), 19);
    a = rol(add(add(a, F(b, c, d)), x[12]), 3);
    d = rol(add(add(d, F(a, b, c)), x[13]), 7);
    c = rol(add(add(c, F(d, a, b)), x[14]), 11);
    b = rol(add(add(b, F(c, d, a)), x[15]), 19);
    const C2 = 0x5a827999;
    a = rol(add(add(add(a, G(b, c, d)), x[0]), C2), 3);
    d = rol(add(add(add(d, G(a, b, c)), x[4]), C2), 5);
    c = rol(add(add(add(c, G(d, a, b)), x[8]), C2), 9);
    b = rol(add(add(add(b, G(c, d, a)), x[12]), C2), 13);
    a = rol(add(add(add(a, G(b, c, d)), x[1]), C2), 3);
    d = rol(add(add(add(d, G(a, b, c)), x[5]), C2), 5);
    c = rol(add(add(add(c, G(d, a, b)), x[9]), C2), 9);
    b = rol(add(add(add(b, G(c, d, a)), x[13]), C2), 13);
    a = rol(add(add(add(a, G(b, c, d)), x[2]), C2), 3);
    d = rol(add(add(add(d, G(a, b, c)), x[6]), C2), 5);
    c = rol(add(add(add(c, G(d, a, b)), x[10]), C2), 9);
    b = rol(add(add(add(b, G(c, d, a)), x[14]), C2), 13);
    a = rol(add(add(add(a, G(b, c, d)), x[3]), C2), 3);
    d = rol(add(add(add(d, G(a, b, c)), x[7]), C2), 5);
    c = rol(add(add(add(c, G(d, a, b)), x[11]), C2), 9);
    b = rol(add(add(add(b, G(c, d, a)), x[15]), C2), 13);
    const C3 = 0x6ed9eba1;
    a = rol(add(add(add(a, H(b, c, d)), x[0]), C3), 3);
    d = rol(add(add(add(d, H(a, b, c)), x[8]), C3), 9);
    c = rol(add(add(add(c, H(d, a, b)), x[4]), C3), 11);
    b = rol(add(add(add(b, H(c, d, a)), x[12]), C3), 15);
    a = rol(add(add(add(a, H(b, c, d)), x[2]), C3), 3);
    d = rol(add(add(add(d, H(a, b, c)), x[10]), C3), 9);
    c = rol(add(add(add(c, H(d, a, b)), x[6]), C3), 11);
    b = rol(add(add(add(b, H(c, d, a)), x[14]), C3), 15);
    a = rol(add(add(add(a, H(b, c, d)), x[1]), C3), 3);
    d = rol(add(add(add(d, H(a, b, c)), x[9]), C3), 9);
    c = rol(add(add(add(c, H(d, a, b)), x[5]), C3), 11);
    b = rol(add(add(add(b, H(c, d, a)), x[13]), C3), 15);
    a = rol(add(add(add(a, H(b, c, d)), x[3]), C3), 3);
    d = rol(add(add(add(d, H(a, b, c)), x[11]), C3), 9);
    c = rol(add(add(add(c, H(d, a, b)), x[7]), C3), 11);
    b = rol(add(add(add(b, H(c, d, a)), x[15]), C3), 15);
    a = add(a, sa);
    b = add(b, sb);
    c = add(c, sc);
    d = add(d, sd);
  }
  const out = new Uint8Array(16);
  const ov = new DataView(out.buffer);
  ov.setUint32(0, a, true);
  ov.setUint32(4, b, true);
  ov.setUint32(8, c, true);
  ov.setUint32(12, d, true);
  return out;
}

/** MD5 over arbitrary bytes — used as the inner hash for HMAC-MD5 (NTLMv2). */
export function md5Bytes(input: Uint8Array): Uint8Array {
  const str = Array.from(input, (b) => String.fromCharCode(b)).join('');
  const hex = md5(str);
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** HMAC-MD5 (RFC 2104) — used by NTLMv2 hash chain. */
export function hmacMd5(key: Uint8Array, data: Uint8Array): Uint8Array {
  const B = 64;
  const k = key.length > B ? md5Bytes(key) : key;
  const kPad = new Uint8Array(B);
  kPad.set(k);
  const ipad = kPad.map((b) => b ^ 0x36);
  const opad = kPad.map((b) => b ^ 0x5c);
  const inner = new Uint8Array(B + data.length);
  inner.set(ipad);
  inner.set(data, B);
  const outer = new Uint8Array(B + 16);
  outer.set(opad);
  outer.set(md5Bytes(inner), B);
  return md5Bytes(outer);
}
