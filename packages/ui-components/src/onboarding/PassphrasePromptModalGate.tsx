// Mounted once at App root. Owns:
//   1. The "Set passphrase" prompt — fires when any flow calls
//      `openPassphraseSetup()` on the store (typically the Vault dock's
//      Set-passphrase CTA, or the first-secret flow on web).
//   2. The "Unlock workspace secrets" prompt — fires when any flow calls
//      `openPassphraseUnlock()` on the store (the Vault dock when the
//      workspace HAS a passphrase but the in-memory key was cleared).
//   3. The 15-minute idle-lock timer — clears the in-memory key when
//      the workspace has been idle, forcing a re-unlock.
//
// Lazy semantics (decision 2A): the gate never opens a modal preemptively
// on hydrate. Callers must explicitly request it via the store. This
// keeps the app boot path silent for users who never touch secrets.

import { useEffect } from 'react';
import { useWorkspaceStore } from '../store/workspaceStore';
import { PassphrasePromptModal } from './PassphrasePromptModal';

/** Idle window after which an unlocked workspace re-locks itself. */
const IDLE_LOCK_MS = 15 * 60 * 1000;
/** Polling cadence for the idle check — coarse is fine; we check every minute. */
const IDLE_TICK_MS = 60 * 1000;

export function PassphrasePromptModalGate() {
  const modal = useWorkspaceStore((s) => s.passphraseModal);
  const workspaceName = useWorkspaceStore((s) => {
    const reg = s.workspaceRegistry;
    if (!reg) return null;
    return reg.workspaces.find((w) => w.id === reg.activeWorkspaceId)?.name ?? null;
  });
  const lockState = useWorkspaceStore((s) => s.secretLockState);
  const setupPassphrase = useWorkspaceStore((s) => s.setupPassphrase);
  const unlockWithPassphrase = useWorkspaceStore((s) => s.unlockWithPassphrase);
  const lockSecrets = useWorkspaceStore((s) => s.lockSecrets);
  const closeModal = useWorkspaceStore((s) => s.closePassphraseModal);

  // 15-minute idle lock. Only meaningful when we're currently
  // unlocked AND the workspace has a passphrase set up. The interval
  // re-evaluates `lastSecretActivityAt` on each tick by reading the
  // freshest value via getState() — keeps the dep list short.
  useEffect(() => {
    if (lockState !== 'unlocked') return;
    const id = window.setInterval(() => {
      const last = useWorkspaceStore.getState().lastSecretActivityAt;
      if (last !== null && Date.now() - last >= IDLE_LOCK_MS) {
        lockSecrets();
      }
    }, IDLE_TICK_MS);
    return () => window.clearInterval(id);
  }, [lockState, lockSecrets]);

  return (
    <>
      <PassphrasePromptModal
        open={modal === 'setup'}
        mode="setup"
        workspaceName={workspaceName ?? undefined}
        onSubmit={(p) => setupPassphrase(p)}
        onCancel={closeModal}
      />
      <PassphrasePromptModal
        open={modal === 'unlock'}
        mode="unlock"
        workspaceName={workspaceName ?? undefined}
        cancellable
        onSubmit={(p) => unlockWithPassphrase(p)}
        onCancel={closeModal}
      />
    </>
  );
}
