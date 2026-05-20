// JWT Bearer auth. Accepts a Bearer JWT signed with HS256 + a shared
// secret, OR RS256 with a known public key.
//
// Static creds:
//   HS256 secret: e2e-jwt-shared-secret
//   RS256 key:   2048-bit RSA — see RS256_PUBLIC_KEY_PEM below.

import { Hono } from 'hono';
import { createHmac, createPublicKey, createVerify } from 'node:crypto';

export const HS256_SECRET = 'e2e-jwt-shared-secret';

// Self-generated 2048-bit RSA test key. Public-only — the matching
// private key lives in the corresponding test fixture. NOT for any real use.
export const RS256_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA1BczhyKnhMKHUmjKjDmS
2N2lq7P+jBO4y5x4Kqg6Nw7dKQFNZ8JFRoJZm5lJ5sJXKKjLdK2k0/ZQ9sQvBZZX
i1qEoZmjYxK0OqZJkj9Xr8mYqPDLLOCx5qBMHOVqOYQ2OUyPDQU5qrJI3QIDAQAB
-----END PUBLIC KEY-----`;

function base64UrlDecode(input: string): Buffer {
  const pad = input.length % 4 === 0 ? '' : '='.repeat(4 - (input.length % 4));
  return Buffer.from(input.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function verifyHs256(
  token: string,
  secret: string,
): { ok: true; payload: unknown } | { ok: false; reason: string } {
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed_jwt' };
  const [headerB64, payloadB64, signatureB64] = parts;
  let header: { alg?: string; typ?: string };
  try {
    header = JSON.parse(base64UrlDecode(headerB64).toString('utf8')) as {
      alg?: string;
      typ?: string;
    };
  } catch {
    return { ok: false, reason: 'invalid_header_json' };
  }
  if (header.alg !== 'HS256') return { ok: false, reason: 'wrong_alg' };

  const expected = createHmac('sha256', secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  if (!timingSafeEqualHex(expected, signatureB64))
    return { ok: false, reason: 'signature_mismatch' };

  let payload: unknown;
  try {
    payload = JSON.parse(base64UrlDecode(payloadB64).toString('utf8'));
  } catch {
    return { ok: false, reason: 'invalid_payload_json' };
  }
  return { ok: true, payload };
}

function verifyRs256(
  token: string,
  publicKeyPem: string,
): { ok: true; payload: unknown } | { ok: false; reason: string } {
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed_jwt' };
  const [headerB64, payloadB64, signatureB64] = parts;
  let header: { alg?: string };
  try {
    header = JSON.parse(base64UrlDecode(headerB64).toString('utf8')) as { alg?: string };
  } catch {
    return { ok: false, reason: 'invalid_header_json' };
  }
  if (header.alg !== 'RS256') return { ok: false, reason: 'wrong_alg' };

  const verifier = createVerify('RSA-SHA256');
  verifier.update(`${headerB64}.${payloadB64}`);
  verifier.end();
  const sigBytes = base64UrlDecode(signatureB64);
  let publicKey;
  try {
    publicKey = createPublicKey(publicKeyPem);
  } catch {
    return { ok: false, reason: 'bad_public_key' };
  }
  if (!verifier.verify(publicKey, sigBytes)) return { ok: false, reason: 'signature_mismatch' };

  let payload: unknown;
  try {
    payload = JSON.parse(base64UrlDecode(payloadB64).toString('utf8'));
  } catch {
    return { ok: false, reason: 'invalid_payload_json' };
  }
  return { ok: true, payload };
}

export function buildJwtBearerAuthRoutes(): Hono {
  const app = new Hono();

  app.all('/auth/jwt', (c) => {
    const auth = c.req.header('authorization') ?? '';
    const match = /^Bearer\s+(\S+)$/i.exec(auth);
    if (!match) return c.json({ error: 'jwt_required' }, { status: 401 });
    const token = match[1];

    // Try HS256 first, then RS256.
    const hs = verifyHs256(token, HS256_SECRET);
    if (hs.ok) {
      return c.json({ authenticated: true, alg: 'HS256', payload: hs.payload });
    }
    const rs = verifyRs256(token, RS256_PUBLIC_KEY_PEM);
    if (rs.ok) {
      return c.json({ authenticated: true, alg: 'RS256', payload: rs.payload });
    }
    return c.json(
      { error: 'jwt_verification_failed', hs256: hs.reason, rs256: rs.reason },
      { status: 401 },
    );
  });

  return app;
}
