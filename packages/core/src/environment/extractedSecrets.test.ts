import { describe, expect, it } from 'vitest';
import type { ContextExtraction } from '@apicircle/shared';
import { extractedSecretReason, savedContextOnly } from './extractedSecrets';

type Rule = Pick<ContextExtraction, 'variable' | 'source' | 'path'>;

const body = (variable: string, path: string): Rule => ({ variable, source: 'body', path });

describe('extractedSecretReason', () => {
  it.each<[string, Rule, string, string | null]>([
    ['a status code', { variable: 'TOKEN', source: 'status', path: '' }, '200', null],
    [
      'a credential-named variable',
      body('ACCESS_TOKEN', 'data.x'),
      'tok-123',
      'named like a credential',
    ],
    [
      'a JWT under any name',
      body('V', 'v'),
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.s',
      'looks like a JSON Web Token',
    ],
    [
      'a GitHub token under any name',
      body('V', 'v'),
      'ghp_abcdefghijklmnopqrstuvwxyz0123456789',
      'looks like a GitHub token',
    ],
    [
      'a credential-named JSON leaf',
      body('V', '$.data.access_token'),
      'opaque-1',
      'read from a field named like a credential',
    ],
    [
      'a credential-named leaf after an index',
      body('V', 'items[0].secret'),
      'opaque-1',
      'read from a field named like a credential',
    ],
    [
      'an index-only leaf is skipped',
      body('V', 'tokens[0]'),
      'opaque-1',
      'read from a field named like a credential',
    ],
    [
      'a credential-named header',
      { variable: 'V', source: 'header', path: ' X-Auth-Token ' },
      'opaque-1',
      'read from a header named like a credential',
    ],
    [
      'a credential-named cookie',
      { variable: 'V', source: 'cookie', path: 'sid' },
      'opaque-1',
      'read from a cookie named like a credential',
    ],
    ['a plain id', body('USER_ID', 'data.id'), '42', null],
    [
      'a plain header',
      { variable: 'REQ', source: 'header', path: 'X-Request-Id' },
      'abc-123',
      null,
    ],
    ['a number under a credential name', body('TOKEN_TTL', 'token'), '3600', null],
    ['a placeholder under a credential name', body('TOKEN', 'token'), 'changeme', null],
    ['a short value from a credential field', body('V', 'token'), 'abc', null],
    ['a pagination handle', body('NEXT', 'next_page_token'), 'cursor-2', null],
    ['an empty path', body('V', ''), 'opaque-1', null],
    ['a root path', body('V', '$'), 'opaque-1', null],
  ])('%s', (_label, rule, value, reason) => {
    expect(extractedSecretReason(rule, value)).toBe(reason);
  });

  it('holds a value that is, or contains, a secret the request sent', () => {
    expect(extractedSecretReason(body('V', 'v'), 'sent-1', ['sent-1'])).toBe(
      'holds a secret this request sent',
    );
    expect(extractedSecretReason(body('V', 'v'), 'Bearer sent-1', ['sent-1'])).toBe(
      'holds a secret this request sent',
    );
  });

  it('matches a short known secret only as the whole value, and ignores an empty one', () => {
    expect(extractedSecretReason(body('V', 'v'), 'ab', ['ab'])).toBe(
      'holds a secret this request sent',
    );
    expect(extractedSecretReason(body('V', 'v'), 'xaby', ['ab'])).toBeNull();
    expect(extractedSecretReason(body('V', 'v'), 'plain', [''])).toBeNull();
  });
});

describe('savedContextOnly', () => {
  it('drops entries named or shaped like credentials and keeps the rest', () => {
    expect(
      savedContextOnly({
        ACCESS_TOKEN: 'tok-123',
        V: 'ghp_abcdefghijklmnopqrstuvwxyz0123456789',
        USER_ID: '42',
        TOKEN_TTL: '3600',
      }),
    ).toEqual({ USER_ID: '42', TOKEN_TTL: '3600' });
  });
});
