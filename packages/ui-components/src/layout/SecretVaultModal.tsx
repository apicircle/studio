import { useState } from 'react';
import { KeyRound, ShieldCheck } from 'lucide-react';
import { useWorkspaceStore } from '../store/workspaceStore';
import { Modal } from '../primitives/Modal';
import { cn } from '../primitives/cn';

type Tab = 'vault' | 'sessions';

export function SecretVaultModal() {
  const open = useWorkspaceStore((s) => s.secretVaultOpen);
  const close = useWorkspaceStore((s) => s.closeSecretVault);
  const [tab, setTab] = useState<Tab>('vault');

  return (
    <Modal open={open} onClose={close} title="Secret Vault" className="max-w-3xl">
      <div className="-mx-4 -mt-4 mb-4 flex border-b border-border-subtle">
        <TabButton
          active={tab === 'vault'}
          onClick={() => setTab('vault')}
          icon={<KeyRound size={14} />}
          label="Vault"
        />
        <TabButton
          active={tab === 'sessions'}
          onClick={() => setTab('sessions')}
          icon={<ShieldCheck size={14} />}
          label="Sessions"
        />
      </div>

      {tab === 'vault' ? <VaultTab /> : <SessionsTab />}
    </Modal>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex h-10 items-center gap-2 border-b-2 px-4 text-sm transition-colors',
        active
          ? 'border-accent text-text-primary'
          : 'border-transparent text-text-muted hover:text-text-primary',
      )}
      aria-current={active ? 'page' : undefined}
    >
      {icon}
      {label}
    </button>
  );
}

function VaultTab() {
  return (
    <div className="space-y-4">
      <p className="text-sm text-text-muted">
        AES-GCM encryption is now wired. The fastest path today is{' '}
        <span className="text-text-primary">encrypted environment variables</span> — flip the{' '}
        <span className="text-text-primary">Encrypted</span> toggle on any variable in the
        Environments panel. The ciphertext is what gets pushed to Git; only this browser holds the
        master key needed to decrypt it.
      </p>
      <div className="rounded-sm border border-border bg-card p-3 text-xs text-text-muted">
        <p className="mb-1 text-text-primary">Master key</p>
        <p>
          Generated automatically on first use and stored in IndexedDB on this device only.
          Reinstalling the app or clearing site data drops the key — re-enter encrypted values
          afterwards.
        </p>
      </div>
      <div className="rounded-sm border border-dashed border-border-subtle p-3 text-xs text-text-dim">
        Cross-workspace named secrets, origin badges, and the &quot;where used&quot; expander land
        in P3.x — this tab will show vault entries with their consumers once that ships. For now,
        encrypt directly on the variable.
      </div>
    </div>
  );
}

function SessionsTab() {
  return (
    <div className="space-y-4">
      <p className="text-sm text-text-muted">
        GitHub PAT sessions. Manage the active token without losing your branch or PR state — use{' '}
        <span className="text-text-primary">Update token</span> to rotate without logout.
      </p>
      <div className="rounded-sm border border-dashed border-border-subtle p-3 text-xs text-text-dim">
        <p className="mb-2 text-text-muted">When connecting a token, request these scopes:</p>
        <ul className="ml-4 list-disc space-y-0.5">
          <li>
            <code className="text-text-primary">repo</code> — read/write workspace.json on the
            working branch
          </li>
          <li>
            <code className="text-text-primary">pull_request</code> — open PRs from working branch
            to base
          </li>
        </ul>
      </div>
      <div className="rounded-sm border border-dashed border-border-subtle p-6 text-center text-xs text-text-dim">
        Phase 4 — connect, verify scopes, rotate token, and scope-failure recovery modal land here.
      </div>
    </div>
  );
}
