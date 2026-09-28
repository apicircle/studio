import { describe, expect, it } from 'vitest';
import {
  carriesLiteral,
  isCredentialName,
  literalPart,
  secretFormatReason,
  secretRowReason,
  secretValueReason,
  stripUrlCredentials,
  urlQueryPairs,
  urlUserinfo,
  userinfoReason,
} from './secretShapes';

// Realistic-looking but fake credentials, assembled so the literals below are
// not themselves flagged by secret scanners run over this repository.
const GITHUB_TOKEN = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8';
const JWT =
  'eyJhbGciOiJIUzI1NiJ9' +
  '.' +
  'eyJzdWIiOiIxMjM0NTY3ODkwIn0' +
  '.' +
  'dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
const RANDOM_KEY = 'q9Zt4Lm2Vx8Rb6Nc1Kd7Hw3Jp5Fs0Gy2Te4Ua8Qo'; // 40 chars, mixed case + digits

describe('literalPart', () => {
  it('drops {{variable}} references and trims', () => {
    expect(literalPart('  Bearer {{token}} ')).toBe('Bearer');
    expect(literalPart('{{a}}{{b}}')).toBe('');
    expect(literalPart('plain')).toBe('plain');
  });
});

describe('isCredentialName', () => {
  it.each([
    'Authorization',
    'Proxy-Authorization',
    'X-Auth-Token',
    'access_token',
    'apiKey',
    'X-API-Key',
    'x_api_key',
    'XAPIKey',
    'key',
    'client_secret',
    'password',
    'passwd',
    'pwd',
    'Cookie',
    'Set-Cookie',
    'sessionid',
    'JSESSIONID',
    'connect.sid',
    'PHPSESSID',
    'laravel_session',
    'Ocp-Apim-Subscription-Key',
    'AWS_ACCESS_KEY_ID',
    'credentials',
    'auth',
    'X-Bearer',
    'jwt',
  ])('flags %s', (name) => {
    expect(isCredentialName(name)).toBe(true);
  });

  it.each([
    'Content-Type',
    'Accept',
    'X-Request-Id',
    'token_url',
    'TOKEN_TYPE',
    'tokenEndpoint',
    'session_timeout',
    'password_policy',
    'api_key_header',
    'page_token',
    'nextPageToken',
    'idempotency-key',
    'cache_key',
    'sort_key',
    'BASE_URL',
    'author',
    '',
    '---',
  ])('does not flag %s', (name) => {
    expect(isCredentialName(name)).toBe(false);
  });
});

describe('carriesLiteral', () => {
  it.each(['hunter22', 'Bearer abc123def', 's3cr3t-value', GITHUB_TOKEN])(
    'treats %s as a literal value',
    (value) => {
      expect(carriesLiteral(value)).toBe(true);
    },
  );

  it.each([
    '',
    '   ',
    '{{token}}',
    'Bearer {{token}}',
    'abc',
    '3600',
    '-1.5',
    'true',
    'OFF',
    '<token>',
    '[your key]',
    'YOUR_API_KEY',
    'my-token',
    'xxxx',
    '****',
    'demo-bearer-token',
    'your-api-key-here',
    'changeme',
    'mock_access_token',
  ])('treats %j as no credential', (value) => {
    expect(carriesLiteral(value)).toBe(false);
  });
});

describe('secretFormatReason / secretValueReason', () => {
  it.each([
    [GITHUB_TOKEN, 'looks like a GitHub token'],
    [`Bearer ${GITHUB_TOKEN}`, 'looks like a GitHub token'],
    ['github_pat_' + '11ABCDEFG0123456789_abcdefghijk', 'looks like a GitHub token'],
    ['glpat-' + 'abcdefghij0123456789', 'looks like a GitLab token'],
    ['xoxb-' + '1234567890-abcdefghij', 'looks like a Slack token'],
    ['xapp-' + '1-A0123456789-abc', 'looks like a Slack token'],
    ['sk_live_' + '0123456789abcdefABCD', 'looks like a Stripe secret key'],
    ['rk_test_' + '0123456789abcdefABCD', 'looks like a Stripe secret key'],
    ['whsec_' + '0123456789abcdefABCD', 'looks like a webhook signing secret'],
    ['sk-' + 'proj-0123456789abcdefghij', 'looks like an API secret key'],
    ['AKIA' + 'IOSFODNN7EXAMPLE', 'looks like an AWS access key'],
    ['AIza' + 'SyA-0123456789abcdefghijklmnopqrstu', 'looks like a Google API key'],
    ['npm_' + 'abcdefghijklmnopqrstuvwxyz0123456789', 'looks like an npm token'],
    ['SG.' + 'abcdefghijklmnop' + '.' + 'ABCDEFGHIJKLMNOPQRST', 'looks like a SendGrid API key'],
    [JWT, 'looks like a JSON Web Token'],
    ['-----BEGIN RSA ' + 'PRIVATE KEY-----\nMIIE...', 'contains a private key'],
    [`token=${GITHUB_TOKEN}`, 'looks like a GitHub token'],
  ])('recognises the format of %s', (value, reason) => {
    expect(secretFormatReason(value)).toBe(reason);
    expect(secretValueReason(value)).toBe(reason);
  });

  it('flags a long random-looking key by its entropy, alone or after `=`', () => {
    expect(secretFormatReason(RANDOM_KEY)).toBeNull();
    expect(secretValueReason(RANDOM_KEY)).toBe('looks like a randomly generated secret');
    expect(secretValueReason(`Token ${RANDOM_KEY}`)).toBe('looks like a randomly generated secret');
    expect(secretValueReason(`key=${RANDOM_KEY}; path=/`)).toBe(
      'looks like a randomly generated secret',
    );
    // The name before `=` reads as words; the value after it is the key.
    expect(secretValueReason(`authenticationtoken=${RANDOM_KEY}`)).toBe(
      'looks like a randomly generated secret',
    );
  });

  it.each([
    '',
    '{{ghp_should_not_count}}',
    'application/json',
    '00000000-4000-8000-0000-000000000000',
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', // sha-256 hex
    'da39a3ee5e6b4b0d3255bfef95601890afd80709', // git sha
    'The Quick Brown Fox Jumps Over 13 Lazy Dogs',
    '/Api/V1/Users/Profile/Settings/Notifications/2026', // a path, not base64
    'ThisIsAVeryLongCamelCaseIdentifier2026', // an identifier: made of words
    'getUserProfileSettingsV2ResponseHandler', // an identifier: low entropy
    'Mozilla5WindowsNT100Win64x64AppleWebKit', // a user agent, run together
    'task-' + '0123456789abcdefghijklmnop', // `sk-` inside a word is not a key prefix
  ])('does not flag %j', (value) => {
    expect(secretValueReason(value)).toBeNull();
  });

  it('stays linear on hostile input', () => {
    const hostile = '-eyJ'.repeat(50_000) + ' ' + 'aB3'.repeat(40_000);
    const started = Date.now();
    expect(secretValueReason(hostile)).not.toBeUndefined();
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});

describe('secretRowReason', () => {
  it('prefers what the value is over what it is called', () => {
    expect(secretRowReason('X-Trace', GITHUB_TOKEN)).toBe('looks like a GitHub token');
    expect(secretRowReason('Authorization', `Bearer ${JWT}`)).toBe('looks like a JSON Web Token');
  });

  it('falls back to a credential name with a literal value', () => {
    expect(secretRowReason('Authorization', 'Basic dXNlcjpwYXNz')).toBe('named like a credential');
    expect(secretRowReason('Authorization', 'Bearer {{token}}')).toBeNull();
    expect(secretRowReason('Accept', 'application/json')).toBeNull();
  });
});

describe('urlUserinfo', () => {
  it('finds user-info in an absolute URL', () => {
    const url = 'https://user:pass@api.example.com/v1';
    const info = urlUserinfo(url)!;
    expect(info.userinfo).toBe('user:pass');
    expect(url.slice(info.start, info.end)).toBe('user:pass@');
  });

  it('ends the user-info at the LAST @ of the authority', () => {
    expect(urlUserinfo('https://us@er:p@ss@host/x')?.userinfo).toBe('us@er:p@ss');
  });

  it.each([
    'api.example.com/v1',
    '{{BASE_URL}}/v1',
    'https://api.example.com/users/a@b',
    'https://api.example.com?email=a@b',
  ])('finds none in %s', (url) => {
    expect(urlUserinfo(url)).toBeNull();
  });
});

describe('userinfoReason', () => {
  it('flags a literal password and a token-shaped user name', () => {
    expect(userinfoReason('user:pass')).toBe('carries a password');
    expect(userinfoReason(GITHUB_TOKEN)).toBe('looks like a GitHub token');
    expect(userinfoReason(encodeURIComponent(GITHUB_TOKEN))).toBe('looks like a GitHub token');
  });

  it('leaves plain user names, empty passwords and variables alone', () => {
    expect(userinfoReason('admin')).toBeNull();
    expect(userinfoReason('admin:')).toBeNull();
    expect(userinfoReason('{{user}}:{{pass}}')).toBeNull();
    expect(userinfoReason('%E0%A4%A')).toBeNull();
  });
});

describe('stripUrlCredentials', () => {
  it('removes credential user-info and keeps everything else verbatim', () => {
    expect(stripUrlCredentials('https://user:pass@api.example.com/{{path}}?q=1')).toBe(
      'https://api.example.com/{{path}}?q=1',
    );
    expect(stripUrlCredentials(`https://${GITHUB_TOKEN}@github.com/o/r.git`)).toBe(
      'https://github.com/o/r.git',
    );
  });

  it.each([
    'https://{{user}}:{{pass}}@api.example.com',
    'https://admin@api.example.com',
    'https://api.example.com/v1',
    '{{BASE_URL}}/v1',
  ])('leaves %s unchanged', (url) => {
    expect(stripUrlCredentials(url)).toBe(url);
  });
});

describe('urlQueryPairs', () => {
  it('splits and decodes a query string, ignoring the fragment', () => {
    expect(urlQueryPairs('https://h/p?a=1&flag&c=%41&bad=%E0%A4%A#frag')).toEqual([
      { key: 'a', value: '1' },
      { key: 'flag', value: '' },
      { key: 'c', value: 'A' },
      { key: 'bad', value: '%E0%A4%A' },
    ]);
  });

  it('returns nothing without a query string', () => {
    expect(urlQueryPairs('https://h/p')).toEqual([]);
    expect(urlQueryPairs('https://h/p?')).toEqual([]);
    expect(urlQueryPairs('https://h/p?#frag')).toEqual([]);
  });
});
