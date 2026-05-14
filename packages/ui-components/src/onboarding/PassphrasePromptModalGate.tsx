// Mounted once at App root. Owns:
//   1. The lazy "Set passphrase" prompt — fires when secrets actions
//      need a key but the workspace has no `secretCrypto` blob yet.
//   2. The "Unlock workspace secrets" prompt — fires when the workspace
//      DOES have a passphrase set but the in-memory key was cleared
//      (post-restart or post-idle-lock).
//   3. The 15-minute idle-lock timer — clears the in-memory key when
//      the workspace has been idle, forcing a re-unlock.
//
// Lazy semantics (decision 2A): on app load we never prompt
// preemptively. The user only sees the prompt when something is
// actively needed — surfaced via the `requestPassphrasePrompt` action
// when wired into the secret-touching flows.

import { useEffect, useState } from 'react';
import { useWorkspaceStore } from '../store/workspaceStore';
import { PassphrasePromptModal } from './PassphrasePromptModal';

/** Idle window after which an unlocked workspace re-locks itself. */
const IDLE_LOCK_MS = 15 * 60 * 1000;
/** Polling cadence for the idle check — coarse is fine; we check every minute. */
const IDLE_TICK_MS = 60 * 1000;

interface GateProps {
  /**
   * When `true`, force-render the unlock modal even if the user hasn't
   * triggered a secret action yet. Used by the secret-vault dock when
   * the user opens it and the workspace is locked.
   */
  forceUnlock?: boolean;
}

export function PassphrasePromptModalGate({ forceUnlock = false }: GateProps) {
  const secretCrypto = useWorkspaceStore((s) => s.synced?.secretCrypto ?? null);
  const workspaceName = useWorkspaceStore((s) => {
    const reg = s.workspaceRegistry;
    if (!reg) return null;
    return reg.workspaces.find((w) => w.id === reg.activeWorkspaceId)?.name ?? null;
  });
  const lockState = useWorkspaceStore((s) => s.secretLockState);
  const lastActivity = useWorkspaceStore((s) => s.lastSecretActivityAt);
  const setupPassphrase = useWorkspaceStore((s) => s.setupPassphrase);
  const unlockWithPassphrase = useWorkspaceStore((s) => s.unlockWithPassphrase);
  const lockSecrets = useWorkspaceStore((s) => s.lockSecrets);

  // Tracks whether the lazy "set passphrase" prompt is open. Stays
  // closed by default; some flow (TBD wiring) flips it on when a user
  // tries to add their first secret.
  const [setupOpen, setSetupOpen] = useState(false);

  // The unlock modal renders whenever the workspace HAS a passphrase
  // and the in-memory key is missing. `forceUnlock` lets a feature
  // (e.g. opening the Secret Vault) demand it explicitly.
  const unlockOpen = secretCrypto !== null && lockState === 'locked' && forceUnlock;

  // 15-minute idle lock. Only meaningful when we're currently
  // unlocked AND the workspace has a passphrase set up. The interval
  // re-evaluates `lastActivity` on each tick.
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

  // `lastActivity` is wired into the dependency so consumers can call
  // `noteSecretActivity()` and the timer resets correctly. Strictly the
  // interval reads getState() so we don't need re-runs, but the
  // dependency makes the relationship explicit for readers.
  void lastActivity;

  // Setup mode: lazy. Not fired automatically — exposed for the
  // "first secret added" flow to call. Kept as a no-op placeholder
  // surface so the wiring lands cleanly when payload encryption moves
  // off device-local IDB and onto workspace.json. See the handoff doc
  // (docs/passphrase-secret-model-handoff.md).
  return (
    <>
      <PassphrasePromptModal
        open={setupOpen}
        mode="setup"
        workspaceName={workspaceName ?? undefined}
        onSubmit={async (p) => {
          const r = await setupPassphrase(p);
          if (r.ok) setSetupOpen(false);
          return r;
        }}
        onCancel={() => setSetupOpen(false)}
      />
      <PassphrasePromptModal
        open={unlockOpen}
        mode="unlock"
        workspaceName={workspaceName ?? undefined}
        cancellable={false}
        onSubmit={(p) => unlockWithPassphrase(p)}
        onCancel={() => undefined}
      />
    </>
  );
}
