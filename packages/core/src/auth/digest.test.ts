import { describe, expect, it } from 'vitest';
import {
  buildDigestAuthHeader,
  parseDigestChallenge,
  selectStrongestDigestChallenge,
} from './digest';

describe('parseDigestChallenge', () => {
  it('parses the directives from a typical RFC 7616 challenge', () => {
    const out = parseDigestChallenge(
      'Digest realm="testrealm@host.com", qop="auth,auth-int", nonce="dcd98b71", opaque="5ccc06"',
    );
    expect(out.realm).toBe('testrealm@host.com');
    expect(out.qop).toBe('auth,auth-int');
    expect(out.nonce).toBe('dcd98b71');
    expect(out.opaque).toBe('5ccc06');
  });

  it('accepts a header without the leading "Digest " prefix', () => {
    const out = parseDigestChallenge('realm="r", nonce="n"');
    expect(out.realm).toBe('r');
    expect(out.nonce).toBe('n');
  });

  it('handles unquoted values and lowercases keys', () => {
    const out = parseDigestChallenge('Digest Realm=trim, Stale=true');
    expect(out.realm).toBe('trim');
    expect(out.stale).toBe('true');
  });

  it('preserves backslash escapes inside quoted strings', () => {
    const out = parseDigestChallenge('Digest realm="foo\\"bar"');
    expect(out.realm).toBe('foo"bar');
  });
});

describe('buildDigestAuthHeader — RFC 2617 §3.5 worked example', () => {
  // Canonical worked example, used here as the regression vector for MD5
  // since Digest with MD5 is still the long-tail interop reality.
  it('produces the expected MD5 response with qop=auth', async () => {
    const header = await buildDigestAuthHeader({
      method: 'GET',
      uri: '/dir/index.html',
      username: 'Mufasa',
      password: 'Circle Of Life',
      challenge: parseDigestChallenge(
        'Digest realm="testrealm@host.com", qop="auth", nonce="dcd98b7102dd2f0e8b11d0f600bfb0c093", opaque="5ccc069c403ebaf9f0171e9517f40e41", algorithm=MD5',
      ),
      cnonce: '0a4f113b',
      nc: '00000001',
    });
    expect(header).toContain('username="Mufasa"');
    expect(header).toContain('realm="testrealm@host.com"');
    expect(header).toContain('nonce="dcd98b7102dd2f0e8b11d0f600bfb0c093"');
    expect(header).toContain('uri="/dir/index.html"');
    expect(header).toContain('response="6629fae49393a05397450978507c4ef1"');
    expect(header).toContain('qop=auth');
    expect(header).toContain('nc=00000001');
    expect(header).toContain('cnonce="0a4f113b"');
    expect(header).toContain('opaque="5ccc069c403ebaf9f0171e9517f40e41"');
  });

  it('falls back to the legacy response form (no qop) when the server omits qop', async () => {
    // Pre-RFC 2617 form: response = MD5(HA1:nonce:HA2). No nc / cnonce / qop directives.
    const header = await buildDigestAuthHeader({
      method: 'GET',
      uri: '/dir/index.html',
      username: 'Mufasa',
      password: 'Circle Of Life',
      challenge: parseDigestChallenge(
        'Digest realm="testrealm@host.com", nonce="dcd98b7102dd2f0e8b11d0f600bfb0c093", algorithm=MD5',
      ),
    });
    expect(header).not.toContain('qop=');
    expect(header).not.toContain('nc=');
    // Legacy form: MD5(HA1:nonce:HA2). Snapshot the value once — RFC 2617
    // doesn't publish a worked example for the no-qop variant.
    expect(header).toContain('response="670fd8c2df070c60b045671b8b24ff02"');
  });

  it('supports SHA-256 algorithm', async () => {
    const header = await buildDigestAuthHeader({
      method: 'GET',
      uri: '/dir/index.html',
      username: 'Mufasa',
      password: 'Circle of Life',
      challenge: parseDigestChallenge(
        'Digest realm="http-auth@example.org", qop="auth", nonce="7ypf/xlj9XXwfDPEoM4URrv/xwf94BcCAzFZH4GiTo0v", opaque="FQhe/qaU925kfnzjCev0ciny7QMkPqMAFRtzCUYo5tdS", algorithm=SHA-256',
      ),
      cnonce: 'f2/wE4q74E6zIJEtWaHKaf5wv/H5QzzpXusqGemxURZJ',
      nc: '00000001',
    });
    expect(header).toContain('algorithm=SHA-256');
    // Expected response per RFC 7616 §3.9.1.
    expect(header).toContain(
      'response="753927fa0e85d155564e2e272a28d1802ca10daf4496794697cf8db5856cb6c1"',
    );
  });

  it('supports MD5-sess (re-hashes HA1 with nonces)', async () => {
    const header = await buildDigestAuthHeader({
      method: 'GET',
      uri: '/dir/index.html',
      username: 'Mufasa',
      password: 'Circle Of Life',
      challenge: parseDigestChallenge(
        'Digest realm="testrealm@host.com", qop="auth", nonce="dcd98b7102dd2f0e8b11d0f600bfb0c093", algorithm=MD5-sess',
      ),
      cnonce: '0a4f113b',
      nc: '00000001',
    });
    expect(header).toContain('algorithm=MD5-sess');
    // Different response than the plain-MD5 case because HA1 = MD5(MD5(...):nonce:cnonce).
    expect(header).not.toContain('response="6629fae49393a05397450978507c4ef1"');
  });

  it('hashes the entity body when qop=auth-int', async () => {
    const headerNoBody = await buildDigestAuthHeader({
      method: 'POST',
      uri: '/submit',
      username: 'u',
      password: 'p',
      challenge: parseDigestChallenge('Digest realm="r", qop="auth-int", nonce="n"'),
      cnonce: 'cn',
      nc: '00000001',
      entityBody: '',
    });
    const headerWithBody = await buildDigestAuthHeader({
      method: 'POST',
      uri: '/submit',
      username: 'u',
      password: 'p',
      challenge: parseDigestChallenge('Digest realm="r", qop="auth-int", nonce="n"'),
      cnonce: 'cn',
      nc: '00000001',
      entityBody: '{"hello":"world"}',
    });
    // Different bodies → different responses; both still use qop=auth-int.
    expect(headerNoBody).toContain('qop=auth-int');
    expect(headerWithBody).toContain('qop=auth-int');
    expect(extractResponse(headerNoBody)).not.toBe(extractResponse(headerWithBody));
  });

  it('supports SHA-512-256 (FIPS 180-4 SHA-512/256) per RFC 7616 §3.5.1', async () => {
    // RFC 7616 mandates the FIPS 180-4 SHA-512/256 variant — distinct
    // from a naive truncation of SHA-512 because it uses different IVs.
    // We verify the algorithm path runs by comparing against the SHA-256
    // and MD5 outputs for the same inputs — they must all differ, and
    // SHA-512-256 must produce a 64-char hex digest (matching SHA-256
    // length, NOT SHA-512's 128). The standalone vector test in
    // `_sha512_256.test.ts` anchors the IV constants against published
    // NIST CAVS values.
    const sha512_256 = await buildDigestAuthHeader({
      method: 'GET',
      uri: '/x',
      username: 'u',
      password: 'p',
      challenge: parseDigestChallenge(
        'Digest realm="r", qop="auth", nonce="n", algorithm=SHA-512-256',
      ),
      cnonce: 'cn',
    });
    const sha256 = await buildDigestAuthHeader({
      method: 'GET',
      uri: '/x',
      username: 'u',
      password: 'p',
      challenge: parseDigestChallenge('Digest realm="r", qop="auth", nonce="n", algorithm=SHA-256'),
      cnonce: 'cn',
    });
    expect(extractResponse(sha512_256)).toHaveLength(64);
    expect(extractResponse(sha512_256)).not.toBe(extractResponse(sha256));
    expect(sha512_256).toContain('algorithm=SHA-512-256');
  });

  it('hashes a Uint8Array entity body for qop=auth-int', async () => {
    const stringHeader = await buildDigestAuthHeader({
      method: 'POST',
      uri: '/upload',
      username: 'u',
      password: 'p',
      challenge: parseDigestChallenge('Digest realm="r", qop="auth-int", nonce="n"'),
      cnonce: 'cn',
      entityBody: 'hello',
    });
    const bytesHeader = await buildDigestAuthHeader({
      method: 'POST',
      uri: '/upload',
      username: 'u',
      password: 'p',
      challenge: parseDigestChallenge('Digest realm="r", qop="auth-int", nonce="n"'),
      cnonce: 'cn',
      entityBody: new TextEncoder().encode('hello'),
    });
    // String "hello" and bytes(0x68 0x65 0x6c 0x6c 0x6f) hash identically.
    expect(extractResponse(stringHeader)).toBe(extractResponse(bytesHeader));
  });

  it('hashes a Blob entity body for qop=auth-int', async () => {
    const stringHeader = await buildDigestAuthHeader({
      method: 'POST',
      uri: '/upload',
      username: 'u',
      password: 'p',
      challenge: parseDigestChallenge('Digest realm="r", qop="auth-int", nonce="n"'),
      cnonce: 'cn',
      entityBody: 'world',
    });
    const blobHeader = await buildDigestAuthHeader({
      method: 'POST',
      uri: '/upload',
      username: 'u',
      password: 'p',
      challenge: parseDigestChallenge('Digest realm="r", qop="auth-int", nonce="n"'),
      cnonce: 'cn',
      entityBody: new Blob(['world'], { type: 'text/plain' }),
    });
    expect(extractResponse(stringHeader)).toBe(extractResponse(blobHeader));
  });

  it('throws on an unrecognized algorithm', async () => {
    await expect(
      buildDigestAuthHeader({
        method: 'GET',
        uri: '/x',
        username: 'u',
        password: 'p',
        challenge: parseDigestChallenge('Digest realm="r", nonce="n", algorithm="rot13"'),
      }),
    ).rejects.toThrow(/not supported/i);
  });

  it('escapes backslashes and quotes in user-supplied fields', async () => {
    const header = await buildDigestAuthHeader({
      method: 'GET',
      uri: '/x',
      username: 'a"b\\c',
      password: 'p',
      challenge: parseDigestChallenge('Digest realm="r", nonce="n"'),
      cnonce: 'cn',
    });
    expect(header).toContain('username="a\\"b\\\\c"');
  });
});

function extractResponse(header: string): string {
  return /response="([^"]+)"/.exec(header)?.[1] ?? '';
}

describe('selectStrongestDigestChallenge — algorithm preference', () => {
  it('returns the single challenge when only one is offered', () => {
    const c = selectStrongestDigestChallenge('Digest realm="x", nonce="n", algorithm=SHA-256');
    expect(c?.algorithm).toBe('SHA-256');
  });

  it('returns null when no Digest challenge contains realm/nonce', () => {
    expect(selectStrongestDigestChallenge('')).toBeNull();
    expect(selectStrongestDigestChallenge('Digest stale=true')).toBeNull();
  });

  it('prefers SHA-256 over MD5 when both are offered', () => {
    // Servers stack multiple WWW-Authenticate headers; fetch comma-joins them.
    const stacked =
      'Digest realm="r", nonce="n-md5", algorithm=MD5, ' +
      'Digest realm="r", nonce="n-sha256", algorithm=SHA-256';
    const c = selectStrongestDigestChallenge(stacked);
    expect(c?.algorithm).toBe('SHA-256');
    expect(c?.nonce).toBe('n-sha256');
  });

  it('prefers SHA-512-256 over SHA-256 and MD5', () => {
    const stacked =
      'Digest realm="r", nonce="n-md5", algorithm=MD5, ' +
      'Digest realm="r", nonce="n-sha256", algorithm=SHA-256, ' +
      'Digest realm="r", nonce="n-sha512", algorithm=SHA-512-256';
    const c = selectStrongestDigestChallenge(stacked);
    expect(c?.algorithm).toBe('SHA-512-256');
    expect(c?.nonce).toBe('n-sha512');
  });

  it('preserves the algorithm-family choice across -sess variants', () => {
    const stacked =
      'Digest realm="r", nonce="n1", algorithm=MD5-sess, ' +
      'Digest realm="r", nonce="n2", algorithm=SHA-256-sess';
    const c = selectStrongestDigestChallenge(stacked);
    expect(c?.algorithm).toBe('SHA-256-sess');
  });

  it('falls back to MD5 when nothing else is offered', () => {
    const c = selectStrongestDigestChallenge('Digest realm="r", nonce="n", algorithm=MD5');
    expect(c?.algorithm).toBe('MD5');
  });

  it('handles qop values containing commas inside the challenge', () => {
    // qop="auth,auth-int" has an embedded comma — the split must not mis-
    // tokenise this as a second challenge.
    const c = selectStrongestDigestChallenge(
      'Digest realm="r", qop="auth,auth-int", nonce="n", algorithm=SHA-256',
    );
    expect(c?.algorithm).toBe('SHA-256');
    expect(c?.qop).toBe('auth,auth-int');
  });
});
