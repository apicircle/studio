import { describe, expect, it } from 'vitest';
import type { Environment } from '@apicircle/shared';
import {
  describeEncryptionKeyReference,
  encryptionKeyRefusal,
  findEncryptionKeys,
} from './encryptionKeys';

const env = (name: string, variables: Environment['variables']): Environment =>
  ({ name, variables }) as Environment;

describe('findEncryptionKeys', () => {
  it('maps each slot that encrypts variables to the variables it encrypts', () => {
    const keys = findEncryptionKeys({
      slotLabels: { s1: 'ADMIN_TOKEN_KEY', s2: 'UNUSED_SLOT' },
      environments: [
        {
          Staging: env('Staging', [
            { key: 'ADMIN_TOKEN', value: 'enc:v1:a:b', encrypted: true, secretKeyId: 's1' },
            { key: 'BASE_URL', value: 'https://x', encrypted: false },
          ]),
          Prod: env('Prod', [
            { key: 'REFRESH_TOKEN', value: 'enc:v1:c:d', encrypted: true, secretKeyId: 's1' },
            { key: 'ADMIN_TOKEN', value: 'enc:v1:e:f', encrypted: true, secretKeyId: 's1' },
          ]),
        },
      ],
    });
    expect(keys).toEqual({ ADMIN_TOKEN_KEY: ['ADMIN_TOKEN', 'REFRESH_TOKEN'] });
  });

  it('reads every environment set it is given', () => {
    const keys = findEncryptionKeys({
      slotLabels: { own: 'OWN_KEY', linked: 'LINKED_KEY' },
      environments: [
        { A: env('A', [{ key: 'X', value: 'c', encrypted: true, secretKeyId: 'own' }]) },
        { B: env('B', [{ key: 'Y', value: 'c', encrypted: true, secretKeyId: 'linked' }]) },
      ],
    });
    expect(keys).toEqual({ OWN_KEY: ['X'], LINKED_KEY: ['Y'] });
  });

  it('skips plain rows, rows with no slot or key, and slots with no label', () => {
    const keys = findEncryptionKeys({
      slotLabels: { s1: 'K1', blank: '' },
      environments: [
        {
          A: env('A', [
            // Not encrypted, though it names a slot.
            { key: 'P', value: 'v', encrypted: false, secretKeyId: 's1' },
            // Encrypted with no slot (legacy master-key row).
            { key: 'L', value: 'c', encrypted: true },
            // An unnamed row.
            { key: '', value: 'c', encrypted: true, secretKeyId: 's1' },
            // A slot this device has no label for.
            { key: 'U', value: 'c', encrypted: true, secretKeyId: 'unknown' },
            // A slot whose label is empty.
            { key: 'B', value: 'c', encrypted: true, secretKeyId: 'blank' },
          ]),
        },
      ],
    });
    expect(keys).toEqual({});
  });

  it('does not treat a prototype name as a slot id', () => {
    const keys = findEncryptionKeys({
      slotLabels: {},
      environments: [
        { A: env('A', [{ key: 'X', value: 'c', encrypted: true, secretKeyId: 'toString' }]) },
      ],
    });
    expect(keys).toEqual({});
  });
});

describe('describeEncryptionKeyReference', () => {
  it('names the one variable and says what to write', () => {
    expect(describeEncryptionKeyReference('ADMIN_TOKEN_KEY', ['ADMIN_TOKEN'])).toBe(
      '{{ADMIN_TOKEN_KEY}} is the encryption key of ADMIN_TOKEN, not a variable, so its value ' +
        'is never sent. Write {{ADMIN_TOKEN}} to send the variable.',
    );
  });

  it('lists two variables with "and" / "or"', () => {
    expect(describeEncryptionKeyReference('K', ['A', 'B'])).toBe(
      '{{K}} is the encryption key of A and B, not a variable, so its value is never sent. ' +
        'Write {{A}} or {{B}} to send one of the variables.',
    );
  });

  it('lists three variables with commas', () => {
    const text = describeEncryptionKeyReference('K', ['A', 'B', 'C']);
    expect(text).toContain('the encryption key of A, B and C,');
    expect(text).toContain('Write {{A}}, {{B}} or {{C}}');
  });

  it('still says it is a key when no variable is known', () => {
    expect(describeEncryptionKeyReference('K', [])).toBe(
      '{{K}} is an encryption key, not a variable, so its value is never sent.',
    );
  });
});

describe('encryptionKeyRefusal', () => {
  it('starts with "Not sent." and describes every key', () => {
    const msg = encryptionKeyRefusal(['K1', 'K2'], { K1: ['A'], K2: ['B'] });
    expect(msg.startsWith('Not sent. {{K1}} is the encryption key of A,')).toBe(true);
    expect(msg).toContain('{{K2}} is the encryption key of B,');
  });

  it('copes with a label missing from the map', () => {
    expect(encryptionKeyRefusal(['K'], {})).toBe(
      'Not sent. {{K}} is an encryption key, not a variable, so its value is never sent.',
    );
  });
});
