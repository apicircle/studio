// Hawk auth (https://github.com/hapijs/hawk). Server verifies the MAC
// against the known shared key. Known credentials:
//   id: e2e-hawk-id
//   key: e2e-hawk-key-secret
//   algorithm: sha256

import { Hono } from 'hono';
import { createHmac } from 'node:crypto';

export const HAWK_VALID = {
  id: 'e2e-hawk-id',
  key: 'e2e-hawk-key-secret',
  algorithm: 'sha256' as const,
};

function parseHawkHeader(header: string): Record<string, string> | null {
  const match = /^Hawk\s+(.+)$/i.exec(header);
  if (!match) return null;
  const out: Record<string, string> = {};
  // Hawk pairs are key="value" comma-separated.
  for (const part of match[1].split(/,\s*/)) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    let v = part.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    out[k] = v;
  }
  return out;
}

function computeHawkMac(args: {
  ts: string;
  nonce: string;
  method: string;
  resource: string;
  host: string;
  port: string;
  hash?: string;
  ext?: string;
  key: string;
}): string {
  // Per Hawk spec: normalized request string = header type + ts + nonce + method
  // + resource + host + port + payload-hash + ext + \n separators.
  const lines = [
    'hawk.1.header',
    args.ts,
    args.nonce,
    args.method.toUpperCase(),
    args.resource,
    args.host.toLowerCase(),
    args.port,
    args.hash ?? '',
    args.ext ?? '',
    '',
  ];
  const normalized = lines.join('\n');
  return createHmac('sha256', args.key).update(normalized).digest('base64');
}

export function buildHawkAuthRoutes(): Hono {
  const app = new Hono();

  app.all('/auth/hawk', (c) => {
    const auth = c.req.header('authorization');
    if (!auth) {
      return c.json({ error: 'hawk_required' }, { status: 401 });
    }
    const fields = parseHawkHeader(auth);
    if (!fields || !fields.id || !fields.ts || !fields.nonce || !fields.mac) {
      return c.json({ error: 'malformed_hawk_header' }, { status: 401 });
    }
    if (fields.id !== HAWK_VALID.id) {
      return c.json({ error: 'unknown_hawk_id', got: fields.id }, { status: 401 });
    }

    const url = new URL(c.req.url);
    const expected = computeHawkMac({
      ts: fields.ts,
      nonce: fields.nonce,
      method: c.req.method,
      resource: url.pathname + url.search,
      host: url.hostname,
      port: url.port || (url.protocol === 'https:' ? '443' : '80'),
      hash: fields.hash,
      ext: fields.ext,
      key: HAWK_VALID.key,
    });

    if (expected !== fields.mac) {
      return c.json({ error: 'mac_mismatch', expected, got: fields.mac }, { status: 401 });
    }
    return c.json({ authenticated: true, id: fields.id });
  });

  return app;
}
