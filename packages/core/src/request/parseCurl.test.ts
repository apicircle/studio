import { describe, expect, it } from 'vitest';
import { parseCurl, tokenizeCurl } from './parseCurl';

describe('tokenizeCurl', () => {
  it('splits on whitespace', () => {
    expect(tokenizeCurl('curl -X GET https://x')).toEqual(['curl', '-X', 'GET', 'https://x']);
  });

  it('preserves single-quoted strings as one token (no escape interpretation)', () => {
    expect(tokenizeCurl(`curl -H 'Authorization: Bearer \\n'`)).toEqual([
      'curl',
      '-H',
      'Authorization: Bearer \\n',
    ]);
  });

  it('honors double-quoted strings with backslash escapes', () => {
    expect(tokenizeCurl(`curl -H "X: a\\"b"`)).toEqual(['curl', '-H', 'X: a"b']);
  });

  it('handles backslash line continuation', () => {
    const input = "curl https://x \\\n  -H 'A: 1' \\\n  -H 'B: 2'";
    expect(tokenizeCurl(input)).toEqual(['curl', 'https://x', '-H', 'A: 1', '-H', 'B: 2']);
  });

  it('returns an empty list for empty input', () => {
    expect(tokenizeCurl('')).toEqual([]);
  });

  it('handles backslash-escaped characters outside quotes', () => {
    expect(tokenizeCurl(String.raw`curl https://x\ y`)).toEqual(['curl', 'https://x y']);
  });
});

describe('parseCurl', () => {
  it('parses a simple GET', () => {
    const r = parseCurl('curl https://api.example.test/users');
    expect(r.method).toBe('GET');
    expect(r.url).toBe('https://api.example.test/users');
    expect(r.headers).toEqual([]);
    expect(r.body).toEqual({ type: 'none', content: '' });
  });

  it('parses -X / --request', () => {
    expect(parseCurl('curl -X POST https://x').method).toBe('POST');
    expect(parseCurl('curl --request DELETE https://x').method).toBe('DELETE');
  });

  it('warns on unsupported method', () => {
    const r = parseCurl('curl -X PURGE https://x');
    expect(r.method).toBe('GET');
    expect(r.warnings.some((w) => w.includes('PURGE'))).toBe(true);
  });

  it('parses headers via -H and --header', () => {
    const r = parseCurl(
      `curl -H "Accept: application/json" --header 'Authorization: Bearer abc' https://x`,
    );
    expect(r.headers).toEqual([
      { key: 'Accept', value: 'application/json', enabled: true },
      { key: 'Authorization', value: 'Bearer abc', enabled: true },
    ]);
  });

  it('warns on a malformed header (no colon)', () => {
    const r = parseCurl(`curl -H "no colon here" https://x`);
    expect(r.warnings[0]).toMatch(/malformed header/);
  });

  it('parses a JSON body via --data and infers POST', () => {
    const r = parseCurl(`curl -d '{"name":"alice"}' https://x`);
    expect(r.method).toBe('POST');
    expect(r.body).toEqual({ type: 'json', content: '{"name":"alice"}' });
    // Content-Type header gets auto-filled.
    expect(r.headers).toContainEqual({
      key: 'Content-Type',
      value: 'application/json',
      enabled: true,
    });
  });

  it('does NOT promote to POST when -X GET was explicit', () => {
    const r = parseCurl(`curl -X GET -d 'a=1' https://x`);
    expect(r.method).toBe('GET');
  });

  it('detects urlencoded body via --data-urlencode', () => {
    const r = parseCurl(`curl --data-urlencode 'k=v with space' https://x`);
    expect(r.body.type).toBe('urlencoded');
    expect(r.body.content).toContain('k=v with space');
  });

  it('joins multiple -d flags into newline-delimited urlencoded fields', () => {
    const r = parseCurl(
      `curl -H 'Content-Type: application/x-www-form-urlencoded' -d a=1 -d b=2 https://x`,
    );
    expect(r.body.type).toBe('urlencoded');
    expect(r.body.content).toBe('a=1\nb=2');
  });

  it('splits a single &-joined -d value into separate urlencoded fields', () => {
    const r = parseCurl(
      `curl -H 'Content-Type: application/x-www-form-urlencoded' --data-raw 'a=1&b=2' https://x`,
    );
    expect(r.body.type).toBe('urlencoded');
    expect(r.body.content).toBe('a=1\nb=2');
  });

  it('keeps a literal & inside a --data-urlencode value as one field', () => {
    const r = parseCurl(`curl --data-urlencode 'q=a&b' https://x`);
    expect(r.body.type).toBe('urlencoded');
    expect(r.body.content).toBe('q=a&b');
  });

  it('parses --json verbatim', () => {
    const r = parseCurl(`curl --json '{"x":1}' https://x`);
    expect(r.body).toEqual({ type: 'json', content: '{"x":1}' });
    expect(r.headers.find((h) => h.key === 'Content-Type')?.value).toBe('application/json');
  });

  it('parses Basic auth via -u and --user', () => {
    expect(parseCurl(`curl -u alice:secret https://x`).auth).toEqual({
      type: 'basic',
      username: 'alice',
      password: 'secret',
    });
    expect(parseCurl(`curl --user "bob:" https://x`).auth).toEqual({
      type: 'basic',
      username: 'bob',
      password: '',
    });
  });

  it('extracts query string from URL into query[] entries', () => {
    const r = parseCurl(`curl 'https://x?a=1&b=hello%20world'`);
    expect(r.url).toBe('https://x');
    expect(r.query).toEqual([
      { key: 'a', value: '1', enabled: true },
      { key: 'b', value: 'hello world', enabled: true },
    ]);
  });

  it('parses --form text fields into form-data rows', () => {
    const r = parseCurl(`curl -F 'name=alice' -F 'role=admin' https://x`);
    expect(r.method).toBe('POST');
    expect(r.body.type).toBe('form-data');
    expect(r.body.formRows).toEqual([
      { kind: 'text', key: 'name', value: 'alice', enabled: true },
      { kind: 'text', key: 'role', value: 'admin', enabled: true },
    ]);
  });

  it("warns when -F references a file (paste-import can't reach the FS)", () => {
    const r = parseCurl(`curl -F 'avatar=@/tmp/photo.png' https://x`);
    expect(r.body.formRows).toEqual([{ kind: 'file', key: 'avatar', slotId: null, enabled: true }]);
    expect(r.warnings.some((w) => w.includes('photo.png'))).toBe(true);
  });

  it('handles --url for the URL', () => {
    const r = parseCurl(`curl --url https://x -X GET`);
    expect(r.url).toBe('https://x');
  });

  it('strips a leading $ prompt from copy-paste', () => {
    const r = parseCurl(`$ curl https://x`);
    expect(r.url).toBe('https://x');
  });

  it('drops harmless flags (--compressed, -L, etc.) without warnings', () => {
    const r = parseCurl(`curl --compressed -L --silent https://x`);
    expect(r.warnings).toEqual([]);
  });

  it('promotes -A / --user-agent into a User-Agent header', () => {
    const r = parseCurl(`curl -A "Custom/1.0" https://x`);
    expect(r.headers).toContainEqual({ key: 'User-Agent', value: 'Custom/1.0', enabled: true });
  });

  it('promotes -b / --cookie into a Cookie header', () => {
    const r = parseCurl(`curl -b "session=abc" https://x`);
    expect(r.headers).toContainEqual({ key: 'Cookie', value: 'session=abc', enabled: true });
  });

  it('promotes -e / --referer into a Referer header', () => {
    const r = parseCurl(`curl -e "https://r" https://x`);
    expect(r.headers).toContainEqual({ key: 'Referer', value: 'https://r', enabled: true });
  });

  it('warns on an unrecognised flag', () => {
    const r = parseCurl(`curl --magic-flag https://x`);
    expect(r.warnings[0]).toMatch(/--magic-flag/);
  });

  it('warns on extra positional URLs', () => {
    const r = parseCurl(`curl https://a https://b`);
    expect(r.url).toBe('https://a');
    expect(r.warnings[0]).toMatch(/https:\/\/b/);
  });

  it('handles a multi-line copy-as-cURL with backslash continuations', () => {
    const input = `curl 'https://api.example.test/users' \\\n  -H 'Accept: application/json' \\\n  -H 'Authorization: Bearer t' \\\n  --data-raw '{"name":"x"}'`;
    const r = parseCurl(input);
    expect(r.method).toBe('POST');
    expect(r.url).toBe('https://api.example.test/users');
    expect(r.headers).toContainEqual({
      key: 'Authorization',
      value: 'Bearer t',
      enabled: true,
    });
    expect(r.body).toEqual({ type: 'json', content: '{"name":"x"}' });
  });

  it('warns on empty input', () => {
    const r = parseCurl('');
    expect(r.warnings[0]).toMatch(/Empty cURL/);
  });

  it('warns when no URL is found', () => {
    const r = parseCurl(`curl -X POST -H 'A: 1'`);
    expect(r.warnings.some((w) => w.includes('No URL'))).toBe(true);
  });

  it('detects XML body shape from a leading <', () => {
    const r = parseCurl(`curl -d '<root/>' https://x`);
    expect(r.body.type).toBe('xml');
  });

  it('keeps text body for non-JSON / non-XML content', () => {
    const r = parseCurl(`curl -d 'plain text body' https://x`);
    expect(r.body.type).toBe('text');
  });
});
