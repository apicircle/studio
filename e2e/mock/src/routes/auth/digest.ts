// HTTP Digest auth (RFC 7616). Two-shot flow:
//   1. Client GETs /auth/digest with no Authorization → 401 + WWW-Authenticate: Digest
//   2. Client retries with Authorization: Digest <response>
//   3. Server recomputes the expected response from known credentials
//      and compares — 200 if match, 401 if not.
//
// Known creds: user=e2e-digest-user, pass=e2e-digest-pass, realm=apicircle-e2e.
// We use a static nonce per server lifetime so tests are deterministic
// (real Digest servers rotate nonces; we don't need that here).

import { Hono } from 'hono';
import { createHash } from 'node:crypto';

export const DIGEST_VALID = {
  user: 'e2e-digest-user',
  pass: 'e2e-digest-pass',
  realm: 'apicircle-e2e',
};

const NONCE = 'e2e-static-nonce-do-not-rotate';
const QOP = 'auth';

function md5(input: string): string {
  return createHash('md5').update(input, 'utf8').digest('hex');
}

function parseDigestAuthorization(header: string): Record<string, string> | null {
  const match = /^Digest\s+(.+)$/i.exec(header);
  if (!match) return null;
  const out: Record<string, string> = {};
  // Parse comma-separated `key="value"` or `key=value` pairs. Quoted
  // values may contain commas; track quoting state to not split inside.
  const body = match[1];
  let i = 0;
  while (i < body.length) {
    // Skip leading whitespace + commas
    while (i < body.length && (body[i] === ' ' || body[i] === ',')) i++;
    // Read key
    let keyEnd = i;
    while (keyEnd < body.length && body[keyEnd] !== '=') keyEnd++;
    const key = body.slice(i, keyEnd).trim();
    if (!key) break;
    i = keyEnd + 1;
    // Read value (quoted or unquoted)
    let value = '';
    if (body[i] === '"') {
      i++;
      const valStart = i;
      while (i < body.length && body[i] !== '"') i++;
      value = body.slice(valStart, i);
      i++; // closing quote
    } else {
      const valStart = i;
      while (i < body.length && body[i] !== ',') i++;
      value = body.slice(valStart, i).trim();
    }
    out[key] = value;
  }
  return out;
}

function challengeResponse(): Response {
  const challenge = `Digest realm="${DIGEST_VALID.realm}", qop="${QOP}", nonce="${NONCE}", algorithm=MD5`;
  return new Response(JSON.stringify({ error: 'unauthorized' }), {
    status: 401,
    headers: {
      'Content-Type': 'application/json',
      'WWW-Authenticate': challenge,
    },
  });
}

export function buildDigestAuthRoutes(): Hono {
  const app = new Hono();

  app.all('/auth/digest', (c) => {
    const auth = c.req.header('authorization');
    if (!auth) return challengeResponse();
    const fields = parseDigestAuthorization(auth);
    if (!fields) return challengeResponse();
    if (
      !fields.username ||
      !fields.realm ||
      !fields.nonce ||
      !fields.uri ||
      !fields.response ||
      !fields.qop
    ) {
      return challengeResponse();
    }
    if (fields.username !== DIGEST_VALID.user) return challengeResponse();
    if (fields.realm !== DIGEST_VALID.realm) return challengeResponse();
    if (fields.nonce !== NONCE) return challengeResponse();

    // Recompute the expected response. Per RFC 7616:
    //   HA1 = MD5(username:realm:password)
    //   HA2 = MD5(method:uri)
    //   response = MD5(HA1:nonce:nc:cnonce:qop:HA2)
    const ha1 = md5(`${DIGEST_VALID.user}:${DIGEST_VALID.realm}:${DIGEST_VALID.pass}`);
    const ha2 = md5(`${c.req.method}:${fields.uri}`);
    const expected = md5(
      `${ha1}:${fields.nonce}:${fields.nc ?? ''}:${fields.cnonce ?? ''}:${fields.qop}:${ha2}`,
    );
    if (expected !== fields.response) return challengeResponse();

    return c.json({ authenticated: true, user: fields.username });
  });

  return app;
}
