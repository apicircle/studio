import { describe, expect, it } from 'vitest';
import {
  isApicircleEnvironment,
  parseApicircleEnvironment,
  parseApicircleEnvironmentDoc,
} from './apicircleEnvironment';

describe('isApicircleEnvironment', () => {
  it('returns true for the canonical v1 envelope', () => {
    expect(
      isApicircleEnvironment({
        apicircleEnvironment: 1,
        name: 'dev',
        variables: [],
      }),
    ).toBe(true);
  });

  it('returns true for the v2 envelope (ciphertext + salt carry)', () => {
    expect(
      isApicircleEnvironment({
        apicircleEnvironment: 2,
        name: 'dev',
        variables: [],
      }),
    ).toBe(true);
  });

  it('returns false when the magic key is missing or wrong version', () => {
    expect(isApicircleEnvironment({ name: 'dev', variables: [] })).toBe(false);
    expect(isApicircleEnvironment({ apicircleEnvironment: 3, name: 'dev', variables: [] })).toBe(
      false,
    );
    expect(isApicircleEnvironment({ apicircleEnvironment: '1', name: 'dev', variables: [] })).toBe(
      false,
    );
  });

  it('returns false when name or variables is the wrong shape', () => {
    expect(isApicircleEnvironment({ apicircleEnvironment: 1, variables: [] })).toBe(false);
    expect(isApicircleEnvironment({ apicircleEnvironment: 1, name: 'dev' })).toBe(false);
    expect(
      isApicircleEnvironment({ apicircleEnvironment: 1, name: 'dev', variables: 'nope' }),
    ).toBe(false);
  });

  it('returns false for primitives and null', () => {
    expect(isApicircleEnvironment(null)).toBe(false);
    expect(isApicircleEnvironment(undefined)).toBe(false);
    expect(isApicircleEnvironment('apicircle')).toBe(false);
    expect(isApicircleEnvironment(1)).toBe(false);
  });
});

describe('parseApicircleEnvironment', () => {
  it('round-trips plain variables verbatim with no encrypted hints', () => {
    const json = JSON.stringify({
      apicircleEnvironment: 1,
      name: 'dev',
      variables: [
        { key: 'API_BASE', value: 'https://api.example.com', encrypted: false },
        { key: 'TIMEOUT', value: '5000', encrypted: false },
      ],
    });
    const parsed = parseApicircleEnvironment(json);
    expect(parsed.name).toBe('dev');
    expect(parsed.variables).toEqual([
      { key: 'API_BASE', value: 'https://api.example.com', encrypted: false },
      { key: 'TIMEOUT', value: '5000', encrypted: false },
    ]);
    expect(parsed.encryptedBindingHints).toEqual([]);
    expect(parsed.warnings).toEqual([]);
  });

  it('surfaces an encryptedBindingHint when the row carries secret.label (new shape)', () => {
    const parsed = parseApicircleEnvironmentDoc({
      apicircleEnvironment: 1,
      name: 'prod',
      variables: [
        {
          key: 'TOKEN',
          encrypted: true,
          secretKeyId: 'sec_abc',
          secret: { label: 'PROD_TOKEN' },
        },
        { key: 'PLAIN', value: 'ok', encrypted: false },
      ],
    });
    expect(parsed.variables).toEqual([
      { key: 'TOKEN', value: '', encrypted: true, secretKeyId: 'sec_abc' },
      { key: 'PLAIN', value: 'ok', encrypted: false },
    ]);
    expect(parsed.encryptedBindingHints).toEqual([
      {
        varKey: 'TOKEN',
        label: 'PROD_TOKEN',
        originSecretKeyId: 'sec_abc',
        labelFromFallback: false,
        ciphertext: null,
        salt: null,
      },
    ]);
    expect(parsed.payloadVersion).toBe(1);
    expect(parsed.warnings).toEqual([]);
  });

  it('falls back to varKey when only the legacy secretKeyId is present (old shape)', () => {
    const parsed = parseApicircleEnvironmentDoc({
      apicircleEnvironment: 1,
      name: 'dev',
      variables: [{ key: 'TOKEN', encrypted: true, secretKeyId: 'sec_legacy' }],
    });
    expect(parsed.variables).toEqual([
      { key: 'TOKEN', value: '', encrypted: true, secretKeyId: 'sec_legacy' },
    ]);
    expect(parsed.encryptedBindingHints).toEqual([
      {
        varKey: 'TOKEN',
        label: 'TOKEN',
        originSecretKeyId: 'sec_legacy',
        labelFromFallback: true,
        ciphertext: null,
        salt: null,
      },
    ]);
  });

  it('accepts a row that carries only secret.label (no secretKeyId)', () => {
    const parsed = parseApicircleEnvironmentDoc({
      apicircleEnvironment: 1,
      name: 'dev',
      variables: [{ key: 'TOKEN', encrypted: true, secret: { label: 'NEW_TOKEN' } }],
    });
    // Var lands with no secretKeyId — the destination assigns one when
    // the user provides a value (or the row stays unbound on skip).
    expect(parsed.variables).toEqual([
      { key: 'TOKEN', value: '', encrypted: true, secretKeyId: undefined },
    ]);
    expect(parsed.encryptedBindingHints).toEqual([
      {
        varKey: 'TOKEN',
        label: 'NEW_TOKEN',
        originSecretKeyId: undefined,
        labelFromFallback: false,
        ciphertext: null,
        salt: null,
      },
    ]);
  });

  it('demotes a truly dangling encrypted row (no id, no label) and warns', () => {
    const parsed = parseApicircleEnvironmentDoc({
      apicircleEnvironment: 1,
      name: 'dev',
      variables: [{ key: 'TOKEN', encrypted: true }],
    });
    expect(parsed.variables).toEqual([{ key: 'TOKEN', value: '', encrypted: false }]);
    expect(parsed.encryptedBindingHints).toEqual([]);
    expect(parsed.warnings).toHaveLength(1);
    expect(parsed.warnings[0]).toMatch(/TOKEN/);
    expect(parsed.warnings[0]).toMatch(/Re-bind/);
  });

  it('drops rows with no key and surfaces a warning per drop', () => {
    const parsed = parseApicircleEnvironmentDoc({
      apicircleEnvironment: 1,
      name: 'dev',
      variables: [
        { key: '', value: 'orphan', encrypted: false },
        { key: '   ', value: 'whitespace', encrypted: false },
        { key: 'KEEP', value: 'yes', encrypted: false },
      ],
    });
    expect(parsed.variables).toEqual([{ key: 'KEEP', value: 'yes', encrypted: false }]);
    expect(parsed.warnings).toHaveLength(2);
  });

  it('drops non-object rows', () => {
    const parsed = parseApicircleEnvironmentDoc({
      apicircleEnvironment: 1,
      name: 'dev',
      variables: ['nope', null, { key: 'OK', value: '1', encrypted: false }],
    });
    expect(parsed.variables).toEqual([{ key: 'OK', value: '1', encrypted: false }]);
    expect(parsed.warnings).toHaveLength(2);
  });

  it('coerces a non-string value to empty string on plain rows', () => {
    const parsed = parseApicircleEnvironmentDoc({
      apicircleEnvironment: 1,
      name: 'dev',
      variables: [{ key: 'BAD', value: 123, encrypted: false }],
    });
    expect(parsed.variables).toEqual([{ key: 'BAD', value: '', encrypted: false }]);
  });

  it('trims whitespace around the name', () => {
    const parsed = parseApicircleEnvironmentDoc({
      apicircleEnvironment: 1,
      name: '  dev  ',
      variables: [],
    });
    expect(parsed.name).toBe('dev');
  });

  it('throws for malformed JSON', () => {
    expect(() => parseApicircleEnvironment('not json')).toThrow(/Couldn't parse JSON/);
  });

  it('throws for an envelope that is not an API Circle environment', () => {
    expect(() => parseApicircleEnvironmentDoc({ format: 'apicircle.folder/v1' })).toThrow(
      /Unsupported format/,
    );
    expect(() => parseApicircleEnvironmentDoc({ apicircleEnvironment: 1 })).toThrow(
      /Unsupported format/,
    );
  });

  it('throws when the name is empty after trimming', () => {
    expect(() =>
      parseApicircleEnvironmentDoc({
        apicircleEnvironment: 1,
        name: '   ',
        variables: [],
      }),
    ).toThrow(/non-empty "name"/);
  });

  it('ignores secret.label that is not a non-empty string', () => {
    const parsed = parseApicircleEnvironmentDoc({
      apicircleEnvironment: 1,
      name: 'dev',
      variables: [
        // Empty label → fallback to varKey.
        { key: 'A', encrypted: true, secretKeyId: 'sec_a', secret: { label: '   ' } },
        // Wrong type → fallback to varKey.
        { key: 'B', encrypted: true, secretKeyId: 'sec_b', secret: { label: 42 } },
        // Missing secret object → fallback to varKey.
        { key: 'C', encrypted: true, secretKeyId: 'sec_c' },
      ],
    });
    expect(parsed.encryptedBindingHints.map((h) => h.label)).toEqual(['A', 'B', 'C']);
    expect(parsed.encryptedBindingHints.every((h) => h.labelFromFallback)).toBe(true);
  });

  describe('v2 envelope (ciphertext + salt carry)', () => {
    it('carries ciphertext into the variable value and exposes ciphertext + salt on the hint', () => {
      const parsed = parseApicircleEnvironmentDoc({
        apicircleEnvironment: 2,
        name: 'prod',
        variables: [
          {
            key: 'TOKEN',
            encrypted: true,
            value: 'enc:v1:AAAAAAAAAAAAAAAA:abc==',
            secretKeyId: 'sec_abc',
            secret: { label: 'PROD_TOKEN', salt: 'BBBBBBBBBBBBBBBBBBBBBB==' },
          },
        ],
      });
      expect(parsed.payloadVersion).toBe(2);
      expect(parsed.variables[0]).toEqual({
        key: 'TOKEN',
        value: 'enc:v1:AAAAAAAAAAAAAAAA:abc==',
        encrypted: true,
        secretKeyId: 'sec_abc',
      });
      expect(parsed.encryptedBindingHints[0]).toEqual({
        varKey: 'TOKEN',
        label: 'PROD_TOKEN',
        originSecretKeyId: 'sec_abc',
        labelFromFallback: false,
        ciphertext: 'enc:v1:AAAAAAAAAAAAAAAA:abc==',
        salt: 'BBBBBBBBBBBBBBBBBBBBBB==',
      });
    });

    it('degrades to v1-style (empty value, null ciphertext/salt) when v2 row omits ciphertext or salt', () => {
      // Defensive: a v2-flagged doc can still author rows without
      // ciphertext (e.g. a row that's bound but never had a value set).
      // The parser should accept it and not stall the rest of the import.
      const parsed = parseApicircleEnvironmentDoc({
        apicircleEnvironment: 2,
        name: 'prod',
        variables: [
          // No value field at all.
          { key: 'NO_VALUE', encrypted: true, secretKeyId: 'sec_a', secret: { label: 'A' } },
          // Non-encrypted-format value.
          {
            key: 'STALE_VALUE',
            encrypted: true,
            value: 'literal-not-ciphertext',
            secretKeyId: 'sec_b',
            secret: { label: 'B' },
          },
          // No salt.
          {
            key: 'NO_SALT',
            encrypted: true,
            value: 'enc:v1:iv:ct',
            secretKeyId: 'sec_c',
            secret: { label: 'C' },
          },
        ],
      });
      expect(parsed.payloadVersion).toBe(2);
      expect(parsed.variables.map((v) => v.value)).toEqual(['', '', 'enc:v1:iv:ct']);
      expect(parsed.encryptedBindingHints[0]).toMatchObject({ ciphertext: null, salt: null });
      expect(parsed.encryptedBindingHints[1]).toMatchObject({ ciphertext: null, salt: null });
      // Row with ciphertext but no salt: ciphertext lands, salt is null.
      expect(parsed.encryptedBindingHints[2]).toMatchObject({
        ciphertext: 'enc:v1:iv:ct',
        salt: null,
      });
    });

    it('still surfaces plain rows verbatim', () => {
      const parsed = parseApicircleEnvironmentDoc({
        apicircleEnvironment: 2,
        name: 'prod',
        variables: [{ key: 'API_BASE', value: 'https://api.example.com', encrypted: false }],
      });
      expect(parsed.payloadVersion).toBe(2);
      expect(parsed.variables).toEqual([
        { key: 'API_BASE', value: 'https://api.example.com', encrypted: false },
      ]);
      expect(parsed.encryptedBindingHints).toEqual([]);
    });
  });
});
