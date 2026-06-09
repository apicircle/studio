import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Cross-phase R2-G7: PBKDF2 with 1.2M iterations is intentionally slow
// (the OWASP-floor for the production passphrase model). Under standalone
// runs these tests take ~2s each; under the monorepo's parallel pool the
// CPU contention can push individual tests past Vitest's default 5s
// timeout. Bumping the per-file timeout to 30s keeps the tests reliable
// in CI without compromising the production iteration count. Standalone
// duration is unaffected.
vi.setConfig({ testTimeout: 30_000 });
import type { Mock } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { Uri, window, env, commands } from '../mocks/vscode';
import type * as vscode from 'vscode';
import { VsCodeBridge } from '../../src/host/vscodeBridge';
import { VsCodeVaultManager } from '../../src/host/vaultManager';
import {
  unlockVaultCommand,
  lockVaultCommand,
  setupVaultPassphraseCommand,
  openVaultEntryCommand,
  changeVaultPassphraseCommand,
} from '../../src/commands/vaultActions';

// =============================================================================
// End-to-end vault flow: setup → unlock → encrypted-variable reveal.
//
// Drives the real VsCodeBridge against an on-disk workspace, real
// VsCodeVaultManager (real WebCrypto), and the same command surfaces the
// extension wires in package.json. Mocks only `window.show*` for input/UX.
// =============================================================================

function makeMockContext(globalStoragePath: string) {
  const state = new Map<string, unknown>();
  return {
    subscriptions: [],
    globalState: {
      get: <T>(key: string, defaultValue?: T) =>
        state.has(key) ? (state.get(key) as T) : defaultValue,
      update: async (key: string, value: unknown) => {
        state.set(key, value);
      },
      keys: () => Array.from(state.keys()),
    },
    workspaceState: { get: () => undefined, update: async () => undefined, keys: () => [] },
    secrets: {
      get: async () => undefined,
      store: async () => undefined,
      delete: async () => undefined,
    },
    globalStorageUri: Uri.file(globalStoragePath),
    storageUri: undefined,
    extensionUri: Uri.file('/ext'),
    extensionPath: '/ext',
    asAbsolutePath: (rel: string) => path.join('/ext', rel),
    extensionMode: 3,
  } as never;
}

function seedEmpty(apicircleDir: string): void {
  fs.mkdirSync(apicircleDir, { recursive: true });
  fs.writeFileSync(
    path.join(apicircleDir, 'workspace.json'),
    JSON.stringify({
      schemaVersion: 1,
      workspaceId: 'vault-it',
      collections: { tree: { id: 'root', type: 'root', children: [] }, requests: {}, folders: {} },
      environments: {
        items: {
          dev: {
            name: 'dev',
            variables: [],
          },
        },
        activeName: 'dev',
        priorityOrder: [],
      },
      linkedWorkspaces: {},
      linkedOverrides: { requests: {}, environmentVars: {} },
      releases: { self: null, perLink: {} },
      globalAssets: { schemas: {}, graphql: {}, files: {} },
      mockServers: {},
      executionPlans: {},
      secretKeys: {},
      secretCrypto: null,
      meta: { createdAt: '2026-01-01', updatedAt: '2026-01-01', appVersion: '0.1.0' },
    }),
  );
}

describe('vault unlock + reveal (integration)', () => {
  let tmp: string;
  let bridge: VsCodeBridge;
  let vault: VsCodeVaultManager;
  let apicircleDir: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-it-'));
    apicircleDir = path.join(tmp, '.apicircle');
    seedEmpty(apicircleDir);
    bridge = new VsCodeBridge(makeMockContext(path.join(tmp, 'globalStorage')));
    vault = new VsCodeVaultManager();
    bridge.registerWorkspace({
      id: apicircleDir,
      apicircleDir,
      workspaceJsonPath: path.join(apicircleDir, 'workspace.json'),
      workspaceFolder: { uri: Uri.file(tmp), name: 't', index: 0 } as never,
      label: 't',
    });
    bridge.setActive(apicircleDir);
    // Reset mocks that other suites might have touched.
    (window.showInputBox as Mock).mockReset();
    (window.showInformationMessage as Mock).mockReset();
    (window.showWarningMessage as Mock).mockReset();
    (window.showErrorMessage as Mock).mockReset();
    (env.clipboard.writeText as Mock).mockReset();
    (env.clipboard.readText as Mock).mockReset();
    (commands.executeCommand as Mock).mockReset();
  });

  afterEach(() => {
    vault.lockAll();
    bridge.dispose();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('setup → persists secretCrypto + unlocks the vault', async () => {
    (window.showInputBox as Mock)
      .mockResolvedValueOnce('passphrase123') // initial
      .mockResolvedValueOnce('passphrase123'); // confirm

    await setupVaultPassphraseCommand({ bridge, vault });

    const state = await bridge.activeWorkspace()!.read();
    expect(state.synced.secretCrypto).not.toBeNull();
    expect(state.synced.secretCrypto?.kdf).toBe('pbkdf2-sha256-v1');
    expect(vault.isUnlocked(apicircleDir)).toBe(true);
  });

  it('setup → restart-style fresh manager → unlock with same passphrase works', async () => {
    (window.showInputBox as Mock).mockResolvedValueOnce('hunter2').mockResolvedValueOnce('hunter2');
    await setupVaultPassphraseCommand({ bridge, vault });
    // Simulate a fresh extension reload — drop the cached key, keep the
    // workspace on disk.
    vault.lockAll();
    expect(vault.isUnlocked(apicircleDir)).toBe(false);

    (window.showInputBox as Mock).mockReset();
    (window.showInputBox as Mock).mockResolvedValueOnce('hunter2');
    await unlockVaultCommand({ bridge, vault });
    expect(vault.isUnlocked(apicircleDir)).toBe(true);
  });

  it('unlock with the wrong passphrase surfaces an error and leaves vault locked', async () => {
    (window.showInputBox as Mock).mockResolvedValueOnce('correct').mockResolvedValueOnce('correct');
    await setupVaultPassphraseCommand({ bridge, vault });
    vault.lockAll();
    (window.showInputBox as Mock).mockReset();
    (window.showInputBox as Mock).mockResolvedValueOnce('WRONG');
    await unlockVaultCommand({ bridge, vault });
    expect(vault.isUnlocked(apicircleDir)).toBe(false);
    expect(window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringMatching(/Failed to unlock vault/i),
    );
  });

  it('open vault entry decrypts an encrypted variable and offers Copy to Clipboard', async () => {
    // Setup vault + unlock
    (window.showInputBox as Mock).mockResolvedValueOnce('pp').mockResolvedValueOnce('pp');
    await setupVaultPassphraseCommand({ bridge, vault });
    // Encrypt a value and persist it in an env var.
    const wire = await vault.encryptValue(apicircleDir, 'my-real-secret');
    const active = bridge.activeWorkspace()!;
    const state = await active.read();
    await active.apply({
      kind: 'environment.upsert',
      environment: {
        ...state.synced.environments.items.dev,
        variables: [
          {
            key: 'API_KEY',
            value: wire,
            encrypted: true,
            secretKeyId: 'ck_api',
          },
        ],
      },
    });

    // Reveal flow: chose "Copy to Clipboard"
    (window.showInformationMessage as Mock).mockReset();
    (window.showInformationMessage as Mock).mockResolvedValueOnce('Copy to Clipboard');
    (window.showInformationMessage as Mock).mockResolvedValueOnce(undefined); // toast

    await openVaultEntryCommand(
      { bridge, vault },
      { clipboardClearSeconds: 0 },
      { kind: 'variable-encrypted', envName: 'dev', key: 'API_KEY' },
    );

    expect(env.clipboard.writeText).toHaveBeenCalledWith('my-real-secret');
  });

  it('open vault entry on a locked vault prompts to unlock, then reveals', async () => {
    (window.showInputBox as Mock).mockResolvedValueOnce('pp').mockResolvedValueOnce('pp');
    await setupVaultPassphraseCommand({ bridge, vault });
    const wire = await vault.encryptValue(apicircleDir, 'top-secret');
    const active = bridge.activeWorkspace()!;
    const state = await active.read();
    await active.apply({
      kind: 'environment.upsert',
      environment: {
        ...state.synced.environments.items.dev,
        variables: [{ key: 'T', value: wire, encrypted: true, secretKeyId: 'ck_t' }],
      },
    });
    vault.lockAll();

    (window.showInformationMessage as Mock).mockReset();
    (window.showInputBox as Mock).mockReset();
    // First info message: "Vault is locked. Unlock?" → user clicks Unlock
    (window.showInformationMessage as Mock).mockResolvedValueOnce('Unlock');
    // unlockVault input prompt:
    (window.showInputBox as Mock).mockResolvedValueOnce('pp');
    // info after successful unlock:
    (window.showInformationMessage as Mock).mockResolvedValueOnce(undefined);
    // reveal action picker:
    (window.showInformationMessage as Mock).mockResolvedValueOnce('Copy to Clipboard');
    (window.showInformationMessage as Mock).mockResolvedValueOnce(undefined);

    await openVaultEntryCommand(
      { bridge, vault },
      { clipboardClearSeconds: 0 },
      { kind: 'variable-encrypted', envName: 'dev', key: 'T' },
    );

    expect(vault.isUnlocked(apicircleDir)).toBe(true);
    expect(env.clipboard.writeText).toHaveBeenCalledWith('top-secret');
  });

  it('open vault entry on a non-encrypted variable routes to editVariableValue', async () => {
    const active = bridge.activeWorkspace()!;
    const state = await active.read();
    await active.apply({
      kind: 'environment.upsert',
      environment: {
        ...state.synced.environments.items.dev,
        variables: [{ key: 'PLAIN', value: 'plain-val', encrypted: false }],
      },
    });
    await openVaultEntryCommand(
      { bridge, vault },
      { clipboardClearSeconds: 0 },
      { kind: 'variable-encrypted', envName: 'dev', key: 'PLAIN' },
    );
    expect(commands.executeCommand).toHaveBeenCalledWith(
      'apicircle.editVariableValue',
      expect.objectContaining({ key: 'PLAIN' }),
    );
  });

  it('lockVaultCommand with no active surface is a no-op safe call', () => {
    // No setup → vault never unlocked → lock just shows the "already locked" toast.
    lockVaultCommand({ bridge, vault });
    expect(vault.isUnlocked(apicircleDir)).toBe(false);
  });

  it('clipboard auto-clear fires when secret is still on clipboard', async () => {
    vi.useFakeTimers();
    try {
      (env.clipboard.readText as Mock).mockResolvedValueOnce('the-secret');
      (window.showInputBox as Mock).mockResolvedValueOnce('pp').mockResolvedValueOnce('pp');
      await setupVaultPassphraseCommand({ bridge, vault });
      const wire = await vault.encryptValue(apicircleDir, 'the-secret');
      const active = bridge.activeWorkspace()!;
      const state = await active.read();
      await active.apply({
        kind: 'environment.upsert',
        environment: {
          ...state.synced.environments.items.dev,
          variables: [{ key: 'T', value: wire, encrypted: true, secretKeyId: 'ck_t' }],
        },
      });
      (window.showInformationMessage as Mock).mockReset();
      (window.showInformationMessage as Mock).mockResolvedValueOnce('Copy to Clipboard');
      (window.showInformationMessage as Mock).mockResolvedValueOnce(undefined);

      await openVaultEntryCommand(
        { bridge, vault },
        { clipboardClearSeconds: 5 },
        { kind: 'variable-encrypted', envName: 'dev', key: 'T' },
      );
      expect(env.clipboard.writeText).toHaveBeenLastCalledWith('the-secret');

      // Advance fake timers past 5s.
      await vi.advanceTimersByTimeAsync(5_500);

      // The clear path runs as a fire-and-forget async; flush microtasks.
      await Promise.resolve();
      await Promise.resolve();
      expect(env.clipboard.writeText).toHaveBeenCalledWith('');
    } finally {
      vi.useRealTimers();
    }
  });

  // ----- P4 audit-G5: changeVaultPassphrase coverage -----

  it('changeVaultPassphrase: rotates the passphrase and re-encrypts every encrypted var', async () => {
    // Setup vault, encrypt a value
    (window.showInputBox as Mock)
      .mockResolvedValueOnce('old-passphrase')
      .mockResolvedValueOnce('old-passphrase');
    await setupVaultPassphraseCommand({ bridge, vault });
    const wire1 = await vault.encryptValue(apicircleDir, 'secret-value-1');
    const active = bridge.activeWorkspace()!;
    const state = await active.read();
    await active.apply({
      kind: 'environment.upsert',
      environment: {
        ...state.synced.environments.items.dev,
        variables: [{ key: 'API_KEY', value: wire1, encrypted: true, secretKeyId: 'ck_a' }],
      },
    });
    const oldBlob = (await active.read()).synced.secretCrypto;
    (window.showInputBox as Mock).mockReset();
    (window.showInformationMessage as Mock).mockReset();
    // changeVaultPassphraseCommand prompts: old → new → confirm
    (window.showInputBox as Mock)
      .mockResolvedValueOnce('old-passphrase')
      .mockResolvedValueOnce('new-passphrase')
      .mockResolvedValueOnce('new-passphrase');

    await changeVaultPassphraseCommand({ bridge, vault });

    const after = await active.read();
    const newBlob = after.synced.secretCrypto;
    expect(newBlob).not.toBeNull();
    expect(newBlob).not.toEqual(oldBlob); // new salt + new verifier
    // The encrypted variable's wire string changed (re-encrypted under new key).
    const newWire = after.synced.environments.items.dev.variables[0].value;
    expect(newWire).toMatch(/^enc:v1:/);
    expect(newWire).not.toBe(wire1);
    // The plaintext round-trips through the NEW vault.
    expect(await vault.decryptValue(apicircleDir, newWire)).toBe('secret-value-1');
  });

  it('changeVaultPassphrase: aborts cleanly when the old passphrase is wrong', async () => {
    (window.showInputBox as Mock).mockResolvedValueOnce('right').mockResolvedValueOnce('right');
    await setupVaultPassphraseCommand({ bridge, vault });
    const oldBlob = (await bridge.activeWorkspace()!.read()).synced.secretCrypto;
    (window.showInputBox as Mock).mockReset();
    (window.showInputBox as Mock).mockResolvedValueOnce('WRONG');
    await changeVaultPassphraseCommand({ bridge, vault });
    expect(window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringMatching(/Current passphrase is wrong/i),
    );
    const stillOldBlob = (await bridge.activeWorkspace()!.read()).synced.secretCrypto;
    expect(stillOldBlob).toEqual(oldBlob);
  });

  it('changeVaultPassphrase: rejects whitespace-only new passphrase via validateInput', async () => {
    (window.showInputBox as Mock).mockResolvedValueOnce('valid').mockResolvedValueOnce('valid');
    await setupVaultPassphraseCommand({ bridge, vault });
    (window.showInputBox as Mock).mockReset();
    // P4R2-G1: rather than asserting password:true (weak), we capture the
    // validateInput function from the new-passphrase prompt and exercise
    // it directly. This proves whitespace IS rejected.
    const inputArgs: vscode.InputBoxOptions[] = [];
    let callCount = 0;
    (window.showInputBox as Mock).mockImplementation((opts: vscode.InputBoxOptions) => {
      inputArgs.push(opts);
      callCount++;
      // Old-passphrase prompt (1st call): resolve with valid value so
      // verifier passes and changeVaultPassphrase advances to the
      // new-passphrase prompt.
      if (callCount === 1) return Promise.resolve('valid');
      // New-passphrase + confirm prompts: user cancels.
      return Promise.resolve(undefined);
    });
    await changeVaultPassphraseCommand({ bridge, vault });

    // Find the new-passphrase prompt — it has validateInput AND a "New
    // passphrase" prompt label. The old-passphrase prompt has no
    // validateInput.
    const newPassphrasePrompt = inputArgs.find(
      (o) => typeof o.validateInput === 'function' && /new passphrase/i.test(o.prompt ?? ''),
    );
    expect(newPassphrasePrompt).toBeDefined();
    const v = newPassphrasePrompt!.validateInput!;
    expect(await Promise.resolve(v(''))).toMatch(/whitespace-only/i);
    expect(await Promise.resolve(v('   '))).toMatch(/whitespace-only/i);
    expect(await Promise.resolve(v('\t\n'))).toMatch(/whitespace-only/i);
    expect(await Promise.resolve(v('valid-pp'))).toBeNull();
  });

  // ----- P4R4-G1: rotation aborts cleanly if apply throws -----

  it('changeVaultPassphrase: locks the new key when persisting the blob fails', async () => {
    (window.showInputBox as Mock).mockResolvedValueOnce('old').mockResolvedValueOnce('old');
    await setupVaultPassphraseCommand({ bridge, vault });
    const wire = await vault.encryptValue(apicircleDir, 'pre-rotation');
    const active = bridge.activeWorkspace()!;
    const state = await active.read();
    await active.apply({
      kind: 'environment.upsert',
      environment: {
        ...state.synced.environments.items.dev,
        variables: [{ key: 'API', value: wire, encrypted: true, secretKeyId: 'ck_a' }],
      },
    });

    // Patch the surface's apply to throw on secret.crypto.set.
    const originalApply = active.apply.bind(active);
    let applyCalls = 0;
    active.apply = async (patch) => {
      applyCalls++;
      if (patch.kind === 'secret.crypto.set') {
        throw new Error('simulated FS write failure');
      }
      return originalApply(patch);
    };

    try {
      (window.showInputBox as Mock).mockReset();
      (window.showErrorMessage as Mock).mockReset();
      (window.showInputBox as Mock)
        .mockResolvedValueOnce('old')
        .mockResolvedValueOnce('new-pp')
        .mockResolvedValueOnce('new-pp');
      await changeVaultPassphraseCommand({ bridge, vault });

      // Vault should be LOCKED (new key dropped) because the persist failed.
      expect(vault.isUnlocked(apicircleDir)).toBe(false);
      // User-facing error surfaced.
      expect(window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringMatching(/Rotation aborted while persisting the new blob/i),
      );
      // The on-disk blob is unchanged (still derives from "old").
      const afterFail = await active.read();
      // It's the OLD blob — unlock with old still works.
      const verifyOld = await vault.unlock(apicircleDir, 'old', afterFail.synced.secretCrypto!);
      expect(verifyOld.ok).toBe(true);
      // Wire still decryptable under old key.
      expect(await vault.decryptValue(apicircleDir, wire)).toBe('pre-rotation');
      void applyCalls;
    } finally {
      // Restore so afterEach can clean up.
      active.apply = originalApply;
    }
  });

  // ----- P4 audit-G8: multi-workspace vault isolation -----

  it('two workspaces unlock independently; ciphertext from one is not decryptable by the other', async () => {
    // Spin up a SECOND workspace under the same bridge.
    const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-it2-'));
    const apicircleDir2 = path.join(tmp2, '.apicircle');
    seedEmpty(apicircleDir2);
    bridge.registerWorkspace({
      id: apicircleDir2,
      apicircleDir: apicircleDir2,
      workspaceJsonPath: path.join(apicircleDir2, 'workspace.json'),
      workspaceFolder: { uri: Uri.file(tmp2), name: 't2', index: 1 } as never,
      label: 't2',
    });

    try {
      // Setup vault on workspace #1, encrypt a value.
      bridge.setActive(apicircleDir);
      (window.showInputBox as Mock).mockResolvedValueOnce('alpha').mockResolvedValueOnce('alpha');
      await setupVaultPassphraseCommand({ bridge, vault });
      const wire1 = await vault.encryptValue(apicircleDir, 'workspace-1-secret');

      // Setup vault on workspace #2 with a different passphrase.
      bridge.setActive(apicircleDir2);
      (window.showInputBox as Mock).mockReset();
      (window.showInputBox as Mock).mockResolvedValueOnce('beta').mockResolvedValueOnce('beta');
      await setupVaultPassphraseCommand({ bridge, vault });

      // Both should be unlocked simultaneously.
      expect(vault.isUnlocked(apicircleDir)).toBe(true);
      expect(vault.isUnlocked(apicircleDir2)).toBe(true);

      // Decrypt wire1 against workspace #2's vault should fail with a
      // VaultCryptoError — the wrong key cannot decrypt.
      await expect(vault.decryptValue(apicircleDir2, wire1)).rejects.toMatchObject({
        name: 'VaultCryptoError',
      });

      // Decrypting wire1 against workspace #1's vault still succeeds.
      expect(await vault.decryptValue(apicircleDir, wire1)).toBe('workspace-1-secret');

      // Locking workspace #1 leaves #2 unlocked.
      vault.lock(apicircleDir);
      expect(vault.isUnlocked(apicircleDir)).toBe(false);
      expect(vault.isUnlocked(apicircleDir2)).toBe(true);
    } finally {
      fs.rmSync(tmp2, { recursive: true, force: true });
    }
  });

  // ----- P4 audit-G12: orphan-ciphertext UX -----

  // ----- P4R2-G3: stale cached key (blob rotated via Git pull) -----

  it('unlockVault drops a stale cached key when the on-disk blob has rotated', async () => {
    // Setup vault with passphrase A.
    (window.showInputBox as Mock).mockResolvedValueOnce('alpha').mockResolvedValueOnce('alpha');
    await setupVaultPassphraseCommand({ bridge, vault });
    expect(vault.isUnlocked(apicircleDir)).toBe(true);

    // Simulate a Git pull arriving with a NEW blob (e.g. teammate rotated
    // the passphrase to "beta"). We write the new blob directly via
    // applyMutation under a side-channel: re-init under beta via a second
    // VaultManager isolated from the workspace's cached key.
    const { initSecretCrypto } = await import('@apicircle/core');
    const newInit = await initSecretCrypto('beta', 100);
    await bridge.activeWorkspace()!.apply({
      kind: 'secret.crypto.set',
      crypto: newInit.crypto,
    });
    // Cached key is still under the OLD blob. isUnlocked says true but
    // isUnlockedAgainst the new blob says false.
    expect(vault.isUnlocked(apicircleDir)).toBe(true);
    const refreshed = await bridge.activeWorkspace()!.read();
    expect(vault.isUnlockedAgainst(apicircleDir, refreshed.synced.secretCrypto)).toBe(false);

    // unlockVault should detect the staleness, drop the cached key,
    // surface a toast explaining what happened (P4R3-G11), then re-prompt
    // for the new passphrase.
    (window.showInputBox as Mock).mockReset();
    (window.showInformationMessage as Mock).mockReset();
    (window.showInputBox as Mock).mockResolvedValueOnce('beta');
    await unlockVaultCommand({ bridge, vault });
    expect(window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringMatching(/Vault passphrase changed externally/i),
    );
    expect(vault.isUnlocked(apicircleDir)).toBe(true);
    // The cached key is now derived from the new verifier.
    const after = await bridge.activeWorkspace()!.read();
    expect(vault.isUnlockedAgainst(apicircleDir, after.synced.secretCrypto)).toBe(true);
  });

  // ----- P4R2-G12 second branch: encrypted=true but plaintext wire -----

  it('open vault entry on a non-enc:v1 plaintext-but-flagged variable shows the generic "no vault" message', async () => {
    // Inconsistent state: variable.encrypted=true but variable.value is
    // not an enc:v1: wire (could happen if someone hand-edited the YAML).
    const active = bridge.activeWorkspace()!;
    const state = await active.read();
    await active.apply({
      kind: 'environment.upsert',
      environment: {
        ...state.synced.environments.items.dev,
        variables: [
          { key: 'BAD', value: 'plain-text-not-encrypted', encrypted: true, secretKeyId: 'ck_x' },
        ],
      },
    });
    // No vault has been set up — secretCrypto stays null.
    (window.showWarningMessage as Mock).mockReset();
    await openVaultEntryCommand(
      { bridge, vault },
      { clipboardClearSeconds: 0 },
      { kind: 'variable-encrypted', envName: 'dev', key: 'BAD' },
    );
    // Should NOT mention "unrecoverable" — the value doesn't look encrypted.
    const msg = (window.showWarningMessage as Mock).mock.calls[0]?.[0] as string;
    expect(msg).toMatch(/No vault passphrase set/i);
    expect(msg).not.toMatch(/unrecoverable/i);
  });

  // ----- P4R2-G14: no-active-workspace early exits -----

  it('all vault commands no-op cleanly when no workspace is active', async () => {
    // Tear down the active workspace registration.
    bridge.dispose();
    bridge = new VsCodeBridge(makeMockContext(path.join(tmp, 'globalStorage2')));
    // No workspaces registered → bridge.activeWorkspace() returns null.
    (window.showInformationMessage as Mock).mockReset();

    await unlockVaultCommand({ bridge, vault });
    await setupVaultPassphraseCommand({ bridge, vault });
    lockVaultCommand({ bridge, vault }); // lockAll path — no active surface
    await openVaultEntryCommand(
      { bridge, vault },
      { clipboardClearSeconds: 0 },
      { kind: 'variable-encrypted', envName: 'dev', key: 'X' },
    );
    // Best-effort: at least one of the no-active-workspace info messages
    // surfaced. The exact set depends on which command got past the early
    // exit; we assert no exceptions and at least one info toast.
    expect((window.showInformationMessage as Mock).mock.calls.length).toBeGreaterThan(0);
  });

  it('lockVault with no active workspace + no unlocked vaults surfaces a "nothing locked" toast', () => {
    bridge.dispose();
    bridge = new VsCodeBridge(makeMockContext(path.join(tmp, 'globalStorage3')));
    vault.lockAll();
    (window.showInformationMessage as Mock).mockReset();
    lockVaultCommand({ bridge, vault });
    expect(window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringMatching(/No vaults were unlocked/i),
    );
  });

  it('lockVault with no active workspace + unlocked vaults reports the count', async () => {
    // Unlock the existing workspace first.
    (window.showInputBox as Mock).mockResolvedValueOnce('pp').mockResolvedValueOnce('pp');
    await setupVaultPassphraseCommand({ bridge, vault });
    // Now drop active workspace.
    bridge.dispose();
    bridge = new VsCodeBridge(makeMockContext(path.join(tmp, 'globalStorage4')));
    (window.showInformationMessage as Mock).mockReset();
    lockVaultCommand({ bridge, vault });
    expect(window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringMatching(/Locked 1 vault/),
    );
  });

  it('opens a vault entry on a wiped vault — surfaces a clear "unrecoverable" message', async () => {
    // Setup vault, encrypt a value, then CLEAR the secretCrypto blob —
    // simulates "user ran change-passphrase and then external Git pull
    // wiped the blob" or "secret.crypto.clear from MCP/CLI".
    (window.showInputBox as Mock).mockResolvedValueOnce('pp').mockResolvedValueOnce('pp');
    await setupVaultPassphraseCommand({ bridge, vault });
    const wire = await vault.encryptValue(apicircleDir, 'lost');
    const active = bridge.activeWorkspace()!;
    const state = await active.read();
    await active.apply({
      kind: 'environment.upsert',
      environment: {
        ...state.synced.environments.items.dev,
        variables: [{ key: 'GONE', value: wire, encrypted: true, secretKeyId: 'ck_g' }],
      },
    });
    // Wipe the vault.
    await active.apply({ kind: 'secret.crypto.clear' });
    vault.lockAll();

    (window.showWarningMessage as Mock).mockReset();
    await openVaultEntryCommand(
      { bridge, vault },
      { clipboardClearSeconds: 0 },
      { kind: 'variable-encrypted', envName: 'dev', key: 'GONE' },
    );
    expect(window.showWarningMessage).toHaveBeenCalledWith(expect.stringMatching(/unrecoverable/i));
  });

  it('clipboard auto-clear does NOT clear if the user already pasted something else', async () => {
    vi.useFakeTimers();
    try {
      // After the timer fires, the clipboard contains a DIFFERENT value.
      (env.clipboard.readText as Mock).mockResolvedValueOnce('different-text');
      (window.showInputBox as Mock).mockResolvedValueOnce('pp').mockResolvedValueOnce('pp');
      await setupVaultPassphraseCommand({ bridge, vault });
      const wire = await vault.encryptValue(apicircleDir, 'one-time');
      const active = bridge.activeWorkspace()!;
      const state = await active.read();
      await active.apply({
        kind: 'environment.upsert',
        environment: {
          ...state.synced.environments.items.dev,
          variables: [{ key: 'T', value: wire, encrypted: true, secretKeyId: 'ck_t' }],
        },
      });
      (window.showInformationMessage as Mock).mockReset();
      (window.showInformationMessage as Mock).mockResolvedValueOnce('Copy to Clipboard');
      (window.showInformationMessage as Mock).mockResolvedValueOnce(undefined);

      await openVaultEntryCommand(
        { bridge, vault },
        { clipboardClearSeconds: 5 },
        { kind: 'variable-encrypted', envName: 'dev', key: 'T' },
      );
      // The "Copy to Clipboard" call hits writeText('one-time').
      const callsBefore = (env.clipboard.writeText as Mock).mock.calls.length;
      await vi.advanceTimersByTimeAsync(5_500);
      await Promise.resolve();
      await Promise.resolve();
      // No additional writeText('') call.
      const callsAfter = (env.clipboard.writeText as Mock).mock.calls.length;
      expect(callsAfter).toBe(callsBefore);
    } finally {
      vi.useRealTimers();
    }
  });
});
