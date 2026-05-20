// Workspace-passphrase prompt. Two modes:
//   - `setup`: the workspace has no SecretCrypto blob yet. The user
//     picks a passphrase + confirms it; we initialise the blob, write
//     it to synced.secretCrypto on git push, and hold the derived key
//     in renderer memory for the session.
//   - `unlock`: the workspace already has a SecretCrypto blob (someone
//     else set it up, OR the user set it up before a previous restart).
//     The user re-enters the passphrase; we verify against the blob and
//     hold the derived key in memory.
//
// In-memory only: the passphrase itself is never persisted to IndexedDB
// and never written to disk on the desktop bridge. Restart the app and
// the user re-enters it.
//
// This component is presentational + drives the relevant store actions;
// the actual encrypt/decrypt wiring of legacy entries is a separate
// follow-up (see passphraseKey.ts header for the design).

import { useState } from 'react';
import { KeyRound, Lock, ShieldCheck } from 'lucide-react';
import { Modal } from '../primitives/Modal';
import { cn } from '../primitives/cn';

export type PassphrasePromptMode = 'setup' | 'unlock';

interface PassphrasePromptModalProps {
  open: boolean;
  mode: PassphrasePromptMode;
  /** Best-effort label, e.g. workspace name, for context in the modal copy. */
  workspaceName?: string;
  /** Async action called with the entered passphrase. Should resolve `{ok}` or reject. */
  onSubmit: (passphrase: string) => Promise<{ ok: boolean; reason?: string }>;
  /** Close without submitting — only allowed for `unlock` mode if the workspace can degrade gracefully (read-only secrets). */
  onCancel: () => void;
  /** Whether Cancel is allowed. For first-secret setup, force the user to make a choice. */
  cancellable?: boolean;
}

const inputClass =
  'h-9 w-full rounded-sm border border-border bg-surface px-3 text-sm text-text-primary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30';

export function PassphrasePromptModal({
  open,
  mode,
  workspaceName,
  onSubmit,
  onCancel,
  cancellable = true,
}: PassphrasePromptModalProps) {
  const [passphrase, setPassphrase] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!open) return null;

  const isSetup = mode === 'setup';
  // Length floor only applies to *setup* — unlocking accepts whatever
  // string the user enters and defers correctness to the verifier check
  // upstream (`unlockSecretCrypto`). A returning user with a short legacy
  // passphrase shouldn't be locked out of their own workspace by the UI.
  const minOk = !isSetup || passphrase.length >= 12;
  const matchOk = !isSetup || passphrase === confirm;
  const canSubmit = passphrase.length > 0 && minOk && matchOk && !submitting;

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const result = await onSubmit(passphrase);
      if (!result.ok) {
        setError(result.reason ?? 'Could not unlock secrets.');
      } else {
        setPassphrase('');
        setConfirm('');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  };

  const title = isSetup ? 'Set workspace passphrase' : 'Unlock workspace secrets';
  const Icon = isSetup ? ShieldCheck : Lock;

  return (
    <Modal
      open
      onClose={cancellable ? onCancel : () => undefined}
      title={title}
      className="max-w-md"
    >
      <div className="space-y-3">
        <div className="flex items-start gap-2 rounded-sm border border-accent/30 bg-accent/5 p-3 text-[0.6875rem] text-text-muted">
          <Icon size={14} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
          <div>
            {isSetup ? (
              <p>
                Pick a passphrase. Secret values stored in{' '}
                <strong className="text-text-primary">{workspaceName ?? 'this workspace'}</strong>{' '}
                will be encrypted with it. Teammates need the same passphrase to decrypt secrets
                from git.
              </p>
            ) : (
              <p>
                Enter the workspace passphrase to decrypt secrets in{' '}
                <strong className="text-text-primary">{workspaceName ?? 'this workspace'}</strong>.
                Passphrase is held only in memory; you&apos;ll be asked again after a restart.
              </p>
            )}
            <p className="mt-1.5 text-warning">
              No recovery: lose the passphrase, lose the secrets.
            </p>
          </div>
        </div>

        <div>
          <label htmlFor="passphrase-input" className="block text-[0.6875rem] text-text-dim">
            {isSetup ? 'New passphrase' : 'Passphrase'}
          </label>
          <input
            id="passphrase-input"
            type="password"
            autoFocus
            value={passphrase}
            onChange={(e) => {
              setPassphrase(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && canSubmit) {
                e.preventDefault();
                void submit();
              }
            }}
            aria-label="Workspace passphrase"
            aria-invalid={!minOk && passphrase.length > 0 ? true : undefined}
            className={cn(inputClass, 'mt-1')}
          />
          {isSetup && passphrase.length > 0 && !minOk && (
            <p className="mt-1 text-[0.625rem] text-warning">Use at least 12 characters.</p>
          )}
        </div>

        {isSetup && (
          <div>
            <label htmlFor="passphrase-confirm" className="block text-[0.6875rem] text-text-dim">
              Confirm passphrase
            </label>
            <input
              id="passphrase-confirm"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canSubmit) {
                  e.preventDefault();
                  void submit();
                }
              }}
              aria-label="Confirm passphrase"
              aria-invalid={!matchOk ? true : undefined}
              className={cn(inputClass, 'mt-1')}
            />
            {confirm.length > 0 && !matchOk && (
              <p className="mt-1 text-[0.625rem] text-danger">Passphrases do not match.</p>
            )}
          </div>
        )}

        {error && (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          {cancellable && (
            <button
              type="button"
              onClick={onCancel}
              className="inline-flex h-8 items-center rounded-sm border border-border bg-surface px-3 text-xs text-text-muted hover:border-border-strong hover:text-text-primary"
            >
              Cancel
            </button>
          )}
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!canSubmit}
            className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-accent/40 bg-accent/10 px-3 text-xs text-accent hover:bg-accent/20 disabled:opacity-50"
          >
            <KeyRound size={12} aria-hidden="true" />
            {submitting ? 'Working…' : isSetup ? 'Set passphrase' : 'Unlock'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
