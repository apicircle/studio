import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Mock } from 'vitest';
import type { SecretStorage } from 'vscode';
import type { WorkspaceState } from '@apicircle/core';
import { window } from '../../test/mocks/vscode';
import {
  unlockVaultCommand,
  lockVaultCommand,
  setupVaultPassphraseCommand,
  changeVaultPassphraseCommand,
  silentUnlockFromDevice,
} from './vaultActions';
import type { VsCodeBridge } from '../host/vscodeBridge';
import type { VsCodeVaultManager } from '../host/vaultManager';

function emptyState(over: Partial<WorkspaceState['synced']> = {}): WorkspaceState {
  return {
    synced: {
      schemaVersion: 1,
      workspaceId: 'ws-1',
      secretCrypto: null,
      ...over,
    } as never,
    local: {} as never,
  };
}

function makeBridge(state: WorkspaceState, opts: { hasActive?: boolean } = {}) {
  const apply = vi.fn(async () => undefined);
  const surface = {
    workspace: { id: 'ws-1', name: 'demo' },
    read: vi.fn(async () => state),
    apply,
  };
  return {
    bridge: {
      activeWorkspace: () =>
        opts.hasActive === false
          ? null
          : (surface as unknown as ReturnType<VsCodeBridge['activeWorkspace']>),
      listWorkspaces: () => [surface as unknown as never],
    } as unknown as VsCodeBridge,
    surface,
  };
}

function makeVault(over: Partial<Record<keyof VsCodeVaultManager, unknown>> = {}) {
  return {
    isUnlocked: vi.fn((_id: string) => false),
    unlock: vi.fn(async () => ({ ok: true })),
    lock: vi.fn(),
    lockAll: vi.fn(),
    unlockedWorkspaceIds: vi.fn(() => [] as string[]),
    initialize: vi.fn(async () => ({ kdf: 'pbkdf2', salt: 's', verifier: 'v' })),
    ...over,
  } as unknown as VsCodeVaultManager;
}

function reset(): void {
  (window.showInformationMessage as Mock).mockReset();
  (window.showWarningMessage as Mock).mockReset();
  (window.showErrorMessage as Mock).mockReset();
  (window.showInputBox as Mock).mockReset();
}

describe('unlockVaultCommand', () => {
  beforeEach(reset);

  it('warns when no active workspace', async () => {
    const { bridge } = makeBridge(emptyState(), { hasActive: false });
    await unlockVaultCommand({ bridge, vault: makeVault() });
    expect(window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('No active API Circle workspace'),
    );
  });

  it('offers Set-Up flow when workspace has no SecretCrypto blob', async () => {
    const { bridge } = makeBridge(emptyState({ secretCrypto: null }));
    (window.showInformationMessage as Mock).mockResolvedValueOnce(undefined);
    await unlockVaultCommand({ bridge, vault: makeVault() });
    expect(window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('no secret vault yet'),
      'Set Up Passphrase',
      'Cancel',
    );
  });
});

describe('lockVaultCommand', () => {
  beforeEach(reset);

  it('locks all and reports the count when no active workspace', () => {
    const vault = makeVault({ unlockedWorkspaceIds: vi.fn(() => ['ws-1', 'ws-2']) });
    const { bridge } = makeBridge(emptyState(), { hasActive: false });
    lockVaultCommand({ bridge, vault });
    expect((vault as unknown as { lockAll: Mock }).lockAll).toHaveBeenCalledTimes(1);
    expect(window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('Locked 2 vault(s).'),
    );
  });

  it('reports "No vaults were unlocked." when nothing to lock', () => {
    const vault = makeVault({ unlockedWorkspaceIds: vi.fn(() => []) });
    const { bridge } = makeBridge(emptyState(), { hasActive: false });
    lockVaultCommand({ bridge, vault });
    expect(window.showInformationMessage).toHaveBeenCalledWith('No vaults were unlocked.');
  });

  it('no-ops with a friendly message when the active vault is already locked', () => {
    const vault = makeVault({ isUnlocked: vi.fn(() => false) });
    const { bridge } = makeBridge(emptyState());
    lockVaultCommand({ bridge, vault });
    expect(window.showInformationMessage).toHaveBeenCalledWith('Vault is already locked.');
  });

  it('locks the active workspace when unlocked', () => {
    const vault = makeVault({ isUnlocked: vi.fn(() => true) });
    const { bridge } = makeBridge(emptyState());
    lockVaultCommand({ bridge, vault });
    expect((vault as unknown as { lock: Mock }).lock).toHaveBeenCalledWith('ws-1');
    expect(window.showInformationMessage).toHaveBeenCalledWith('Vault locked.');
  });
});

describe('setupVaultPassphraseCommand', () => {
  beforeEach(reset);

  it('warns when no active workspace', async () => {
    const { bridge } = makeBridge(emptyState(), { hasActive: false });
    await setupVaultPassphraseCommand({ bridge, vault: makeVault() });
    expect(window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('No active API Circle workspace'),
    );
  });

  it('initializes a fresh blob and applies secret.crypto.set', async () => {
    const { bridge, surface } = makeBridge(emptyState());
    const vault = makeVault();
    (window.showInputBox as Mock).mockResolvedValueOnce('hunter2').mockResolvedValueOnce('hunter2');
    await setupVaultPassphraseCommand({ bridge, vault });
    expect((vault as unknown as { initialize: Mock }).initialize).toHaveBeenCalledWith(
      'ws-1',
      'hunter2',
    );
    expect(surface.apply).toHaveBeenCalledWith({
      kind: 'secret.crypto.set',
      crypto: { kdf: 'pbkdf2', salt: 's', verifier: 'v' },
    });
  });

  it('exits silently when the user cancels the first passphrase prompt', async () => {
    const { bridge, surface } = makeBridge(emptyState());
    const vault = makeVault();
    (window.showInputBox as Mock).mockResolvedValueOnce(undefined);
    await setupVaultPassphraseCommand({ bridge, vault });
    expect(surface.apply).not.toHaveBeenCalled();
  });

  it('reroutes to changeVaultPassphrase when blob already exists and user picks Rotate', async () => {
    const blob = { kdf: 'pbkdf2', salt: 's', verifier: 'v' } as never;
    const { bridge } = makeBridge(emptyState({ secretCrypto: blob }));
    const vault = makeVault();
    (window.showWarningMessage as Mock).mockResolvedValueOnce('Rotate');
    // changeVaultPassphraseCommand will prompt for current passphrase
    (window.showInputBox as Mock).mockResolvedValueOnce(undefined); // cancel current
    await setupVaultPassphraseCommand({ bridge, vault });
    expect(window.showWarningMessage).toHaveBeenCalled();
    expect(window.showInputBox).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: 'Current passphrase' }),
    );
  });
});

describe('changeVaultPassphraseCommand', () => {
  beforeEach(reset);

  it('exits silently when no active workspace', async () => {
    const { bridge } = makeBridge(emptyState(), { hasActive: false });
    await changeVaultPassphraseCommand({ bridge, vault: makeVault() });
    expect(window.showInformationMessage).not.toHaveBeenCalled();
  });

  it('reports missing blob and bails', async () => {
    const { bridge } = makeBridge(emptyState({ secretCrypto: null }));
    await changeVaultPassphraseCommand({ bridge, vault: makeVault() });
    expect(window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('No vault to rotate'),
    );
  });

  it('surfaces a wrong-current-passphrase error and aborts', async () => {
    const blob = { kdf: 'pbkdf2', salt: 's', verifier: 'v' } as never;
    const { bridge } = makeBridge(emptyState({ secretCrypto: blob }));
    const vault = makeVault({
      unlock: vi.fn(async () => ({ ok: false, reason: 'wrong-key' })),
    });
    (window.showInputBox as Mock).mockResolvedValueOnce('oldpass');
    await changeVaultPassphraseCommand({ bridge, vault });
    expect(window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('Current passphrase is wrong'),
    );
  });
});

describe('silentUnlockFromDevice', () => {
  beforeEach(reset);

  it('returns no-stored-entry when no SecretStorage handle is provided', async () => {
    const { bridge } = makeBridge(emptyState());
    const out = await silentUnlockFromDevice({ bridge, vault: makeVault() }, 'ws-1');
    expect(out).toBe('no-stored-entry');
  });
});

import { forgetVaultOnDeviceCommand } from './vaultActions';

function makeSecrets(seed: Record<string, string> = {}) {
  const store = new Map(Object.entries(seed));
  return {
    get: vi.fn(async (k: string) => store.get(k)),
    store: vi.fn(async (k: string, v: string) => {
      store.set(k, v);
    }),
    delete: vi.fn(async (k: string) => {
      store.delete(k);
    }),
    onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
  } as unknown as SecretStorage;
}

describe('forgetVaultOnDeviceCommand', () => {
  beforeEach(reset);

  it('warns when SecretStorage is unavailable', async () => {
    const { bridge } = makeBridge(emptyState());
    await forgetVaultOnDeviceCommand({ bridge, vault: makeVault() });
    expect(window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('not available'),
    );
  });

  it('reports nothing to forget when no workspaces are registered', async () => {
    const secrets = makeSecrets();
    const bridge = {
      activeWorkspace: () => null,
      listWorkspaces: () => [],
    } as unknown as VsCodeBridge;
    await forgetVaultOnDeviceCommand({ bridge, vault: makeVault(), secrets });
    expect(window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('nothing to forget'),
    );
  });

  it('forgets the active workspace passphrase on confirm', async () => {
    const { bridge, surface } = makeBridge(emptyState());
    const secrets = makeSecrets();
    (surface as { workspace: { label?: string } }).workspace.label = 'Demo';
    (window.showWarningMessage as Mock).mockResolvedValueOnce('Forget');
    await forgetVaultOnDeviceCommand({ bridge, vault: makeVault(), secrets });
    expect(window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('Forgot remembered passphrase'),
    );
  });

  it('aborts when the active-workspace modal is dismissed', async () => {
    const { bridge } = makeBridge(emptyState());
    const secrets = makeSecrets();
    (window.showWarningMessage as Mock).mockResolvedValueOnce(undefined);
    await forgetVaultOnDeviceCommand({ bridge, vault: makeVault(), secrets });
    expect(window.showInformationMessage).not.toHaveBeenCalled();
  });

  it('offers forget-all flow when no workspace is active but workspaces are known', async () => {
    const { surface } = makeBridge(emptyState());
    const secrets = makeSecrets();
    const bridge = {
      activeWorkspace: () => null,
      listWorkspaces: () => [surface as unknown as never],
    } as unknown as VsCodeBridge;
    (window.showWarningMessage as Mock).mockResolvedValueOnce('Forget All');
    await forgetVaultOnDeviceCommand({ bridge, vault: makeVault(), secrets });
    expect(window.showInformationMessage).toHaveBeenCalled();
  });
});
