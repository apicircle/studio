import { describe, expect, it } from 'vitest';
import { generateId } from '@apicircle/shared';
import { assertSafePathId, isSafePathId, unsafePathIdMessage } from './safePathId';

// Every shape a legitimate producer mints, plus the free-form slot names a
// hand-edited workspace.json has always been allowed to carry.
const LEGITIMATE_IDS = [
  generateId(),
  '8f14e45f-ceea-467a-9575-6d8f0b2c1a3e',
  'imported-folder-0123456789abcdef',
  'e2e-my-label-workspace',
  'ws-1',
  'slot_A',
  'with spaces',
  'report.final.pdf',
  '.hidden',
  'a..b',
  '...x',
];

// Traversal and path-shape tricks: separators, dot segments (plain and
// percent-encoded), Windows drive/stream syntax, absolute paths, and control
// characters that could truncate a path or smuggle a header.
const EXPLOIT_IDS = [
  '',
  '.',
  '..',
  '...',
  '.. ',
  ' ',
  '../x',
  '..%2f',
  '%2e%2e',
  'a/../../b',
  '..\\x',
  'a\\b',
  '/etc/passwd',
  'C:\\Windows',
  'C:x',
  'file.txt:stream',
  '../../../../../../victim/priv/contents/.env',
  'nul\u0000byte',
  'line\nbreak',
  'tab\tchar',
  'del\u007fchar',
];

describe('isSafePathId', () => {
  it.each(LEGITIMATE_IDS)('accepts the legitimate id %j', (id) => {
    expect(isSafePathId(id)).toBe(true);
  });

  it.each(EXPLOIT_IDS)('refuses %j', (id) => {
    expect(isSafePathId(id)).toBe(false);
  });

  it('refuses values that are not strings', () => {
    expect(isSafePathId(undefined)).toBe(false);
    expect(isSafePathId(null)).toBe(false);
    expect(isSafePathId(42)).toBe(false);
    expect(isSafePathId({ id: 'ws-1' })).toBe(false);
  });
});

describe('assertSafePathId', () => {
  it('returns a safe id unchanged', () => {
    expect(assertSafePathId('ws-1', 'workspace id')).toBe('ws-1');
  });

  it('throws an error naming the kind of id and quoting the value', () => {
    expect(() => assertSafePathId('../x', 'attachment slot id')).toThrow(
      'Unsafe attachment slot id "../x"',
    );
  });
});

describe('unsafePathIdMessage', () => {
  it('explains which characters are refused', () => {
    expect(unsafePathIdMessage('workspace id', 'a/b')).toBe(
      'Unsafe workspace id "a/b": an id must not be empty or only dots, and must not contain "/", "\\", "%", ":" or control characters.',
    );
  });

  it('escapes control characters so the message stays one printable line', () => {
    expect(unsafePathIdMessage('workspace id', 'a\u0000b\nc')).toContain('"a\\u0000b\\nc"');
  });

  it('truncates a long value so a hostile document cannot flood the message', () => {
    const message = unsafePathIdMessage('workspace id', `${'a'.repeat(200)}/`);
    expect(message).toContain(`"${'a'.repeat(64)}…"`);
    expect(message).not.toContain('a'.repeat(65));
  });

  it('names the type of a value that is not a string', () => {
    expect(unsafePathIdMessage('workspace id', 42)).toContain('Unsafe workspace id (number)');
  });
});
