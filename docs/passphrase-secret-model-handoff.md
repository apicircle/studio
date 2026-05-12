# Workspace Passphrase Secret Model — Continuation Notes

**Status:** Crypto primitive + prompt modal **landed**; state wiring **deferred**.
**Decision (2026-05-13):** Workspace passphrase derives the master key.
Encrypted secret values may sync across devices via git; only users who
know the passphrase can decrypt them. No recovery on lost passphrase.

## What landed in this pass

- **`packages/ui-components/src/persistence/passphraseKey.ts`** — pure
  KDF + verifier (PBKDF2-SHA-256, 600,000 iterations, 16-byte salt,
  AES-GCM 256-bit key). `initSecretCrypto(passphrase)` and
  `unlockSecretCrypto(passphrase, blob)` are the two entry points.
- **`packages/ui-components/src/persistence/passphraseKey.test.ts`** —
  5 tests covering round-trip, verifier mismatch, KDF version guard,
  empty-passphrase reject, salt uniqueness.
- **`packages/ui-components/src/onboarding/PassphrasePromptModal.tsx`** —
  presentational modal with `setup` and `unlock` modes; not yet mounted
  into App.tsx (no driver yet).
- **Secret Vault copy** updated to describe the passphrase model rather
  than device-local encryption.

## What ALSO landed in the second pass (2026-05-13)

- **`SecretCryptoMeta` type** added to `packages/shared/src/types.ts` and
  attached to `WorkspaceSynced.secretCrypto?: SecretCryptoMeta | null`.
- **Store state**: `secretKey: CryptoKey | null`,
  `secretLockState: 'unset' | 'locked' | 'unlocked'`,
  `lastSecretActivityAt: number | null` — all in-memory only, never
  persisted to IDB. Confirmed neither is included in any persistence
  path.
- **Store actions**: `setupPassphrase(p)`, `unlockWithPassphrase(p)`,
  `lockSecrets()`, `noteSecretActivity()` — all wired and ready for
  callers.
- **`PassphrasePromptModalGate`** mounted in `App.tsx`. Two render
  modes: lazy `setup` (default closed; flipped open by the "first
  secret added" flow when wired), and `unlock` (renders whenever
  `secretCrypto` is set and `lockState === 'locked'` and the gate is
  asked via `forceUnlock`).
- **15-minute idle-lock timer** inside the gate component. Ticks every
  minute; clears `secretKey` + flips `lockState` to `'locked'` once
  `Date.now() - lastSecretActivityAt >= 15 min`.

## What's left to wire (continuation checklist)

1. **Type addition:** add `secretCrypto: SecretCrypto | null` to
   `WorkspaceSynced` in `packages/shared/src/types.ts`. Default to `null`
   for fresh workspaces; populated by `initSecretCrypto` on the first
   user-supplied passphrase.

2. **Store state:** add to `WorkspaceStoreState` (non-persisted):

   ```ts
   secretPassphrase: string | null; // in memory only
   secretKey: CryptoKey | null; // derived; in memory only
   secretLockState: 'unset' | 'unlocked' | 'locked' | 'wrong-passphrase';
   ```

   Make sure neither field is included in `persist()`.

3. **Store actions:**
   - `setupPassphrase(p)` → calls `initSecretCrypto(p)`, writes
     `synced.secretCrypto`, stashes derived key + passphrase in memory.
   - `unlockWithPassphrase(p)` → calls `unlockSecretCrypto(p,
synced.secretCrypto)`, stashes derived key + passphrase. Returns
     `{ok, reason?}` so the modal can render the error inline.
   - `lockSecrets()` → clears in-memory state (for explicit "Lock now"
     or auto-lock-on-idle).

4. **Replace `getMasterKey()`** in
   `packages/ui-components/src/persistence/secretKey.ts`:
   - Remove the IDB JWK store + native bridge wrap entirely.
   - New body: read `secretKey` from the store. If `null`, throw a typed
     `SecretsLockedError`. Callers (encryption helpers, env-var
     resolvers) should catch this and surface the prompt.

5. **Mount the modal:**
   - In `App.tsx`, add `<PassphrasePromptModalGate />` near the existing
     `<MissingScopeGate />`. The gate reads
     `synced.secretCrypto + secretLockState` and decides whether to show
     `setup` mode (no crypto, user is about to add their first secret),
     `unlock` mode (crypto present, key not derived yet), or nothing.

6. **Onboarding-time decision:** when does the gate fire?
   - On workspace clone: if `synced.secretCrypto !== null` and the local
     store has no `secretKey`, fire the `unlock` modal immediately.
     `cancellable: false` — secrets are unreachable until unlocked.
   - On new-secret creation in a fresh workspace: if `synced.secretCrypto
=== null`, fire `setup` modal. `cancellable: true` — the user might
     just want a non-secret env var instead.

7. **Migration:** there are no installed users. Drop the
   `nativeSecretBridge` wrap path (`secretKey.ts`). Delete the old IDB
   store on first run if found (one-line guard in `getMasterKey`).
   Tests using `getMasterKey()` directly need a helper that seeds the
   in-memory derived key.

8. **Test retrofit:** roughly 30 store tests touch encrypted vars or
   Secret Vault entries. Add a helper:
   ```ts
   async function unlockTestWorkspace(passphrase = 't3st-passphrase') {
     await useWorkspaceStore.getState().setupPassphrase(passphrase);
   }
   ```
   Call this once per test that needs encrypted-value access. Trust the
   pre-launch freedom rule: rename / restructure tests rather than try
   to preserve every test's existing setup.

## Threat model & non-goals

- **In scope:** confidentiality of secret values on disk / over the
  wire (via git). Any teammate who knows the passphrase can decrypt.
- **Not in scope (yet):** passphrase rotation, multi-passphrase
  workspaces, per-environment passphrases, escrow / break-glass
  recovery. Those are all v1.x work after we have user signal.
- **Operational:** the passphrase is never written to disk by the app.
  Users storing the passphrase in a manager (1Password, Bitwarden, etc.)
  is the recommended team workflow — document this in the Secret Vault
  empty state when wiring lands.

## Estimated effort to complete the wiring

- ~0.5 day for type + store state + actions
- ~0.5 day for the mount gate + flow integration
- ~0.5 day for `getMasterKey` rewrite + dropping the device-bridge path
- ~0.5 day for test retrofit (the biggest unknown — likely closer to a full day if many tests need helper threading)

Total: **roughly 2 engineer-days** to land the full passphrase model.
The primitives shipped here are the load-bearing piece; everything else
is plumbing.
