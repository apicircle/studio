import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceStore } from './workspaceStore';
import { deleteSecretPayload } from '../persistence/secrets';

// Headline test for the secret-slot encryption model:
//   1. User creates a slot + provides a passphrase value.
//   2. User binds an env var to that slot — the var's plaintext is
//      encrypted under the slot's derived key, ciphertext lands in
//      `synced.environments.items[*].variables[*].value` as `enc:v1:`.
//   3. The synced doc is what would be pushed to Git. The local IDB
//      vault holds the slot's plaintext value (and only that).
//   4. Simulate a teammate cloning the repo: keep the synced doc but
//      wipe every local IDB vault payload (their device has nothing).
//   5. Teammate provides the same slot value via `provideSlotValue`.
//   6. Re-resolve and observe the env var's plaintext is recovered.
//
// This is the property that makes encrypted env vars useful at all — if
// it doesn't hold, the design has regressed.

describe('secret-slot encryption round-trip', () => {
  beforeEach(async () => {
    await act(async () => {
      await useWorkspaceStore.getState().hydrate();
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('encrypts on bind, persists ciphertext in synced, and decrypts after a fresh-device onboarding flow', async () => {
    let secretId = '';
    await act(async () => {
      useWorkspaceStore.getState().addEnvironment('prod');
      useWorkspaceStore.getState().setPriorityOrder([{ kind: 'local', name: 'prod' }]);
      useWorkspaceStore
        .getState()
        .setVariables('prod', [{ key: 'API_TOKEN', value: 'sk_live_abc123', encrypted: false }]);
      secretId = await useWorkspaceStore.getState().addSecret({
        label: 'TEAM_KEY',
        value: 'team-passphrase-v1',
        origin: 'workspace',
      });
      const ok = await useWorkspaceStore.getState().bindVariableToSecretKey('prod', 0, secretId);
      expect(ok).toBe(true);
    });

    // Synced doc invariants — what would land in Git.
    const syncedAfterBind = useWorkspaceStore.getState().synced!;
    const meta = syncedAfterBind.secretKeys?.[secretId];
    expect(meta).toBeDefined();
    expect(meta!.label).toBe('TEAM_KEY');
    expect(typeof meta!.salt).toBe('string');
    expect(meta!.salt.length).toBeGreaterThan(0);

    const boundVar = syncedAfterBind.environments.items.prod.variables[0];
    expect(boundVar.encrypted).toBe(true);
    expect(boundVar.secretKeyId).toBe(secretId);
    expect(boundVar.value.startsWith('enc:v1:')).toBe(true);
    // The plaintext must NOT appear in the synced doc.
    expect(JSON.stringify(syncedAfterBind)).not.toContain('sk_live_abc123');
    // The slot value must NOT appear in the synced doc either.
    expect(JSON.stringify(syncedAfterBind)).not.toContain('team-passphrase-v1');

    // Simulate a teammate cloning the repo: keep the synced doc, wipe the
    // local IDB vault payload for every slot (their device has nothing).
    await act(async () => {
      const local = useWorkspaceStore.getState().local!;
      for (const id of Object.keys(local.secretIndex.entries)) {
        await deleteSecretPayload(id);
      }
      // Drop the local index too — onboarding starts from synced + empty local.
      useWorkspaceStore.setState((s) => ({
        ...s,
        local: { ...local, secretIndex: { entries: {} } },
      }));
    });

    // Listing missing slots surfaces the gate the dock would show.
    const missing = await useWorkspaceStore.getState().listMissingSlots();
    expect(missing.map((m) => m.id)).toContain(secretId);

    // The teammate provides the same slot value.
    await act(async () => {
      const ok = await useWorkspaceStore
        .getState()
        .provideSlotValue(secretId, 'team-passphrase-v1');
      expect(ok).toBe(true);
    });

    // After onboarding, the local index entry exists again and the
    // missing-slots list is empty.
    expect(useWorkspaceStore.getState().local!.secretIndex.entries[secretId]).toBeDefined();
    const missingAfter = await useWorkspaceStore.getState().listMissingSlots();
    expect(missingAfter.map((m) => m.id)).not.toContain(secretId);

    // Decrypting the slot itself yields the original plaintext.
    const slotPlain = await useWorkspaceStore.getState().decryptSecret(secretId);
    expect(slotPlain).toBe('team-passphrase-v1');

    // And the env-var ciphertext decrypts back to its original plaintext —
    // unbind decrypts it back to plain at the row level, the cleanest probe.
    await act(async () => {
      const ok = await useWorkspaceStore.getState().unbindVariableSecretKey('prod', 0);
      expect(ok).toBe(true);
    });
    const recoveredVar = useWorkspaceStore.getState().synced!.environments.items.prod.variables[0];
    expect(recoveredVar.encrypted).toBe(false);
    expect(recoveredVar.secretKeyId).toBeUndefined();
    expect(recoveredVar.value).toBe('sk_live_abc123');
  });

  it('substitutes <MISSING:LABEL> when the slot value is unavailable on this device', async () => {
    let secretId = '';
    await act(async () => {
      useWorkspaceStore.getState().addEnvironment('prod');
      useWorkspaceStore.getState().setPriorityOrder([{ kind: 'local', name: 'prod' }]);
      useWorkspaceStore
        .getState()
        .setVariables('prod', [{ key: 'API_TOKEN', value: 'sk_live_xyz', encrypted: false }]);
      secretId = await useWorkspaceStore.getState().addSecret({
        label: 'TEAM_KEY',
        value: 'right-value',
        origin: 'workspace',
      });
      const ok = await useWorkspaceStore.getState().bindVariableToSecretKey('prod', 0, secretId);
      expect(ok).toBe(true);
    });

    // Simulate slot value unavailable.
    await act(async () => {
      const local = useWorkspaceStore.getState().local!;
      for (const id of Object.keys(local.secretIndex.entries)) {
        await deleteSecretPayload(id);
      }
      useWorkspaceStore.setState((s) => ({
        ...s,
        local: { ...local, secretIndex: { entries: {} } },
      }));
    });

    // Send a request that references the encrypted env var.
    const fetchMock = vi.fn(() => Promise.resolve(new Response('{}', { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);
    await act(async () => {
      const id = useWorkspaceStore.getState().addRequest(null);
      useWorkspaceStore.getState().setRequestUrl(id, 'https://example.test/?t={{API_TOKEN}}');
      useWorkspaceStore.getState().setActiveRequestId(id);
      await useWorkspaceStore.getState().executeActiveRequest();
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    const firstCall = fetchMock.mock.calls.at(0) as [unknown, RequestInit?] | undefined;
    const calledUrl = String(firstCall?.[0]);
    // <MISSING:TEAM_KEY> is what the user sees in the wire request — clear
    // signal that the slot value is missing on this device.
    expect(calledUrl).toContain('<MISSING:TEAM_KEY>');
    expect(calledUrl).not.toContain('sk_live_xyz');
  });

  it('records a decrypt-failed failure when the local slot value does not match the ciphertext', async () => {
    let secretId = '';
    await act(async () => {
      useWorkspaceStore.getState().addEnvironment('prod');
      useWorkspaceStore.getState().setPriorityOrder([{ kind: 'local', name: 'prod' }]);
      useWorkspaceStore
        .getState()
        .setVariables('prod', [{ key: 'API_TOKEN', value: 'sk_live_xyz', encrypted: false }]);
      secretId = await useWorkspaceStore.getState().addSecret({
        label: 'TEAM_KEY',
        value: 'real-passphrase',
        origin: 'workspace',
      });
      const ok = await useWorkspaceStore.getState().bindVariableToSecretKey('prod', 0, secretId);
      expect(ok).toBe(true);
    });

    // Replace the slot value with a wrong one — slot is present, but
    // ciphertext won't decrypt under it. This is the case the banner is
    // designed to surface (different from "slot value missing entirely",
    // which the Vault gate already covers).
    await act(async () => {
      await useWorkspaceStore.getState().provideSlotValue(secretId, 'WRONG-value');
    });

    // Execute a request that references the encrypted var. The resolver
    // runs decryptEnvironments → populates envDecryptFailures.
    const fetchMock = vi.fn(() => Promise.resolve(new Response('{}', { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);
    await act(async () => {
      const id = useWorkspaceStore.getState().addRequest(null);
      useWorkspaceStore.getState().setRequestUrl(id, 'https://example.test/?t={{API_TOKEN}}');
      useWorkspaceStore.getState().setActiveRequestId(id);
      await useWorkspaceStore.getState().executeActiveRequest();
    });

    const failures = useWorkspaceStore.getState().envDecryptFailures;
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      envName: 'prod',
      varKey: 'API_TOKEN',
      secretKeyId: secretId,
      label: 'TEAM_KEY',
      reason: 'decrypt-failed',
    });

    // Banner state clears when the user dismisses it.
    act(() => {
      useWorkspaceStore.getState().clearEnvDecryptFailures();
    });
    expect(useWorkspaceStore.getState().envDecryptFailures).toEqual([]);
  });

  it('unbind refuses on decrypt failure by default, force-unbind clears the value', async () => {
    let secretId = '';
    await act(async () => {
      useWorkspaceStore.getState().addEnvironment('prod');
      useWorkspaceStore.getState().setPriorityOrder([{ kind: 'local', name: 'prod' }]);
      useWorkspaceStore
        .getState()
        .setVariables('prod', [{ key: 'API_TOKEN', value: 'sk_live_abc', encrypted: false }]);
      secretId = await useWorkspaceStore.getState().addSecret({
        label: 'TEAM_KEY',
        value: 'real-passphrase',
        origin: 'workspace',
      });
      const ok = await useWorkspaceStore.getState().bindVariableToSecretKey('prod', 0, secretId);
      expect(ok).toBe(true);
    });

    // Simulate the post-pull state where this device DOES have a slot
    // value but it's the wrong one — i.e. the ciphertext won't decrypt.
    // Replace the slot entry with a different plaintext via removeSecret +
    // addSecret reusing nothing — easier: poke the IDB payload directly via
    // re-adding under the same id. We just clear it and re-add a different
    // value through the existing slot row.
    await act(async () => {
      await useWorkspaceStore.getState().provideSlotValue(secretId, 'WRONG-value');
    });

    // Default unbind refuses.
    await act(async () => {
      const ok = await useWorkspaceStore.getState().unbindVariableSecretKey('prod', 0);
      expect(ok).toBe(false);
    });
    // Row should still be encrypted and unchanged.
    const afterRefuse = useWorkspaceStore.getState().synced!.environments.items.prod.variables[0];
    expect(afterRefuse.encrypted).toBe(true);
    expect(afterRefuse.secretKeyId).toBe(secretId);
    expect(afterRefuse.value.startsWith('enc:v1:')).toBe(true);

    // Force unbind clears the value to empty and drops the binding.
    await act(async () => {
      const ok = await useWorkspaceStore
        .getState()
        .unbindVariableSecretKey('prod', 0, { force: true });
      expect(ok).toBe(true);
    });
    const afterForce = useWorkspaceStore.getState().synced!.environments.items.prod.variables[0];
    expect(afterForce.encrypted).toBe(false);
    expect(afterForce.secretKeyId).toBeUndefined();
    expect(afterForce.value).toBe('');
    expect(afterForce.key).toBe('API_TOKEN');
  });
});
