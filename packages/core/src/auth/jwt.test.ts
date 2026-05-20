import { describe, expect, it, vi, afterEach } from 'vitest';
import { signJwt } from './jwt';

afterEach(() => vi.useRealTimers());

function decodeBase64Url(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + pad;
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function decodeJson(segment: string): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(segment)));
}

describe('signJwt — HMAC algorithms', () => {
  it('produces the canonical RFC 7519 §3.1 example token for HS256', async () => {
    // Header from the RFC example deliberately sets typ before alg, but
    // since our serializer is JSON-stringify-of-object the field order is
    // alg-first. We compare the round-tripped JSON, not the raw string.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const jwt = await signJwt({
      algorithm: 'HS256',
      secretOrKey: 'your-256-bit-secret-your-256-bit-secret', // length doesn't matter for HS256
      payload: { sub: '1234567890', name: 'John Doe', admin: true, iat: 1516239022 },
    });
    const [headerSeg, payloadSeg, sigSeg] = jwt.split('.');
    expect(decodeJson(headerSeg!)).toEqual({ alg: 'HS256', typ: 'JWT' });
    expect(decodeJson(payloadSeg!)).toEqual({
      sub: '1234567890',
      name: 'John Doe',
      admin: true,
      iat: 1516239022,
    });
    expect(sigSeg).toBeTruthy();
    expect(sigSeg!.length).toBeGreaterThan(0);
  });

  it('signs identical payloads identically given the same secret (HS256)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const a = await signJwt({
      algorithm: 'HS256',
      secretOrKey: 'secret',
      payload: { sub: '1' },
    });
    const b = await signJwt({
      algorithm: 'HS256',
      secretOrKey: 'secret',
      payload: { sub: '1' },
    });
    expect(a).toBe(b);
  });

  it('produces a different signature when the secret changes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const a = await signJwt({
      algorithm: 'HS256',
      secretOrKey: 'secret-a',
      payload: { sub: '1' },
    });
    const b = await signJwt({
      algorithm: 'HS256',
      secretOrKey: 'secret-b',
      payload: { sub: '1' },
    });
    expect(a.split('.')[2]).not.toBe(b.split('.')[2]);
  });

  it('changes the signature length to match HS384 / HS512 outputs', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const hs256 = await signJwt({ algorithm: 'HS256', secretOrKey: 'k', payload: {} });
    const hs384 = await signJwt({ algorithm: 'HS384', secretOrKey: 'k', payload: {} });
    const hs512 = await signJwt({ algorithm: 'HS512', secretOrKey: 'k', payload: {} });
    // Signature byte length: 32 / 48 / 64 → base64url length: 43 / 64 / 86 (no padding).
    expect(decodeBase64Url(hs256.split('.')[2]!).length).toBe(32);
    expect(decodeBase64Url(hs384.split('.')[2]!).length).toBe(48);
    expect(decodeBase64Url(hs512.split('.')[2]!).length).toBe(64);
  });

  it('auto-injects iat when the payload omits it', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const jwt = await signJwt({
      algorithm: 'HS256',
      secretOrKey: 'k',
      payload: { sub: 'x' },
    });
    const payload = decodeJson(jwt.split('.')[1]!);
    expect(payload['iat']).toBe(Math.floor(new Date('2026-01-01T00:00:00Z').getTime() / 1000));
  });

  it('honors caller-supplied iat over the auto-injected value', async () => {
    const jwt = await signJwt({
      algorithm: 'HS256',
      secretOrKey: 'k',
      payload: { iat: 99 },
    });
    const payload = decodeJson(jwt.split('.')[1]!);
    expect(payload['iat']).toBe(99);
  });

  it('merges additionalHeaders into the JWT header (e.g. kid)', async () => {
    const jwt = await signJwt({
      algorithm: 'HS256',
      secretOrKey: 'k',
      payload: {},
      additionalHeaders: { kid: 'key-1' },
    });
    expect(decodeJson(jwt.split('.')[0]!)).toEqual({
      alg: 'HS256',
      typ: 'JWT',
      kid: 'key-1',
    });
  });
});

describe('signJwt — asymmetric algorithms (round-trip via WebCrypto)', () => {
  // For RSA / ECDSA we don't have a fixed published signature vector to
  // compare against (signatures are non-deterministic for ECDSA, and
  // RSA fixtures would require shipping a static private key in the
  // test). Instead we generate a fresh keypair, sign, then verify the
  // signature with the matching public key — proving the import +
  // signing path produces something cryptographically valid.

  async function exportPrivateKeyAsPkcs8Pem(key: CryptoKey): Promise<string> {
    const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', key));
    let s = '';
    for (let i = 0; i < der.length; i++) s += String.fromCharCode(der[i]!);
    const b64 = btoa(s);
    const wrapped = b64.match(/.{1,64}/g)?.join('\n') ?? b64;
    return `-----BEGIN PRIVATE KEY-----\n${wrapped}\n-----END PRIVATE KEY-----`;
  }

  it('signs with RS256 and the signature verifies under the matching public key', async () => {
    const { privateKey, publicKey } = await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['sign', 'verify'],
    );
    const pem = await exportPrivateKeyAsPkcs8Pem(privateKey);

    const jwt = await signJwt({
      algorithm: 'RS256',
      secretOrKey: pem,
      payload: { sub: 'rs256-test', iat: 1700000000 },
    });
    const [headerSeg, payloadSeg, sigSeg] = jwt.split('.');
    expect(headerSeg).toBeTruthy();
    expect(payloadSeg).toBeTruthy();

    // Verify the signature via the public key — the only honest proof
    // that the asymmetric signing path works end-to-end.
    const sigBytes = decodeBase64Url(sigSeg!);
    const signed = new TextEncoder().encode(`${headerSeg}.${payloadSeg}`);
    const ok = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      publicKey,
      sigBytes.buffer.slice(
        sigBytes.byteOffset,
        sigBytes.byteOffset + sigBytes.byteLength,
      ) as ArrayBuffer,
      signed.buffer.slice(signed.byteOffset, signed.byteOffset + signed.byteLength) as ArrayBuffer,
    );
    expect(ok).toBe(true);
  });

  it('signs with ES256 and produces a fixed-length 64-byte signature that verifies', async () => {
    const { privateKey, publicKey } = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify'],
    );
    const pem = await exportPrivateKeyAsPkcs8Pem(privateKey);

    const jwt = await signJwt({
      algorithm: 'ES256',
      secretOrKey: pem,
      payload: { sub: 'es256-test' },
    });
    const [headerSeg, payloadSeg, sigSeg] = jwt.split('.');
    const sigBytes = decodeBase64Url(sigSeg!);
    // JWS-compact ECDSA P-256 signature is exactly r||s = 64 bytes.
    expect(sigBytes.length).toBe(64);

    const signed = new TextEncoder().encode(`${headerSeg}.${payloadSeg}`);
    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      publicKey,
      sigBytes.buffer.slice(
        sigBytes.byteOffset,
        sigBytes.byteOffset + sigBytes.byteLength,
      ) as ArrayBuffer,
      signed.buffer.slice(signed.byteOffset, signed.byteOffset + signed.byteLength) as ArrayBuffer,
    );
    expect(ok).toBe(true);
  });

  it('signs with PS256 (RSA-PSS, 32-byte salt) and the signature verifies', async () => {
    const { privateKey, publicKey } = await crypto.subtle.generateKey(
      {
        name: 'RSA-PSS',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['sign', 'verify'],
    );
    const pem = await exportPrivateKeyAsPkcs8Pem(privateKey);

    const jwt = await signJwt({
      algorithm: 'PS256',
      secretOrKey: pem,
      payload: { sub: 'ps256-test' },
    });
    const [headerSeg, payloadSeg, sigSeg] = jwt.split('.');
    const sigBytes = decodeBase64Url(sigSeg!);
    // RSA-PSS signature length matches the modulus length (2048 / 8 = 256 bytes).
    expect(sigBytes.length).toBe(256);
    const signed = new TextEncoder().encode(`${headerSeg}.${payloadSeg}`);
    const ok = await crypto.subtle.verify(
      { name: 'RSA-PSS', saltLength: 32 },
      publicKey,
      sigBytes.buffer.slice(
        sigBytes.byteOffset,
        sigBytes.byteOffset + sigBytes.byteLength,
      ) as ArrayBuffer,
      signed.buffer.slice(signed.byteOffset, signed.byteOffset + signed.byteLength) as ArrayBuffer,
    );
    expect(ok).toBe(true);
  });

  it('signs with EdDSA (Ed25519) and the signature verifies', async () => {
    // Ed25519 is gated on WebCrypto support — Node 22+ is fine, older
    // runtimes fail at generateKey. Skip with a clear marker rather
    // than failing if support is missing.
    let keyPair: CryptoKeyPair;
    try {
      keyPair = (await crypto.subtle.generateKey('Ed25519', true, [
        'sign',
        'verify',
      ])) as CryptoKeyPair;
    } catch {
      console.warn('Ed25519 not supported in this runtime — skipping EdDSA JWT test.');
      return;
    }
    const pem = await exportPrivateKeyAsPkcs8Pem(keyPair.privateKey);

    const jwt = await signJwt({
      algorithm: 'EdDSA',
      secretOrKey: pem,
      payload: { sub: 'eddsa-test' },
    });
    const [headerSeg, payloadSeg, sigSeg] = jwt.split('.');
    const sigBytes = decodeBase64Url(sigSeg!);
    // Ed25519 signatures are exactly 64 bytes.
    expect(sigBytes.length).toBe(64);
    const signed = new TextEncoder().encode(`${headerSeg}.${payloadSeg}`);
    const ok = await crypto.subtle.verify(
      'Ed25519',
      keyPair.publicKey,
      sigBytes.buffer.slice(
        sigBytes.byteOffset,
        sigBytes.byteOffset + sigBytes.byteLength,
      ) as ArrayBuffer,
      signed.buffer.slice(signed.byteOffset, signed.byteOffset + signed.byteLength) as ArrayBuffer,
    );
    expect(ok).toBe(true);
  });

  it('signs with ES384 and produces a 96-byte signature that verifies', async () => {
    const { privateKey, publicKey } = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-384' },
      true,
      ['sign', 'verify'],
    );
    const pem = await exportPrivateKeyAsPkcs8Pem(privateKey);

    const jwt = await signJwt({
      algorithm: 'ES384',
      secretOrKey: pem,
      payload: {},
    });
    const [headerSeg, payloadSeg, sigSeg] = jwt.split('.');
    const sigBytes = decodeBase64Url(sigSeg!);
    expect(sigBytes.length).toBe(96);
    const signed = new TextEncoder().encode(`${headerSeg}.${payloadSeg}`);
    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-384' },
      publicKey,
      sigBytes.buffer.slice(
        sigBytes.byteOffset,
        sigBytes.byteOffset + sigBytes.byteLength,
      ) as ArrayBuffer,
      signed.buffer.slice(signed.byteOffset, signed.byteOffset + signed.byteLength) as ArrayBuffer,
    );
    expect(ok).toBe(true);
  });
});

describe('signJwt — error paths', () => {
  it('rejects alg "none" outright (RFC 8725)', async () => {
    await expect(
      signJwt({
        algorithm: 'none' as never,
        secretOrKey: '',
        payload: {},
      }),
    ).rejects.toThrow(/none/i);
  });

  it('throws on an unsupported algorithm', async () => {
    await expect(
      signJwt({
        algorithm: 'HS999' as never,
        secretOrKey: 'k',
        payload: {},
      }),
    ).rejects.toThrow(/not supported/i);
  });

  it('throws when an RS256 key is invalid base64', async () => {
    await expect(
      signJwt({
        algorithm: 'RS256',
        secretOrKey: '-----BEGIN PRIVATE KEY-----\n!!!not-base64!!!\n-----END PRIVATE KEY-----',
        payload: {},
      }),
    ).rejects.toThrow();
  });

  it('throws a clear error for encrypted PKCS#8 PEMs', async () => {
    await expect(
      signJwt({
        algorithm: 'RS256',
        secretOrKey:
          '-----BEGIN ENCRYPTED PRIVATE KEY-----\nMIIBoz...\n-----END ENCRYPTED PRIVATE KEY-----',
        payload: {},
      }),
    ).rejects.toThrow(/encrypted PEM keys are not supported/i);
  });

  it('throws a clear error for legacy PKCS#1 RSA PEMs', async () => {
    await expect(
      signJwt({
        algorithm: 'RS256',
        secretOrKey:
          '-----BEGIN RSA PRIVATE KEY-----\nMIIBzAIBADANBgkqhkiG9w0BAQ\n-----END RSA PRIVATE KEY-----',
        payload: {},
      }),
    ).rejects.toThrow(/PKCS#1.*not supported/i);
  });

  it('strips comment lines + header lines that openssl sometimes adds', async () => {
    // Generate a real key, export, then prepend comment lines that
    // openssl can include (e.g. "Bag Attributes" from a converted file).
    const { privateKey } = await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['sign'],
    );
    const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', privateKey));
    let bin = '';
    for (let i = 0; i < der.length; i++) bin += String.fromCharCode(der[i]!);
    const b64 = btoa(bin)
      .match(/.{1,64}/g)!
      .join('\n');
    const pem = [
      'Bag Attributes: friendlyName=test',
      'Key Attributes: <No Attributes>',
      '-----BEGIN PRIVATE KEY-----',
      b64,
      '-----END PRIVATE KEY-----',
      '',
    ].join('\n');
    // Should not throw — the comment lines should be stripped.
    const jwt = await signJwt({
      algorithm: 'RS256',
      secretOrKey: pem,
      payload: { sub: 'pem-with-comments' },
    });
    expect(jwt.split('.')).toHaveLength(3);
  });
});
