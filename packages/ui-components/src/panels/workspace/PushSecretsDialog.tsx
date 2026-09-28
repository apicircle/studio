import type { SecretFinding } from '@apicircle/core';
import { ConfirmDialog } from '../../primitives/ConfirmDialog';

interface PushSecretsDialogProps {
  /** What the push found — `null` keeps the dialog closed. */
  findings: readonly SecretFinding[] | null;
  /** `owner/name` of the repository the push writes to. */
  repo: string;
  /** The working branch the push writes to. */
  branch: string;
  onCancel: () => void;
  /** Push again with exactly these findings acknowledged. */
  onPushAnyway: (findings: readonly SecretFinding[]) => void;
}

/**
 * Asked when a push would write values shaped like secrets to Git. Lists where
 * each one sits and why it was flagged — never the value — and lets the user
 * cancel (nothing has been written) or push anyway.
 */
export function PushSecretsDialog({
  findings,
  repo,
  branch,
  onCancel,
  onPushAnyway,
}: PushSecretsDialogProps) {
  const list = findings ?? [];
  const one = list.length === 1;
  return (
    <ConfirmDialog
      open={findings !== null}
      title={
        one
          ? 'Push a value that looks like a secret?'
          : `Push ${list.length} values that look like secrets?`
      }
      tone="danger"
      cancelLabel="Cancel"
      confirmLabel="Push anyway"
      description={
        <div className="space-y-2">
          <p>
            {one ? 'This value' : 'These values'} would be written to <code>{repo}</code> on{' '}
            <code>{branch}</code> as plain text. Anyone who can read the repository can read{' '}
            {one ? 'it' : 'them'}, and {one ? 'it stays' : 'they stay'} in its history after you
            remove {one ? 'it' : 'them'}. Nothing has been pushed yet.
          </p>
          <ul
            aria-label="Values that look like secrets"
            className="max-h-48 space-y-1 overflow-y-auto rounded-sm border border-border bg-surface p-2"
          >
            {list.map((finding) => (
              <li key={finding.id} className="break-words leading-snug">
                <span className="text-text-primary">{finding.location}</span>
                <span className="text-text-dim"> — {finding.reason}</span>
              </li>
            ))}
          </ul>
          <p>
            To keep a value out of Git, move it into an environment variable, bind that variable to
            your Secret Vault with <strong className="text-text-primary">Encrypt</strong> in the
            Environments panel, and use <code>{'{{NAME}}'}</code> where the value was.
          </p>
        </div>
      }
      onCancel={onCancel}
      onConfirm={() => onPushAnyway(list)}
    />
  );
}
