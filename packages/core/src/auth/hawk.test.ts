import { describe, expect, it } from 'vitest';
import { buildHawkAuthHeader } from './hawk';

describe('buildHawkAuthHeader', () => {
  // Inputs drawn from the Hawk README's worked example. The expected
  // MAC value is what the reference Node implementation produces given
  // the same normalized request string and key.
  it('matches the Hawk README worked example (SHA-256)', async () => {
    const header = await buildHawkAuthHeader({
      method: 'GET',
      url: 'http://example.com:8000/resource/1?b=1&a=2',
      hawkId: 'dh37fgj492je',
      hawkKey: 'werxhqb98rpaxn39848xrunpaw3489ruxnpa98w4rxn',
      algorithm: 'sha256',
      timestamp: 1353832234,
      nonce: 'j4h3g2',
      ext: 'some-app-ext-data',
    });
    expect(header).toContain('id="dh37fgj492je"');
    expect(header).toContain('ts="1353832234"');
    expect(header).toContain('nonce="j4h3g2"');
    expect(header).toContain('ext="some-app-ext-data"');
    expect(header).toContain('mac="6R4rV5iE+NPoym+WwjeHzjAGXUtLNIxmo1vpMofpLAE="');
  });

  it('falls back to default port 443 for https URLs', async () => {
    const header = await buildHawkAuthHeader({
      method: 'POST',
      url: 'https://example.com/x',
      hawkId: 'id',
      hawkKey: 'key',
      timestamp: 1,
      nonce: 'n',
    });
    // The MAC differs from the http+port=80 case, validating port handling.
    const mac1 = /mac="([^"]+)"/.exec(header)?.[1];
    const httpHeader = await buildHawkAuthHeader({
      method: 'POST',
      url: 'http://example.com/x',
      hawkId: 'id',
      hawkKey: 'key',
      timestamp: 1,
      nonce: 'n',
    });
    const mac2 = /mac="([^"]+)"/.exec(httpHeader)?.[1];
    expect(mac1).not.toBe(mac2);
  });

  it('lowercases host before signing', async () => {
    const upper = await buildHawkAuthHeader({
      method: 'GET',
      url: 'http://EXAMPLE.com:80/x',
      hawkId: 'i',
      hawkKey: 'k',
      timestamp: 1,
      nonce: 'n',
    });
    const lower = await buildHawkAuthHeader({
      method: 'GET',
      url: 'http://example.com:80/x',
      hawkId: 'i',
      hawkKey: 'k',
      timestamp: 1,
      nonce: 'n',
    });
    expect(/mac="([^"]+)"/.exec(upper)?.[1]).toBe(/mac="([^"]+)"/.exec(lower)?.[1]);
  });

  it('produces a different MAC for SHA-1 vs SHA-256', async () => {
    const sha256 = await buildHawkAuthHeader({
      method: 'GET',
      url: 'http://x/y',
      hawkId: 'i',
      hawkKey: 'k',
      timestamp: 1,
      nonce: 'n',
      algorithm: 'sha256',
    });
    const sha1 = await buildHawkAuthHeader({
      method: 'GET',
      url: 'http://x/y',
      hawkId: 'i',
      hawkKey: 'k',
      timestamp: 1,
      nonce: 'n',
      algorithm: 'sha1',
    });
    expect(/mac="([^"]+)"/.exec(sha256)?.[1]).not.toBe(/mac="([^"]+)"/.exec(sha1)?.[1]);
  });

  it('includes app + dlg directives when supplied', async () => {
    const header = await buildHawkAuthHeader({
      method: 'GET',
      url: 'http://x/y',
      hawkId: 'i',
      hawkKey: 'k',
      timestamp: 1,
      nonce: 'n',
      app: 'my-app',
      delegation: 'parent-app',
    });
    expect(header).toContain('app="my-app"');
    expect(header).toContain('dlg="parent-app"');
  });

  it('emits a hash="…" directive and folds payload into the MAC when payload is supplied', async () => {
    const noPayload = await buildHawkAuthHeader({
      method: 'POST',
      url: 'http://example.com:80/x',
      hawkId: 'i',
      hawkKey: 'k',
      timestamp: 1,
      nonce: 'n',
    });
    const withPayload = await buildHawkAuthHeader({
      method: 'POST',
      url: 'http://example.com:80/x',
      hawkId: 'i',
      hawkKey: 'k',
      timestamp: 1,
      nonce: 'n',
      payload: { body: '{"hello":"world"}', contentType: 'application/json' },
    });
    // hash="…" present only when a payload is bound.
    expect(noPayload).not.toContain('hash="');
    expect(withPayload).toMatch(/hash="[A-Za-z0-9+/=]+="?, /);
    // MAC must change because payload-hash is part of the normalized string.
    const noPayloadMac = /mac="([^"]+)"/.exec(noPayload)?.[1];
    const withPayloadMac = /mac="([^"]+)"/.exec(withPayload)?.[1];
    expect(noPayloadMac).not.toBe(withPayloadMac);
  });

  it('changes the payload-hash when content-type changes (per §3.2.5)', async () => {
    const json = await buildHawkAuthHeader({
      method: 'POST',
      url: 'http://example.com:80/x',
      hawkId: 'i',
      hawkKey: 'k',
      timestamp: 1,
      nonce: 'n',
      payload: { body: '{"x":1}', contentType: 'application/json' },
    });
    const text = await buildHawkAuthHeader({
      method: 'POST',
      url: 'http://example.com:80/x',
      hawkId: 'i',
      hawkKey: 'k',
      timestamp: 1,
      nonce: 'n',
      payload: { body: '{"x":1}', contentType: 'text/plain' },
    });
    expect(/hash="([^"]+)"/.exec(json)?.[1]).not.toBe(/hash="([^"]+)"/.exec(text)?.[1]);
  });

  it('matches the Mozilla Hawk reference payload-hash vector (sha256, "Thank you for flying Hawk")', async () => {
    // From mozilla/hawk's test suite — the canonical
    // `Crypto.calculatePayloadHash` vector. We don't expose a separate
    // `calculatePayloadHash` API, so we verify by extracting the
    // `hash="..."` directive from a built header and comparing against
    // the published expected value.
    const header = await buildHawkAuthHeader({
      method: 'POST',
      url: 'http://example.com:80/x',
      hawkId: 'i',
      hawkKey: 'k',
      timestamp: 1,
      nonce: 'n',
      algorithm: 'sha256',
      payload: { body: 'Thank you for flying Hawk', contentType: 'text/plain' },
    });
    const hash = /hash="([^"]+)"/.exec(header)?.[1];
    expect(hash).toBe('Yi9LfIIFRtBEPt74PVmbTF/xVAwPn7ub15ePICfgnuY=');
  });

  it('accepts a Uint8Array payload body', async () => {
    const header = await buildHawkAuthHeader({
      method: 'POST',
      url: 'http://example.com:80/x',
      hawkId: 'i',
      hawkKey: 'k',
      timestamp: 1,
      nonce: 'n',
      payload: { body: new TextEncoder().encode('hello'), contentType: 'text/plain' },
    });
    expect(header).toMatch(/hash="/);
  });

  it('throws on a malformed URL', async () => {
    await expect(
      buildHawkAuthHeader({
        method: 'GET',
        url: 'not a url',
        hawkId: 'i',
        hawkKey: 'k',
        timestamp: 1,
        nonce: 'n',
      }),
    ).rejects.toThrow(/invalid URL/i);
  });
});
