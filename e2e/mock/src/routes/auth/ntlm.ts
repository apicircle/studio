// NTLM auth — three-way handshake (Type-1 from client → Type-2 challenge
// from us → Type-3 authenticate from client).
//
// Spec compliance: structural checks only. We verify the client's
// Type-1 / Type-3 messages parse into well-formed structures (correct
// signature bytes, supported message types, fields present). We do NOT
// verify the NTLMv2 hash against credentials — that requires the server
// to know the user's plaintext password and ALSO compute the same
// NTOWFv2(password, user, domain), which would just mirror the client
// logic. The sister test in `packages/core/src/auth/ntlm.test.ts`
// already validates the NTLMv2 math against RFC vectors. Here we only
// need to prove the editor SENT the right message structure to the wire.
//
// State: the 8-byte server challenge issued in Type-2 is stashed under
// a synthetic session id so successive POSTs from the same Playwright
// browser context resolve to the same challenge. Tests use a single
// /auth/ntlm hit to verify Type-1; a follow-up POST verifies Type-3.

import { Hono } from 'hono';
import { randomBytes } from 'node:crypto';

const SIGNATURE = 'NTLMSSP\0';

function decodeBase64(str: string): Uint8Array {
  return new Uint8Array(Buffer.from(str, 'base64'));
}

function checkSignature(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== SIGNATURE.charCodeAt(i)) return false;
  }
  return true;
}

function readMessageType(bytes: Uint8Array): number {
  if (bytes.length < 12) return 0;
  return bytes[8] | (bytes[9] << 8) | (bytes[10] << 16) | (bytes[11] << 24);
}

function buildType2(challenge: Uint8Array): string {
  // Minimal Type-2 message:
  //   - 8 bytes signature "NTLMSSP\0"
  //   - 4 bytes message type (0x02)
  //   - 8 bytes target name security buffer (len=0, maxlen=0, offset=0)
  //   - 4 bytes flags (0)
  //   - 8 bytes server challenge
  //   - 8 bytes reserved (0)
  //   - 8 bytes target info security buffer (len=0, maxlen=0, offset=0)
  const buf = new Uint8Array(48);
  for (let i = 0; i < 8; i++) buf[i] = SIGNATURE.charCodeAt(i);
  buf[8] = 0x02;
  // Target name buffer (len, maxlen, offset) — all zero.
  // Flags at offset 20-23 — leave zero (negotiated by client).
  // Server challenge at offset 24-31.
  for (let i = 0; i < 8; i++) buf[24 + i] = challenge[i];
  return Buffer.from(buf).toString('base64');
}

export function buildNtlmAuthRoutes(): Hono {
  const app = new Hono();

  // Per-server challenge — regenerated each time the server starts.
  // Tests don't need cross-restart determinism; they capture and assert
  // on what the server issued in the same run.
  const challenge = randomBytes(8);

  app.all('/auth/ntlm', (c) => {
    const authHeader = c.req.header('authorization') ?? '';
    const match = /^NTLM\s+(.+)$/i.exec(authHeader);
    if (!match) {
      return new Response(JSON.stringify({ error: 'ntlm_required' }), {
        status: 401,
        headers: {
          'Content-Type': 'application/json',
          'WWW-Authenticate': 'NTLM',
        },
      });
    }

    let bytes: Uint8Array;
    try {
      bytes = decodeBase64(match[1]);
    } catch {
      return c.json({ error: 'invalid_ntlm_base64' }, { status: 400 });
    }

    if (!checkSignature(bytes)) {
      return c.json({ error: 'ntlm_signature_mismatch' }, { status: 400 });
    }

    const messageType = readMessageType(bytes);
    if (messageType === 1) {
      // Type-1 negotiate received. Issue Type-2 challenge.
      const type2 = buildType2(new Uint8Array(challenge));
      return new Response(JSON.stringify({ stage: 'challenge_issued' }), {
        status: 401,
        headers: {
          'Content-Type': 'application/json',
          'WWW-Authenticate': `NTLM ${type2}`,
        },
      });
    }
    if (messageType === 3) {
      // Type-3 authenticate. Structural check passed — the editor sent
      // a properly-framed Type-3. Treat as authenticated.
      return c.json({ authenticated: true, type: 'ntlm-type3', bytes: bytes.length });
    }
    return c.json({ error: 'unsupported_ntlm_message_type', type: messageType }, { status: 400 });
  });

  return app;
}
