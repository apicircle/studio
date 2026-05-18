import { describe, expect, it } from 'vitest';
import { isPostmanEnvironment, parsePostmanEnvironment } from './postmanEnvironment';

describe('isPostmanEnvironment', () => {
  it('accepts the canonical scope marker', () => {
    expect(
      isPostmanEnvironment({ name: 'x', values: [], _postman_variable_scope: 'environment' }),
    ).toBe(true);
  });
  it('accepts a name + values shape without scope', () => {
    expect(isPostmanEnvironment({ name: 'x', values: [{ key: 'a', value: 'b' }] })).toBe(true);
  });
  it('rejects collections', () => {
    expect(isPostmanEnvironment({ info: { schema: 'collection/v2.1' }, item: [] })).toBe(false);
  });
});

describe('parsePostmanEnvironment', () => {
  it('imports enabled rows, skipping disabled and empty keys', () => {
    const doc = JSON.stringify({
      name: 'staging',
      _postman_variable_scope: 'environment',
      values: [
        { key: 'BASE_URL', value: 'https://api.example.com', enabled: true },
        { key: 'TOKEN', value: 'tk', enabled: true, type: 'secret' },
        { key: 'DISABLED', value: 'x', enabled: false },
        { key: '', value: 'no-key' },
      ],
    });
    const parsed = parsePostmanEnvironment(doc);
    expect(parsed.name).toBe('staging');
    expect(parsed.variables).toEqual([
      { key: 'BASE_URL', value: 'https://api.example.com', encrypted: false },
      { key: 'TOKEN', value: 'tk', encrypted: false },
    ]);
    // Secret-type rows generate a warning (imported as plaintext).
    expect(parsed.warnings.some((w) => w.includes('TOKEN'))).toBe(true);
  });

  it('throws on non-environment shapes', () => {
    expect(() => parsePostmanEnvironment('{}')).toThrow(/Unsupported format/i);
    expect(() => parsePostmanEnvironment('garbage')).toThrow(/Couldn't parse JSON/i);
  });
});
