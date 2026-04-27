import { describe, expect, it } from 'vitest';
import { deleteSecretPayload, getSecretPayload, putSecretPayload } from './secrets';

describe('Secret Vault IDB store', () => {
  it('round-trips an encrypted payload', async () => {
    await putSecretPayload('s1', { iv: 'AAAA', ciphertext: 'BBBB' });
    expect(await getSecretPayload('s1')).toEqual({ iv: 'AAAA', ciphertext: 'BBBB' });
  });

  it('returns null for missing ids', async () => {
    expect(await getSecretPayload('nope')).toBeNull();
  });

  it('deleteSecretPayload removes the record', async () => {
    await putSecretPayload('s2', { iv: 'X', ciphertext: 'Y' });
    await deleteSecretPayload('s2');
    expect(await getSecretPayload('s2')).toBeNull();
  });
});
