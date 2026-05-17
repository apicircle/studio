// AWS Signature Version 4 verification. Recomputes the signing string
// from the request and compares against the Authorization header.
//
// Known creds:
//   accessKey: AKIDEXAMPLE
//   secret:    wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY
//   region:    us-east-1
//   service:   service
// (matches the AWS CAVS test vectors so signing math is well-defined).

import { Hono } from 'hono';
import { createHash, createHmac } from 'node:crypto';

export const SIGV4_VALID = {
  accessKey: 'AKIDEXAMPLE',
  secret: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
  region: 'us-east-1',
  service: 'service',
};

function sha256Hex(input: string | Uint8Array): string {
  return createHash('sha256').update(input).digest('hex');
}

function hmacBytes(key: Uint8Array | string, data: string): Uint8Array {
  return new Uint8Array(createHmac('sha256', key).update(data).digest());
}

function deriveSigningKey(
  secret: string,
  dateStamp: string,
  region: string,
  service: string,
): Uint8Array {
  const kDate = hmacBytes(`AWS4${secret}`, dateStamp);
  const kRegion = hmacBytes(kDate, region);
  const kService = hmacBytes(kRegion, service);
  return hmacBytes(kService, 'aws4_request');
}

interface ParsedAuth {
  accessKey: string;
  dateStamp: string;
  region: string;
  service: string;
  signedHeaders: string[];
  signature: string;
}

function parseSigV4Authorization(header: string): ParsedAuth | null {
  const match = /^AWS4-HMAC-SHA256\s+(.+)$/i.exec(header);
  if (!match) return null;
  const out: Record<string, string> = {};
  for (const part of match[1].split(/,\s*/)) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  if (!out.Credential || !out.SignedHeaders || !out.Signature) return null;
  const credParts = out.Credential.split('/');
  if (credParts.length !== 5) return null;
  return {
    accessKey: credParts[0],
    dateStamp: credParts[1],
    region: credParts[2],
    service: credParts[3],
    signedHeaders: out.SignedHeaders.split(';').map((s) => s.toLowerCase()),
    signature: out.Signature,
  };
}

function buildCanonicalRequest(args: {
  method: string;
  path: string;
  query: string;
  signedHeaders: string[];
  headers: Record<string, string>;
  bodyHash: string;
}): string {
  const canonicalHeaders = args.signedHeaders
    .map((h) => `${h}:${(args.headers[h] ?? '').trim()}`)
    .join('\n');
  return [
    args.method.toUpperCase(),
    args.path,
    args.query,
    `${canonicalHeaders}\n`,
    args.signedHeaders.join(';'),
    args.bodyHash,
  ].join('\n');
}

export function buildAwsSigV4AuthRoutes(): Hono {
  const app = new Hono();

  app.all('/auth/aws', async (c) => {
    const auth = c.req.header('authorization');
    if (!auth) return c.json({ error: 'sigv4_required' }, { status: 401 });
    const parsed = parseSigV4Authorization(auth);
    if (!parsed) return c.json({ error: 'malformed_sigv4_authorization' }, { status: 401 });
    if (parsed.accessKey !== SIGV4_VALID.accessKey) {
      return c.json({ error: 'unknown_access_key', got: parsed.accessKey }, { status: 401 });
    }

    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(c.req.header())) {
      headers[k.toLowerCase()] = v;
    }
    const amzDate = headers['x-amz-date'];
    if (!amzDate) return c.json({ error: 'missing_x_amz_date' }, { status: 401 });

    const url = new URL(c.req.url);
    // Canonical query string: sorted by key, percent-encoded.
    const params: Array<[string, string]> = [];
    for (const [k, v] of url.searchParams.entries()) params.push([k, v]);
    params.sort(([a], [b]) => a.localeCompare(b));
    const canonicalQuery = params
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');

    const bodyBuf = await c.req.arrayBuffer();
    const bodyHash = sha256Hex(new Uint8Array(bodyBuf));

    const canonicalRequest = buildCanonicalRequest({
      method: c.req.method,
      path: url.pathname,
      query: canonicalQuery,
      signedHeaders: parsed.signedHeaders,
      headers,
      bodyHash,
    });

    const credentialScope = `${parsed.dateStamp}/${parsed.region}/${parsed.service}/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      sha256Hex(canonicalRequest),
    ].join('\n');

    const signingKey = deriveSigningKey(
      SIGV4_VALID.secret,
      parsed.dateStamp,
      parsed.region,
      parsed.service,
    );
    const expected = createHmac('sha256', signingKey).update(stringToSign).digest('hex');

    if (expected !== parsed.signature) {
      return c.json(
        {
          error: 'sigv4_signature_mismatch',
          expected,
          got: parsed.signature,
        },
        { status: 401 },
      );
    }
    return c.json({ authenticated: true, accessKey: parsed.accessKey, region: parsed.region });
  });

  return app;
}
