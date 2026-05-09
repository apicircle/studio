import { useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  XCircle,
} from 'lucide-react';
import type { SecretEntry } from '@apicircle/shared';
import {
  GitHubError,
  MissingScopeError,
  RateLimitedError,
  UnauthorizedError,
} from '@apicircle/git';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { cn } from '../../primitives/cn';

type Tab = 'vault' | 'sessions';

/**
 * Secret Vault tab content for the right-side dock. Two sub-tabs:
 *   - Vault    — encrypted named secrets, referenced via `{{LABEL}}`
 *   - Sessions — GitHub PAT/OAuth session for this workspace
 *
 * The dock shell provides width/height; this component fills it and owns
 * the sub-tab strip + scrollable body.
 */
export function SecretVaultDockPanel() {
  const [tab, setTab] = useState<Tab>('vault');

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 border-b border-border-subtle">
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
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {tab === 'vault' ? <VaultTab /> : <SessionsTab />}
      </div>
    </div>
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
  const entries = useWorkspaceStore((s) => Object.values(s.local?.secretIndex.entries ?? {}));
  const addSecret = useWorkspaceStore((s) => s.addSecret);
  const recompute = useWorkspaceStore((s) => s.recomputeSecretUsage);

  const [adding, setAdding] = useState(false);
  const [draftLabel, setDraftLabel] = useState('');
  const [draftValue, setDraftValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const label = draftLabel.trim();
    if (!label || !draftValue) {
      setError('Both label and value are required.');
      return;
    }
    setSubmitting(true);
    try {
      const id = await addSecret({ label, value: draftValue });
      if (!id) {
        setError(`A secret with label "${label}" already exists.`);
        return;
      }
      setDraftLabel('');
      setDraftValue('');
      setAdding(false);
      setError(null);
      // Refresh usedIn — adding a new secret may light up references that
      // were typed before the vault entry existed.
      recompute();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-text-muted">
        Cross-workspace named secrets. Reference any secret by its label as{' '}
        <code className="text-text-primary">{'{{LABEL}}'}</code> in URLs, headers, params, body
        content, or environment variables. Resolution order at send time: context vars → active env
        → priority list → vault.
      </p>

      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium uppercase tracking-wider text-text-dim">
          Entries{entries.length > 0 ? ` (${entries.length})` : ''}
        </h3>
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex h-7 items-center gap-1.5 rounded-sm border border-accent/40 bg-accent/10 px-2.5 text-xs text-accent hover:bg-accent/20"
          >
            <Plus size={12} />
            New secret
          </button>
        )}
      </div>

      {adding && (
        <div className="space-y-2 rounded-sm border border-accent/30 bg-accent/5 p-3">
          <div className="flex gap-2">
            <input
              autoFocus
              value={draftLabel}
              onChange={(e) => setDraftLabel(e.target.value)}
              placeholder="LABEL"
              aria-label="New secret label"
              className="h-7 flex-1 rounded-sm border border-border bg-card px-2 text-xs text-text-primary focus:border-accent focus:outline-none"
            />
            <input
              type="password"
              value={draftValue}
              onChange={(e) => setDraftValue(e.target.value)}
              placeholder="value"
              aria-label="New secret value"
              className="h-7 flex-[2] rounded-sm border border-border bg-card px-2 text-xs text-text-primary focus:border-accent focus:outline-none"
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submit();
                if (e.key === 'Escape') {
                  setAdding(false);
                  setDraftLabel('');
                  setDraftValue('');
                  setError(null);
                }
              }}
            />
          </div>
          {error && <p className="text-xs text-danger">{error}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void submit()}
              disabled={submitting}
              className="inline-flex h-7 items-center rounded-sm border border-accent/40 bg-accent/10 px-3 text-xs text-accent hover:bg-accent/20 disabled:opacity-50"
            >
              {submitting ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={() => {
                setAdding(false);
                setDraftLabel('');
                setDraftValue('');
                setError(null);
              }}
              className="inline-flex h-7 items-center rounded-sm border border-border bg-surface px-3 text-xs text-text-muted hover:text-text-primary"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {entries.length === 0 && !adding && (
        <div className="rounded-sm border border-dashed border-border-subtle p-6 text-center text-xs text-text-dim">
          No secrets yet. Click <span className="text-text-primary">New secret</span> to add one.
        </div>
      )}

      <ul role="list" aria-label="Secret entries" className="flex flex-col gap-1">
        {entries.map((entry) => (
          <SecretRow key={entry.id} entry={entry} />
        ))}
      </ul>

      <div className="rounded-sm border border-border bg-card p-3 text-xs text-text-muted">
        <p className="mb-1 text-text-primary">Master key</p>
        <p>
          Generated on this device on first use and stored in IndexedDB. Reinstalling the app or
          clearing site data drops the key; re-enter your secrets afterwards.
        </p>
      </div>
    </div>
  );
}

interface SecretRowProps {
  entry: SecretEntry;
}

function SecretRow({ entry }: SecretRowProps) {
  const decryptSecret = useWorkspaceStore((s) => s.decryptSecret);
  const removeSecret = useWorkspaceStore((s) => s.removeSecret);

  const [revealed, setRevealed] = useState<string | null>(null);
  const [showUsage, setShowUsage] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const onReveal = async () => {
    if (revealed !== null) {
      setRevealed(null);
      return;
    }
    const plain = await decryptSecret(entry.id);
    setRevealed(plain ?? '(decrypt failed)');
  };

  const usedInCount = entry.usedIn.length;
  const blockedDelete = usedInCount > 0 && !confirmDelete;

  return (
    <li className="rounded-sm border border-border bg-card p-2.5 text-xs">
      <div className="flex items-center gap-2">
        <KeyRound size={12} className="shrink-0 text-text-dim" aria-hidden="true" />
        <span className="font-medium text-text-primary">{entry.label}</span>
        <span
          className={cn(
            'rounded-sm border px-1.5 py-0.5 text-[10px] uppercase tracking-wider',
            entry.origin === 'workspace'
              ? 'border-border-subtle bg-surface text-text-muted'
              : 'border-blue/40 bg-blue/10 text-blue',
          )}
          title={
            entry.origin === 'linked'
              ? `Required by linked workspace ${entry.linkedWorkspaceId ?? ''}`
              : 'Defined in this workspace'
          }
        >
          {entry.origin}
        </span>
        <button
          type="button"
          onClick={() => void onReveal()}
          className="ml-auto inline-flex h-6 items-center gap-1 rounded-sm border border-border bg-surface px-2 text-[10px] text-text-muted hover:text-text-primary"
          aria-label={revealed !== null ? `Hide ${entry.label}` : `Reveal ${entry.label}`}
        >
          {revealed !== null ? <EyeOff size={10} /> : <Eye size={10} />}
          {revealed !== null ? 'Hide' : 'Reveal'}
        </button>
        <button
          type="button"
          onClick={() => {
            if (blockedDelete) {
              setConfirmDelete(true);
              return;
            }
            void removeSecret(entry.id);
          }}
          className={cn(
            'inline-flex h-6 items-center gap-1 rounded-sm border px-2 text-[10px]',
            blockedDelete
              ? 'border-warning/40 bg-warning/10 text-warning'
              : 'border-danger/40 bg-danger/10 text-danger hover:bg-danger/20',
          )}
          aria-label={`Delete ${entry.label}`}
        >
          <Trash2 size={10} />
          {blockedDelete ? `In use (${usedInCount})` : confirmDelete ? 'Confirm' : 'Delete'}
        </button>
      </div>

      {revealed !== null && (
        <pre className="mt-2 break-all rounded-sm border border-border-subtle bg-surface p-2 font-mono text-[11px] text-text-primary">
          {revealed}
        </pre>
      )}

      {usedInCount > 0 && (
        <button
          type="button"
          onClick={() => setShowUsage((v) => !v)}
          className="mt-1 inline-flex items-center gap-1 text-[11px] text-text-dim hover:text-text-muted"
          aria-expanded={showUsage}
          aria-label={`Toggle where ${entry.label} is used`}
        >
          {showUsage ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
          Used in {usedInCount} place{usedInCount === 1 ? '' : 's'}
        </button>
      )}
      {showUsage && usedInCount > 0 && (
        <ul className="mt-1 ml-4 list-disc space-y-0.5 text-[11px] text-text-muted">
          {entry.usedIn.map((u) => (
            <li key={`${u.kind}:${u.id}`}>
              <span className="text-text-dim">{u.kind}</span> · {u.label}
            </li>
          ))}
        </ul>
      )}
      {confirmDelete && (
        <p className="mt-2 text-[11px] text-warning">
          This secret is referenced in {usedInCount} place{usedInCount === 1 ? '' : 's'}. Click{' '}
          <span className="text-text-primary">Confirm</span> to delete anyway, or click anywhere
          else to cancel.
        </p>
      )}
    </li>
  );
}

function SessionsTab() {
  const session = useWorkspaceStore((s) => s.local?.sessions.github ?? null);
  return (
    <div className="space-y-4">
      <p className="text-sm text-text-muted">
        GitHub PAT sessions. Manage the active token without losing your working branch or PR state
        — use <span className="text-text-primary">Update token</span> to rotate without
        disconnecting.
      </p>
      <ScopeGuidance />
      {session ? <ActiveSessionCard /> : <ConnectForm />}
    </div>
  );
}

function ScopeGuidance() {
  return (
    <div className="rounded-sm border border-border bg-card p-3 text-xs text-text-muted">
      <p className="mb-2 text-text-primary">Required PAT scopes</p>
      <ul className="ml-4 list-disc space-y-0.5">
        <li>
          <code className="text-text-primary">repo</code> — required for push to save and read of
          the working branch
        </li>
        <li>
          <code className="text-text-primary">pull_request</code> — required to create PRs from the
          working branch to <code>main</code>
        </li>
      </ul>
      <a
        href="https://github.com/settings/tokens?type=beta"
        target="_blank"
        rel="noreferrer noopener"
        className="mt-2 inline-flex items-center gap-1 text-accent hover:underline"
      >
        Create a token on github.com
        <ExternalLink size={10} aria-hidden="true" />
      </a>
    </div>
  );
}

function ConnectForm() {
  const connect = useWorkspaceStore((s) => s.connectGitHubSession);
  const connectViaDeviceFlow = useWorkspaceStore((s) => s.connectGitHubSessionViaDeviceFlow);
  const [token, setToken] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Device-flow state. While `code` is non-null, the polling loop is
  // running and the UI shows the user_code + verification URL with a
  // Cancel button.
  const [code, setCode] = useState<{
    userCode: string;
    verificationUri: string;
    expiresAt: number;
  } | null>(null);
  const [oauthBusy, setOauthBusy] = useState(false);
  const [oauthError, setOauthError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await connect(token);
      setToken('');
    } catch (err) {
      if (err instanceof MissingScopeError) {
        setError(`Token is missing required scope(s): ${err.missingScopes.join(', ')}`);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Failed to connect — unknown error');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const startOauth = async () => {
    setOauthError(null);
    setOauthBusy(true);
    abortRef.current = new AbortController();
    try {
      await connectViaDeviceFlow({
        onCodeReady: (info) => setCode(info),
        signal: abortRef.current.signal,
      });
      // On success, the session card flips in.
      setCode(null);
    } catch (err) {
      if (err instanceof MissingScopeError) {
        setOauthError(
          `Authorized account is missing required scope(s): ${err.missingScopes.join(', ')}`,
        );
      } else if (err instanceof Error) {
        setOauthError(err.message);
      } else {
        setOauthError('OAuth sign-in failed — unknown error.');
      }
      setCode(null);
    } finally {
      setOauthBusy(false);
      abortRef.current = null;
    }
  };

  const cancelOauth = () => {
    abortRef.current?.abort();
    setCode(null);
    setOauthBusy(false);
  };

  return (
    <div className="space-y-3">
      <div className="space-y-2 rounded-sm border border-accent/30 bg-accent/5 p-3">
        {code ? (
          <DeviceFlowCard code={code} busy={oauthBusy} onCancel={cancelOauth} error={oauthError} />
        ) : (
          <button
            type="button"
            onClick={() => void startOauth()}
            disabled={oauthBusy}
            className="inline-flex h-8 w-full items-center justify-center gap-2 rounded-sm border border-accent/40 bg-accent/10 px-3 text-sm text-accent hover:bg-accent/20 disabled:opacity-50"
            aria-label="Sign in with GitHub"
          >
            <ShieldCheck size={14} aria-hidden="true" />
            Sign in with GitHub
          </button>
        )}
        {oauthError && !code && (
          <p className="text-[11px] text-danger" role="alert">
            {oauthError}
          </p>
        )}
        <p className="text-[10px] text-text-dim">
          OAuth uses GitHub's device flow — no client secret stays in the browser. Configure{' '}
          <code>VITE_GITHUB_OAUTH_CLIENT_ID</code> at build time to enable this.
        </p>
      </div>

      <div className="space-y-2 rounded-sm border border-border bg-surface p-3">
        <p className="text-[11px] font-medium uppercase tracking-wider text-text-dim">
          Or — paste a personal access token
        </p>
        <label htmlFor="pat-input" className="block text-xs text-text-muted">
          Personal access token
        </label>
        <input
          id="pat-input"
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="ghp_… or github_pat_…"
          aria-label="GitHub PAT"
          className="h-8 w-full rounded-sm border border-border bg-card px-2 font-mono text-xs text-text-primary focus:border-accent focus:outline-none"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !submitting) void submit();
          }}
        />
        {error && (
          <p className="text-xs text-danger" role="alert">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void submit()}
            disabled={submitting || !token.trim()}
            className="inline-flex h-7 items-center rounded-sm border border-accent/40 bg-accent/10 px-3 text-xs text-accent hover:bg-accent/20 disabled:opacity-50"
          >
            {submitting ? 'Verifying…' : 'Connect'}
          </button>
        </div>
        <p className="text-[11px] text-text-dim">
          We verify the token via <code>GET /user</code> before storing it. The token is encrypted
          with your local master key — only this browser can decrypt it.
        </p>
      </div>
    </div>
  );
}

function DeviceFlowCard({
  code,
  busy,
  onCancel,
  error,
}: {
  code: { userCode: string; verificationUri: string; expiresAt: number };
  busy: boolean;
  onCancel: () => void;
  error: string | null;
}) {
  // Tick the expiry every second so the user sees the countdown move.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const remaining = Math.max(0, Math.floor((code.expiresAt - now) / 1000));
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  return (
    <div className="space-y-2">
      <p className="text-xs text-text-primary">
        Open{' '}
        <a
          href={code.verificationUri}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-1 text-accent underline-offset-2 hover:underline"
        >
          {code.verificationUri.replace(/^https?:\/\//, '')}
          <ExternalLink size={11} aria-hidden="true" />
        </a>{' '}
        and enter this code:
      </p>
      <div className="flex items-center gap-2">
        <code
          aria-label="Device flow user code"
          className="flex-1 select-all rounded-sm border border-accent/40 bg-card px-3 py-2 text-center font-mono text-lg tracking-widest text-text-primary"
        >
          {code.userCode}
        </code>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(code.userCode);
          }}
          aria-label="Copy device flow code"
          className="inline-flex h-9 items-center rounded-sm border border-border bg-surface px-3 text-[11px] text-text-muted hover:border-border-strong hover:text-text-primary"
        >
          Copy
        </button>
      </div>
      <p className="text-[10px] text-text-dim">
        Expires in{' '}
        <strong className="text-text-primary">
          {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
        </strong>
        {busy ? ' · waiting for GitHub authorization…' : ''}
      </p>
      {error && (
        <p className="text-[11px] text-danger" role="alert">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex h-7 items-center rounded-sm border border-border bg-surface px-3 text-xs text-text-muted hover:border-border-strong hover:text-text-primary"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// Required scopes for the in-app linking + push flow. Surfaced on the
// session card so the user can see at a glance whether their token
// covers everything before they hit a 403 mid-link.
const REQUIRED_SESSION_SCOPES = ['repo'] as const;
const RECOMMENDED_SESSION_SCOPES = ['pull_request'] as const;

function ScopeChip({ name, ok, required }: { name: string; ok: boolean; required?: boolean }) {
  const tone = ok
    ? 'border-success/40 bg-success/10 text-success'
    : required
      ? 'border-danger/40 bg-danger/10 text-danger'
      : 'border-warning/40 bg-warning/10 text-warning';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 font-mono text-[10px] ${tone}`}
      aria-label={`${name} scope ${ok ? 'present' : required ? 'missing (required)' : 'missing (recommended)'}`}
      title={
        ok
          ? `${name}: present`
          : required
            ? `${name}: missing — required for linking + push`
            : `${name}: missing — recommended for PR creation`
      }
    >
      {ok ? <CheckCircle2 size={9} aria-hidden="true" /> : <XCircle size={9} aria-hidden="true" />}
      {name}
      {required && !ok ? '*' : ''}
    </span>
  );
}

type ConnectionTestResult =
  | { kind: 'pass'; grantedScopes: string[] }
  | {
      kind: 'fail';
      reason: 'unauthorized' | 'rate-limited' | 'scope' | 'network' | 'other';
      message: string;
    };

function ActiveSessionCard() {
  const session = useWorkspaceStore((s) => s.local!.sessions.github!);
  const verify = useWorkspaceStore((s) => s.verifyGitHubScopes);
  const updateToken = useWorkspaceStore((s) => s.updateGitHubToken);
  const disconnect = useWorkspaceStore((s) => s.disconnectGitHubSession);

  const [verifying, setVerifying] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [showUpdate, setShowUpdate] = useState(false);
  const [newToken, setNewToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);

  const onVerify = async () => {
    setVerifying(true);
    setError(null);
    setTestResult(null);
    try {
      const granted = await verify();
      // verify() returns null when there's no session at all. Treat as fail.
      if (granted === null) {
        setTestResult({
          kind: 'fail',
          reason: 'other',
          message: 'No session to test — reconnect.',
        });
        return;
      }
      setTestResult({ kind: 'pass', grantedScopes: granted });
    } catch (err) {
      // Map error types to user-friendly reasons so the user knows what
      // to fix instead of guessing from a raw stack trace.
      if (err instanceof UnauthorizedError) {
        setTestResult({
          kind: 'fail',
          reason: 'unauthorized',
          message:
            'Token rejected by GitHub (401). The PAT may be revoked or expired — reconnect to refresh.',
        });
      } else if (err instanceof RateLimitedError) {
        setTestResult({
          kind: 'fail',
          reason: 'rate-limited',
          message: 'GitHub rate-limited the verify call. Try again in a few minutes.',
        });
      } else if (err instanceof MissingScopeError) {
        setTestResult({
          kind: 'fail',
          reason: 'scope',
          message: `Token missing required scope(s): ${err.missingScopes.join(', ')}. Update the token from this card.`,
        });
      } else if (err instanceof GitHubError) {
        setTestResult({
          kind: 'fail',
          reason: 'other',
          message: `GitHub error ${err.status}: ${err.message}`,
        });
      } else if (err instanceof Error) {
        // Network error / fetch failure / DNS — TypeError from fetch.
        const isNetwork = err.name === 'TypeError' || /fetch|network/i.test(err.message);
        setTestResult({
          kind: 'fail',
          reason: isNetwork ? 'network' : 'other',
          message: isNetwork ? 'Network error — check your connection and try again.' : err.message,
        });
      } else {
        setTestResult({
          kind: 'fail',
          reason: 'other',
          message: 'Test failed with an unknown error.',
        });
      }
    } finally {
      setVerifying(false);
    }
  };

  const onUpdate = async () => {
    setUpdating(true);
    setError(null);
    try {
      await updateToken(newToken);
      setNewToken('');
      setShowUpdate(false);
    } catch (err) {
      if (err instanceof MissingScopeError) {
        setError(`New token still missing scope(s): ${err.missingScopes.join(', ')}`);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Update failed — unknown error');
      }
    } finally {
      setUpdating(false);
    }
  };

  const missingRequired = REQUIRED_SESSION_SCOPES.filter((s) => !session.grantedScopes.includes(s));
  const missingRecommended = RECOMMENDED_SESSION_SCOPES.filter(
    (s) => !session.grantedScopes.includes(s),
  );

  return (
    <div className="space-y-3 rounded-sm border border-success/30 bg-success/5 p-3">
      <div className="flex items-center gap-2">
        <CheckCircle2 size={14} className="text-success" aria-hidden="true" />
        <span className="text-sm font-medium text-text-primary">
          Connected as {session.accountLogin}
        </span>
      </div>
      <dl className="grid grid-cols-[120px_1fr] gap-y-1 text-xs">
        <dt className="text-text-dim">Required scopes</dt>
        <dd className="flex flex-wrap items-center gap-1.5 text-text-primary">
          {REQUIRED_SESSION_SCOPES.map((s) => (
            <ScopeChip key={s} name={s} ok={session.grantedScopes.includes(s)} required />
          ))}
          {RECOMMENDED_SESSION_SCOPES.map((s) => (
            <ScopeChip key={s} name={s} ok={session.grantedScopes.includes(s)} />
          ))}
        </dd>
        <dt className="text-text-dim">Granted scopes</dt>
        <dd className="text-text-primary">
          {session.grantedScopes.length > 0 ? session.grantedScopes.join(', ') : '—'}
        </dd>
        <dt className="text-text-dim">Last verified</dt>
        <dd className="text-text-primary">
          {session.lastVerifiedAt ? new Date(session.lastVerifiedAt).toLocaleString() : 'never'}
        </dd>
      </dl>
      {missingRequired.length > 0 && (
        <p className="rounded-sm border border-danger/40 bg-danger/10 p-2 text-[11px] text-danger">
          Required scope(s) missing: <code>{missingRequired.join(', ')}</code>. Linking and push to
          save will fail until you update the token.
        </p>
      )}
      {missingRequired.length === 0 && missingRecommended.length > 0 && (
        <p className="rounded-sm border border-warning/40 bg-warning/10 p-2 text-[11px] text-warning">
          Recommended scope(s) missing: <code>{missingRecommended.join(', ')}</code>. Push to save
          works, but creating PRs from the app will fail until you update the token.
        </p>
      )}
      {testResult && (
        <p
          role="status"
          className={
            testResult.kind === 'pass'
              ? 'flex items-start gap-1.5 rounded-sm border border-success/40 bg-success/10 p-2 text-[11px] text-success'
              : 'flex items-start gap-1.5 rounded-sm border border-danger/40 bg-danger/10 p-2 text-[11px] text-danger'
          }
        >
          {testResult.kind === 'pass' ? (
            <CheckCircle2 size={12} aria-hidden="true" className="mt-0.5 shrink-0" />
          ) : (
            <XCircle size={12} aria-hidden="true" className="mt-0.5 shrink-0" />
          )}
          <span>
            {testResult.kind === 'pass'
              ? `Connection healthy — token verified, scopes refreshed.`
              : testResult.message}
          </span>
        </p>
      )}
      {error && (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      )}
      {showUpdate ? (
        <div className="space-y-2 rounded-sm border border-accent/30 bg-accent/5 p-2">
          <input
            type="password"
            value={newToken}
            onChange={(e) => setNewToken(e.target.value)}
            placeholder="New PAT (must belong to the same account)"
            aria-label="New GitHub PAT"
            className="h-7 w-full rounded-sm border border-border bg-card px-2 font-mono text-xs text-text-primary focus:border-accent focus:outline-none"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void onUpdate()}
              disabled={updating || !newToken.trim()}
              className="inline-flex h-7 items-center rounded-sm border border-accent/40 bg-accent/10 px-3 text-xs text-accent hover:bg-accent/20 disabled:opacity-50"
            >
              {updating ? 'Verifying…' : 'Update'}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowUpdate(false);
                setNewToken('');
                setError(null);
              }}
              className="inline-flex h-7 items-center rounded-sm border border-border bg-surface px-3 text-xs text-text-muted hover:text-text-primary"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void onVerify()}
            disabled={verifying}
            aria-label="Test GitHub connection"
            className="inline-flex h-7 items-center gap-1.5 rounded-sm border border-border bg-surface px-3 text-xs text-text-muted hover:border-border-strong hover:text-text-primary disabled:opacity-50"
          >
            <RefreshCw size={12} className={verifying ? 'animate-spin' : ''} />
            {verifying ? 'Testing…' : 'Test connection'}
          </button>
          <button
            type="button"
            onClick={() => setShowUpdate(true)}
            className="inline-flex h-7 items-center rounded-sm border border-accent/40 bg-accent/10 px-3 text-xs text-accent hover:bg-accent/20"
          >
            Update token
          </button>
          <button
            type="button"
            onClick={() => {
              if (confirmDisconnect) {
                void disconnect();
                setConfirmDisconnect(false);
              } else {
                setConfirmDisconnect(true);
              }
            }}
            className={cn(
              'inline-flex h-7 items-center rounded-sm border px-3 text-xs',
              confirmDisconnect
                ? 'border-danger/40 bg-danger/10 text-danger hover:bg-danger/20'
                : 'border-border bg-surface text-text-muted hover:text-text-primary',
            )}
          >
            {confirmDisconnect ? 'Confirm disconnect' : 'Disconnect'}
          </button>
        </div>
      )}
    </div>
  );
}
