// Pure store-level tests for importApicircleEnvironment's hint-resolution
// logic. Drives the live Zustand store after hydration (the action depends
// on synced + local) and asserts the workspace-side state at the end.
//
// Together with apicircleEnvironment.test.ts (parser) and
// ImportModal.test.tsx (UI dispatch + bind step), this gives line +
// branch coverage of the encrypted-binding resolution path.

import { act } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ParsedApicircleEnvironment } from '@apicircle/core';
import { useWorkspaceStore } from './workspaceStore';

async function hydrate(): Promise<void> {
  await act(async () => {
    await useWorkspaceStore.getState().hydrate();
  });
}

function buildParsed(overrides: Partial<ParsedApicircleEnvironment>): ParsedApicircleEnvironment {
  // Default to v1 envelope shape — most legacy tests probe the
  // "no ciphertext, no salt" import path. v2-specific tests override
  // `payloadVersion` + populate `ciphertext` / `salt` on the hints.
  return {
    name: 'dev',
    variables: [],
    encryptedBindingHints: [],
    payloadVersion: 1,
    warnings: [],
    ...overrides,
  };
}

describe('importApicircleEnvironment hint resolution', () => {
  beforeEach(hydrate);

  it('lands plain vars into a fresh env and returns no pending bindings', () => {
    const out = useWorkspaceStore.getState().importApicircleEnvironment(
      buildParsed({
        name: 'plain-only',
        variables: [
          { key: 'A', value: '1', encrypted: false },
          { key: 'B', value: '2', encrypted: false },
        ],
      }),
    );
    expect(out).not.toBeNull();
    expect(out!.name).toBe('plain-only');
    expect(out!.pendingBindings).toEqual([]);
    expect(out!.warnings).toEqual([]);

    const env = useWorkspaceStore.getState().synced!.environments.items['plain-only']!;
    expect(env.variables).toEqual([
      { key: 'A', value: '1', encrypted: false },
      { key: 'B', value: '2', encrypted: false },
    ]);
  });

  it('uniquifies the name on collision and reports the renamed env', () => {
    useWorkspaceStore.getState().addEnvironment('dup');
    const out = useWorkspaceStore
      .getState()
      .importApicircleEnvironment(
        buildParsed({ name: 'dup', variables: [{ key: 'X', value: 'y', encrypted: false }] }),
      );
    expect(out!.name).toBe('dup (2)');
    expect(useWorkspaceStore.getState().synced!.environments.items['dup (2)']).toBeDefined();
    // Source still intact.
    expect(useWorkspaceStore.getState().synced!.environments.items['dup']).toBeDefined();
  });

  it('reuses an existing slot when originSecretKeyId matches (same-workspace re-import)', () => {
    // Seed a slot directly into synced.secretKeys so we can simulate a
    // same-workspace re-import without going through addSecret (which
    // requires the web vault passphrase + master key).
    const synced = useWorkspaceStore.getState().synced!;
    useWorkspaceStore.setState({
      synced: {
        ...synced,
        secretKeys: {
          ...(synced.secretKeys ?? {}),
          sec_origin: {
            id: 'sec_origin',
            label: 'PROD_TOKEN',
            salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
            createdAt: '2026-06-02T00:00:00.000Z',
          },
        },
      },
    });

    const out = useWorkspaceStore.getState().importApicircleEnvironment(
      buildParsed({
        name: 'same-ws',
        variables: [{ key: 'TOKEN', value: '', encrypted: true, secretKeyId: 'sec_origin' }],
        encryptedBindingHints: [
          {
            varKey: 'TOKEN',
            label: 'PROD_TOKEN',
            originSecretKeyId: 'sec_origin',
            labelFromFallback: false,
            ciphertext: null,
            salt: null,
          },
        ],
      }),
    );
    expect(out!.pendingBindings).toEqual([]);
    const env = useWorkspaceStore.getState().synced!.environments.items['same-ws']!;
    expect(env.variables[0]).toMatchObject({
      key: 'TOKEN',
      encrypted: true,
      secretKeyId: 'sec_origin',
    });
  });

  it('re-points secretKeyId to a destination slot when the label matches', () => {
    const synced = useWorkspaceStore.getState().synced!;
    useWorkspaceStore.setState({
      synced: {
        ...synced,
        secretKeys: {
          ...(synced.secretKeys ?? {}),
          sec_dest: {
            id: 'sec_dest',
            label: 'PROD_TOKEN',
            salt: 'BBBBBBBBBBBBBBBBBBBBBB==',
            createdAt: '2026-06-02T00:00:00.000Z',
          },
        },
      },
    });

    const out = useWorkspaceStore.getState().importApicircleEnvironment(
      buildParsed({
        name: 'cross-ws',
        variables: [
          // The source's id sec_origin is meaningless on this workspace —
          // the importer should re-point to sec_dest via the label match.
          { key: 'TOKEN', value: '', encrypted: true, secretKeyId: 'sec_origin' },
        ],
        encryptedBindingHints: [
          {
            varKey: 'TOKEN',
            label: 'PROD_TOKEN',
            originSecretKeyId: 'sec_origin',
            labelFromFallback: false,
            ciphertext: null,
            salt: null,
          },
        ],
      }),
    );
    expect(out!.pendingBindings).toEqual([]);
    const env = useWorkspaceStore.getState().synced!.environments.items['cross-ws']!;
    expect(env.variables[0]).toMatchObject({
      key: 'TOKEN',
      encrypted: true,
      secretKeyId: 'sec_dest',
    });
  });

  it('surfaces a pendingBinding when neither id nor label match', () => {
    const out = useWorkspaceStore.getState().importApicircleEnvironment(
      buildParsed({
        name: 'unbound',
        variables: [{ key: 'TOKEN', value: '', encrypted: true, secretKeyId: 'sec_unknown' }],
        encryptedBindingHints: [
          {
            varKey: 'TOKEN',
            label: 'NEW_TOKEN',
            originSecretKeyId: 'sec_unknown',
            labelFromFallback: false,
            ciphertext: null,
            salt: null,
          },
        ],
      }),
    );
    expect(out!.pendingBindings).toEqual([
      {
        envName: 'unbound',
        varKey: 'TOKEN',
        label: 'NEW_TOKEN',
        labelFromFallback: false,
      },
    ]);
    const env = useWorkspaceStore.getState().synced!.environments.items['unbound']!;
    // Variable lands with the source's id — the env-panel chip still
    // renders something, and the user can re-bind via the second step
    // or the row's slot picker.
    expect(env.variables[0]).toMatchObject({
      key: 'TOKEN',
      encrypted: true,
      secretKeyId: 'sec_unknown',
    });
  });

  describe('v2 envelope (ciphertext + salt carry)', () => {
    it('reuses a destination slot when label AND salt match the source', () => {
      const synced = useWorkspaceStore.getState().synced!;
      useWorkspaceStore.setState({
        synced: {
          ...synced,
          secretKeys: {
            ...(synced.secretKeys ?? {}),
            sec_dest: {
              id: 'sec_dest',
              label: 'PROD_TOKEN',
              salt: 'SHARED-SALT==',
              createdAt: '2026-06-02T00:00:00.000Z',
            },
          },
        },
      });

      const out = useWorkspaceStore.getState().importApicircleEnvironment(
        buildParsed({
          name: 'v2-match',
          payloadVersion: 2,
          variables: [
            {
              key: 'TOKEN',
              value: 'enc:v1:AAAAAAAAAAAAAAAA:abc==',
              encrypted: true,
              secretKeyId: 'sec_origin',
            },
          ],
          encryptedBindingHints: [
            {
              varKey: 'TOKEN',
              label: 'PROD_TOKEN',
              originSecretKeyId: 'sec_origin',
              labelFromFallback: false,
              ciphertext: 'enc:v1:AAAAAAAAAAAAAAAA:abc==',
              salt: 'SHARED-SALT==',
            },
          ],
        }),
      );
      expect(out!.pendingBindings).toEqual([]);
      const env = useWorkspaceStore.getState().synced!.environments.items['v2-match']!;
      expect(env.variables[0]).toMatchObject({
        key: 'TOKEN',
        encrypted: true,
        secretKeyId: 'sec_dest', // re-pointed via label+salt match
        value: 'enc:v1:AAAAAAAAAAAAAAAA:abc==', // ciphertext preserved
      });
    });

    it('mints a new destination slot when the salts differ, preserving the ciphertext', () => {
      // Destination has a same-label slot but with a different salt. The
      // source's ciphertext was encrypted under the source's salt, so
      // reusing the destination slot would silently produce undecryptable
      // rows. Mint a new slot with the source's salt + label.
      const synced = useWorkspaceStore.getState().synced!;
      useWorkspaceStore.setState({
        synced: {
          ...synced,
          secretKeys: {
            ...(synced.secretKeys ?? {}),
            sec_dest_collision: {
              id: 'sec_dest_collision',
              label: 'PROD_TOKEN',
              salt: 'DIFFERENT-SALT==',
              createdAt: '2026-06-02T00:00:00.000Z',
            },
          },
        },
      });
      const slotsBefore = Object.keys(useWorkspaceStore.getState().synced!.secretKeys ?? {}).length;

      const out = useWorkspaceStore.getState().importApicircleEnvironment(
        buildParsed({
          name: 'v2-mismatched-salt',
          payloadVersion: 2,
          variables: [
            {
              key: 'TOKEN',
              value: 'enc:v1:IIIIIIIIIIIIIIII:xyz==',
              encrypted: true,
              secretKeyId: 'sec_source_only',
            },
          ],
          encryptedBindingHints: [
            {
              varKey: 'TOKEN',
              label: 'PROD_TOKEN',
              originSecretKeyId: 'sec_source_only',
              labelFromFallback: false,
              ciphertext: 'enc:v1:IIIIIIIIIIIIIIII:xyz==',
              salt: 'SOURCE-SALT==',
            },
          ],
        }),
      );

      expect(out!.pendingBindings).toEqual([]);
      // A new slot got minted using the source's salt and label.
      const slotsAfter = useWorkspaceStore.getState().synced!.secretKeys ?? {};
      expect(Object.keys(slotsAfter).length).toBe(slotsBefore + 1);
      const minted = Object.values(slotsAfter).find((s) => s.salt === 'SOURCE-SALT==');
      expect(minted).toBeDefined();
      expect(minted!.label).toBe('PROD_TOKEN');
      // ID is preferred from source's originSecretKeyId since it doesn't
      // collide with anything pre-existing.
      expect(minted!.id).toBe('sec_source_only');
      // Warning surfaced for the missing-slots gate handoff.
      expect(out!.warnings.some((w) => /Imported 1 new Secret Vault slot/.test(w))).toBe(true);

      const env = useWorkspaceStore.getState().synced!.environments.items['v2-mismatched-salt']!;
      expect(env.variables[0]).toMatchObject({
        key: 'TOKEN',
        encrypted: true,
        secretKeyId: 'sec_source_only',
        value: 'enc:v1:IIIIIIIIIIIIIIII:xyz==',
      });
    });

    it('generates a fresh id when the source originSecretKeyId collides with an unrelated destination slot', () => {
      const synced = useWorkspaceStore.getState().synced!;
      useWorkspaceStore.setState({
        synced: {
          ...synced,
          secretKeys: {
            ...(synced.secretKeys ?? {}),
            sec_already_taken: {
              id: 'sec_already_taken',
              label: 'OTHER_THING',
              salt: 'WHATEVER==',
              createdAt: '2026-06-02T00:00:00.000Z',
            },
          },
        },
      });

      const out = useWorkspaceStore.getState().importApicircleEnvironment(
        buildParsed({
          name: 'v2-collision',
          payloadVersion: 2,
          variables: [
            {
              key: 'TOKEN',
              value: 'enc:v1:JJJJJJJJJJJJJJJJ:zzz==',
              encrypted: true,
              secretKeyId: 'sec_already_taken',
            },
          ],
          encryptedBindingHints: [
            {
              varKey: 'TOKEN',
              label: 'NEW_LABEL',
              originSecretKeyId: 'sec_already_taken',
              labelFromFallback: false,
              ciphertext: 'enc:v1:JJJJJJJJJJJJJJJJ:zzz==',
              salt: 'NEW-SALT==',
            },
          ],
        }),
      );
      expect(out!.pendingBindings).toEqual([]);
      const env = useWorkspaceStore.getState().synced!.environments.items['v2-collision']!;
      // The variable now points at a freshly-minted id (NOT the colliding one).
      expect(env.variables[0].secretKeyId).not.toBe('sec_already_taken');
      // The colliding slot is untouched — its salt and label are intact.
      const taken = useWorkspaceStore.getState().synced!.secretKeys?.['sec_already_taken'];
      expect(taken?.salt).toBe('WHATEVER==');
      expect(taken?.label).toBe('OTHER_THING');
    });
  });

  it('returns parser warnings verbatim', () => {
    const out = useWorkspaceStore.getState().importApicircleEnvironment(
      buildParsed({
        name: 'warned',
        warnings: ['Row #2 had no key — dropped.'],
        variables: [{ key: 'A', value: '1', encrypted: false }],
      }),
    );
    expect(out!.warnings).toEqual(['Row #2 had no key — dropped.']);
  });

  it('returns null when no synced doc is loaded', () => {
    useWorkspaceStore.setState({ synced: null });
    const out = useWorkspaceStore.getState().importApicircleEnvironment(buildParsed({ name: 'x' }));
    expect(out).toBeNull();
  });
});
