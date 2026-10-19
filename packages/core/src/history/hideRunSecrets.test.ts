import { describe, expect, it } from 'vitest';
import { RUN_HIDDEN_VALUE, type RequestRun } from '@apicircle/shared';
import { hideRunSecrets } from './hideRunSecrets';

const H = RUN_HIDDEN_VALUE;

const run = (overrides: Partial<RequestRun> = {}): RequestRun => ({
  id: 'run-1',
  requestId: 'req-1',
  startedAt: '2026-10-19T00:00:00.000Z',
  durationMs: 12,
  status: 200,
  statusText: 'OK',
  ok: true,
  url: 'https://api.example.test/items',
  method: 'GET',
  requestHeaders: { Accept: 'application/json' },
  requestBodyPreview: null,
  responseHeaders: { 'content-type': 'application/json' },
  responseBodyPreview: '{"items":[]}',
  responseBodyKind: 'json',
  responseTruncated: false,
  assertions: [],
  ...overrides,
});

describe('hideRunSecrets', () => {
  it('returns the same run when there is nothing to hide', () => {
    const r = run();
    expect(hideRunSecrets(r, ['not-in-it'])).toBe(r);
    expect(hideRunSecrets(r)).toBe(r);
  });

  it('hides credential headers by name, keeping the names', () => {
    const out = hideRunSecrets(
      run({
        requestHeaders: {
          Authorization: 'Bearer abc.def',
          Cookie: 'sid=1',
          'X-API-Key': 'k-123',
          'Proxy-Authorization': 'Basic Zm9v',
          Accept: 'application/json',
          'X-Empty-Token': '',
        },
        responseHeaders: { 'Set-Cookie': 'session=xyz; HttpOnly', 'content-type': 'text/plain' },
      }),
    );
    expect(out.requestHeaders).toEqual({
      Authorization: H,
      Cookie: H,
      'X-API-Key': H,
      'Proxy-Authorization': H,
      Accept: 'application/json',
      'X-Empty-Token': '',
    });
    expect(out.responseHeaders).toEqual({ 'Set-Cookie': H, 'content-type': 'text/plain' });
    expect(out.secretsHidden).toBe(true);
  });

  it('hides any header holding a known secret, and one shaped like a credential', () => {
    const out = hideRunSecrets(
      run({
        requestHeaders: {
          'X-Tenant': 'acme',
          'X-Forwarded-Admin': 'prefix-s3cr3t-value-suffix',
          'X-Short': 'ab',
          'X-Upstream': 'ghp_abcdefghijklmnopqrstuvwxyz0123456789',
        },
      }),
      ['s3cr3t-value', 'ab'],
    );
    expect(out.requestHeaders).toEqual({
      'X-Tenant': 'acme',
      'X-Forwarded-Admin': H,
      // A short secret is hidden only where it is the whole value.
      'X-Short': H,
      'X-Upstream': H,
    });
  });

  it('cuts known secrets out of the URL — raw and URL-encoded — and hides credential query values', () => {
    const out = hideRunSecrets(
      run({ url: 'https://api.example.test/u/tok%2Fen%20x?a=1&api_key=k-1&raw=tok/en x#frag' }),
      ['tok/en x'],
    );
    expect(out.url).toBe(`https://api.example.test/u/${H}?a=1&api_key=${H}&raw=${H}#frag`);
  });

  it('keeps a query flag that has no value', () => {
    expect(hideRunSecrets(run({ url: 'https://api.example.test/x?debug&token=t1' })).url).toBe(
      `https://api.example.test/x?debug&token=${H}`,
    );
  });

  it('strips user:pass@ from the URL', () => {
    const out = hideRunSecrets(run({ url: 'https://user:hunter22@api.example.test/x' }));
    expect(out.url).toBe('https://api.example.test/x');
    expect(out.secretsHidden).toBe(true);
  });

  it('leaves a URL without a query alone apart from known secrets', () => {
    expect(hideRunSecrets(run({ url: 'https://api.example.test/plain' }), ['zzzz']).url).toBe(
      'https://api.example.test/plain',
    );
  });

  it('hides credential fields and known secrets in a JSON body, keeping its shape', () => {
    const out = hideRunSecrets(
      run({
        responseBodyPreview:
          '{\n  "access_token": "eyJabc",\n  "token_type": "Bearer",\n  "user": {"name": "Ann", "password": "p\\"w"},\n  "note": "has my-known-secret inside",\n  "n": 3\n}',
      }),
      ['my-known-secret'],
    );
    expect(out.responseBodyPreview).toBe(
      `{\n  "access_token": "${H}",\n  "token_type": "Bearer",\n  "user": {"name": "Ann", "password": "${H}"},\n  "note": "has ${H} inside",\n  "n": 3\n}`,
    );
  });

  it('hides a JSON value shaped like a credential whatever its name', () => {
    const out = hideRunSecrets(
      run({ responseBodyPreview: '{"value":"ghp_abcdefghijklmnopqrstuvwxyz0123456789"}' }),
    );
    expect(out.responseBodyPreview).toBe(`{"value":"${H}"}`);
  });

  it('cuts a known secret as JSON carries it (escaped)', () => {
    const out = hideRunSecrets(run({ requestBodyPreview: '{"q":"say \\"hi\\" now"}' }), [
      'say "hi" now',
    ]);
    expect(out.requestBodyPreview).toBe(`{"q":"${H}"}`);
  });

  it('hides credential pairs in a form-encoded body', () => {
    const out = hideRunSecrets(
      run({
        requestBodyPreview: 'grant_type=password&username=ann&password=p%40ss&client_secret=cs',
        responseBodyPreview: 'oauth_token=t1&oauth_token_secret=t2&oauth_callback_confirmed=true',
      }),
    );
    expect(out.requestBodyPreview).toBe(
      `grant_type=password&username=ann&password=${H}&client_secret=${H}`,
    );
    expect(out.responseBodyPreview).toBe(
      `oauth_token=${H}&oauth_token_secret=${H}&oauth_callback_confirmed=true`,
    );
  });

  it('keeps a malformed escape readable rather than failing', () => {
    const out = hideRunSecrets(
      run({
        url: 'https://api.example.test/x?token=%E0%A4%A&n=1',
        responseBodyPreview: '{"bad\\u12": "v", "secret": "\\u12zz"}',
      }),
    );
    expect(out.url).toBe(`https://api.example.test/x?token=${H}&n=1`);
    expect(out.responseBodyPreview).toBe(`{"bad\\u12": "v", "secret": "${H}"}`);
  });

  it('does not treat plain text as form-encoded', () => {
    const text = 'token=abc is what the docs say';
    expect(hideRunSecrets(run({ responseBodyPreview: text })).responseBodyPreview).toBe(text);
  });

  it('ignores blank secrets and does not re-hide a hidden value', () => {
    const r = run({ requestHeaders: { 'X-Note': H }, responseBodyPreview: `{"token":"${H}"}` });
    expect(hideRunSecrets(r, ['', '   '])).toBe(r);
  });

  it('keeps a null request body null', () => {
    expect(hideRunSecrets(run({ requestHeaders: { Authorization: 'x' } })).requestBodyPreview).toBe(
      null,
    );
  });
});
