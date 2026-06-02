// Unified Import modal — auto-detects source format from pasted JSON or
// cURL string, previews the parsed result, and routes Import to the right
// store action. Replaces the per-format ImportCurlModal and
// ImportCollectionModal entry points.
//
// Supported formats:
//   - Postman v2.1 collection
//   - Postman environment
//   - Insomnia v4 export (collection + requests)
//   - cURL command (single request)
//   - API Circle exchange — covers both folder exports
//     (`"format": "apicircle.folder/v1"`) AND environment exports
//     (`"apicircleEnvironment": 1`). The parser picks the right shape from
//     the document's magic key.
//
// The user can override auto-detect via the source-format dropdown.

import { useMemo, useRef, useState } from 'react';
import {
  FileJson,
  FlaskConical,
  FolderTree,
  KeyRound,
  Package,
  Send,
  Sparkles,
} from 'lucide-react';
import {
  isApicircleEnvironment,
  isApicircleFolderExport,
  isInsomniaExport,
  isPostmanEnvironment,
  isPostmanV2Collection,
  parseApicircleEnvironment,
  parseApicircleFolderExport,
  parseCurl,
  parseInsomniaCollection,
  parsePostmanCollection,
  parsePostmanEnvironment,
  type ParsedApicircleEnvironment,
  type ParsedApicircleFolderExport,
  type ParsedCurl,
  type ParsedPostmanCollection,
  type ParsedPostmanEnvironment,
} from '@apicircle/core';
import {
  useWorkspaceStore,
  type ApicircleEnvironmentPendingBinding,
} from '../../store/workspaceStore';
import { Modal } from '../../primitives/Modal';
import { Select } from '../../primitives/Select';
import { cn } from '../../primitives/cn';

type SourceFormat = 'auto' | 'postman' | 'postman-env' | 'insomnia' | 'curl' | 'apicircle';
type DetectedKind =
  | { kind: 'postman-collection'; parsed: ParsedPostmanCollection }
  | { kind: 'postman-environment'; parsed: ParsedPostmanEnvironment }
  | { kind: 'insomnia-collection'; parsed: ParsedPostmanCollection }
  | { kind: 'curl'; parsed: ParsedCurl }
  | { kind: 'apicircle-folder'; parsed: ParsedApicircleFolderExport }
  | { kind: 'apicircle-environment'; parsed: ParsedApicircleEnvironment };

interface ImportModalProps {
  open: boolean;
  onClose: () => void;
  parentFolderId?: string | null;
  /** Optional initial text — passed when triggered from a paste-shortcut. */
  initialText?: string;
  /** Optional initial format override (e.g. when launched from a "paste cURL" CTA). */
  initialFormat?: SourceFormat;
}

const FORMAT_LABELS: Record<SourceFormat, string> = {
  auto: 'Auto-detect',
  postman: 'Postman v2.1 collection',
  'postman-env': 'Postman environment',
  insomnia: 'Insomnia v4 export',
  curl: 'cURL command',
  apicircle: 'API Circle exchange',
};

// Export both named and default so consumers can either:
//   - `import { ImportModal }` (the eager path — kept for tests + back-compat)
//   - `React.lazy(() => import('./ImportModal'))` (the production path used by
//     EditorSidebar / EnvironmentsSidebar via `ImportModalLazy`)
//
// The lazy path defers the Postman / Insomnia / cURL parser bundle until
// the user actually opens the modal — those parsers are several hundred
// kilobytes of dead weight on initial app load otherwise.
export default ImportModal;
export function ImportModal({
  open,
  onClose,
  parentFolderId = null,
  initialText = '',
  initialFormat = 'auto',
}: ImportModalProps) {
  const [text, setText] = useState(initialText);
  const [format, setFormat] = useState<SourceFormat>(initialFormat);
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Two-step state — `detect` is the default paste/upload screen; `bind`
  // appears only after an API Circle environment import lands with
  // unresolved encrypted bindings. The user can fill values + bind, or
  // skip; either way the import is already persisted.
  const [step, setStep] = useState<'detect' | 'bind'>('detect');
  const [pendingBindings, setPendingBindings] = useState<ApicircleEnvironmentPendingBinding[]>([]);
  const [bindValues, setBindValues] = useState<Record<string, string>>({});
  const [binding, setBinding] = useState(false);

  const importPostmanCollection = useWorkspaceStore((s) => s.importPostmanCollection);
  const importPostmanEnvironment = useWorkspaceStore((s) => s.importPostmanEnvironment);
  const importApicircleFolder = useWorkspaceStore((s) => s.importApicircleFolder);
  const importApicircleEnvironment = useWorkspaceStore((s) => s.importApicircleEnvironment);
  const addRequestFromCurl = useWorkspaceStore((s) => s.addRequestFromCurl);
  const pushToast = useWorkspaceStore((s) => s.pushToast);
  const addSecret = useWorkspaceStore((s) => s.addSecret);
  const setVariables = useWorkspaceStore((s) => s.setVariables);
  const bindVariableToSecretKey = useWorkspaceStore((s) => s.bindVariableToSecretKey);
  const secretLockState = useWorkspaceStore((s) => s.secretLockState);
  const openPassphraseSetup = useWorkspaceStore((s) => s.openPassphraseSetup);
  const openPassphraseUnlock = useWorkspaceStore((s) => s.openPassphraseUnlock);

  const result: { detected: DetectedKind | null; error: string | null } = useMemo(() => {
    if (!text.trim()) return { detected: null, error: null };
    try {
      return { detected: detect(text, format), error: null };
    } catch (err) {
      return { detected: null, error: err instanceof Error ? err.message : String(err) };
    }
  }, [text, format]);

  if (!open) return null;

  const onImport = () => {
    if (!result.detected) return;
    const d = result.detected;
    if (d.kind === 'postman-collection' || d.kind === 'insomnia-collection') {
      importPostmanCollection(d.parsed, parentFolderId);
    } else if (d.kind === 'postman-environment') {
      importPostmanEnvironment(d.parsed);
    } else if (d.kind === 'curl') {
      addRequestFromCurl(text, parentFolderId);
    } else if (d.kind === 'apicircle-folder') {
      const result = importApicircleFolder(d.parsed, parentFolderId);
      if (result && result.filesRequiringReattachment.length > 0) {
        const count = result.filesRequiringReattachment.length;
        pushToast({
          tone: 'info',
          title: `Imported "${result.rootFolderName}" — file re-attach required`,
          detail: `${count} file asset${count === 1 ? '' : 's'} landed without bytes. Open Global Assets → Global Files to re-attach.`,
          ttlMs: 12000,
        });
      }
    } else if (d.kind === 'apicircle-environment') {
      const result = importApicircleEnvironment(d.parsed);
      // Closed state: no synced doc loaded — nothing more we can do.
      if (!result) {
        setText('');
        onClose();
        return;
      }
      // Surface parser warnings as an info toast (gap from earlier
      // review: silent drops shouldn't go un-mentioned).
      if (result.warnings.length > 0) {
        pushToast({
          tone: 'info',
          title: `Imported "${result.name}" with notices`,
          detail: result.warnings.join(' · '),
          ttlMs: 12000,
        });
      }
      // When some encrypted rows couldn't be auto-resolved against the
      // destination's vault, switch to the bind step so the user can
      // provide values without leaving the modal. The import has already
      // landed — skipping is safe and the env is still usable, just with
      // dangling bindings the user can fix later under Environments.
      if (result.pendingBindings.length > 0) {
        setPendingBindings(result.pendingBindings);
        setBindValues({});
        setStep('bind');
        return;
      }
      pushToast({
        tone: 'success',
        title: `Imported "${result.name}"`,
        ttlMs: 6000,
      });
    }
    setText('');
    onClose();
  };

  const closeAndReset = () => {
    setText('');
    setStep('detect');
    setPendingBindings([]);
    setBindValues({});
    setBinding(false);
    onClose();
  };

  /**
   * Bind every filled value: addSecret creates a fresh vault slot under
   * the binding's label, setVariables seeds the row's plaintext with the
   * provided value, then bindVariableToSecretKey encrypts that plaintext
   * under the slot's derived key. Empty values are treated as per-row
   * skips so the user can resolve some bindings and defer others without
   * cancelling the whole batch.
   */
  const onBindFinish = async () => {
    setBinding(true);
    let bound = 0;
    let failed = 0;
    try {
      for (const b of pendingBindings) {
        const value = (bindValues[b.varKey] ?? '').trim();
        if (!value) continue;
        const env = useWorkspaceStore.getState().synced?.environments.items[b.envName];
        if (!env) {
          failed += 1;
          continue;
        }
        const idx = env.variables.findIndex((v) => v.key === b.varKey);
        if (idx < 0) {
          failed += 1;
          continue;
        }
        const slotId = await addSecret({
          label: b.label,
          value,
          origin: 'workspace',
        });
        if (!slotId) {
          failed += 1;
          continue;
        }
        // Stage the row's plaintext so bindVariableToSecretKey has
        // something to encrypt. The bind step persists the ciphertext.
        const nextVars = env.variables.map((v, i) =>
          i === idx ? { ...v, value, encrypted: false, secretKeyId: undefined } : v,
        );
        setVariables(b.envName, nextVars);
        const ok = await bindVariableToSecretKey(b.envName, idx, slotId);
        if (ok) bound += 1;
        else failed += 1;
      }
    } finally {
      setBinding(false);
    }
    if (bound > 0) {
      pushToast({
        tone: 'success',
        title: `Bound ${bound} secret${bound === 1 ? '' : 's'}`,
        detail:
          failed > 0 ? `${failed} could not be bound — try again from Environments.` : undefined,
        ttlMs: 8000,
      });
    } else if (failed > 0) {
      pushToast({
        tone: 'error',
        title: 'Could not bind secrets',
        detail: 'Try again from Environments, or set a vault passphrase first.',
        ttlMs: 10000,
      });
    }
    closeAndReset();
  };

  const onSkipBindings = () => {
    if (pendingBindings.length > 0) {
      pushToast({
        tone: 'info',
        title: `${pendingBindings.length} secret binding${pendingBindings.length === 1 ? '' : 's'} skipped`,
        detail:
          'Open Environments to bind these later — the variables will resolve to empty until then.',
        ttlMs: 10000,
      });
    }
    closeAndReset();
  };

  const onUpload = (file: File) => {
    setReading(true);
    setReadError(null);
    file
      .text()
      .then((c) => {
        setText(c);
        setFormat('auto');
      })
      .catch((err) => {
        setReadError(err instanceof Error ? err.message : 'Could not read file.');
      })
      .finally(() => setReading(false));
  };

  const detectedLabel = result.detected ? labelForDetection(result.detected) : null;

  if (step === 'bind') {
    return (
      <Modal open onClose={onSkipBindings} title="Provide secret values">
        <BindStep
          bindings={pendingBindings}
          values={bindValues}
          onChangeValues={setBindValues}
          vaultState={secretLockState}
          binding={binding}
          onBindFinish={() => {
            void onBindFinish();
          }}
          onSkip={onSkipBindings}
          openPassphraseSetup={openPassphraseSetup}
          openPassphraseUnlock={openPassphraseUnlock}
        />
      </Modal>
    );
  }

  return (
    <Modal open onClose={onClose} title="Import">
      <div className="flex w-full flex-col gap-4 text-xs">
        <div className="flex items-center gap-2">
          <label
            htmlFor="import-source-format"
            className="text-[0.6875rem] uppercase tracking-wide text-text-dim"
          >
            Source
          </label>
          <Select
            id="import-source-format"
            value={format}
            onChange={(e) => setFormat(e.target.value as SourceFormat)}
          >
            {(Object.keys(FORMAT_LABELS) as SourceFormat[]).map((k) => (
              <option key={k} value={k}>
                {FORMAT_LABELS[k]}
              </option>
            ))}
          </Select>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={reading}
            className="ml-auto inline-flex h-7 items-center gap-1 rounded-sm border border-border bg-surface px-2 text-[0.6875rem] text-text-muted hover:border-accent hover:text-text-primary disabled:opacity-50"
          >
            <FileJson size={11} />
            {reading ? 'Reading…' : 'Upload .json'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json,.har,.txt"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onUpload(file);
              e.target.value = '';
            }}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder='Paste Postman / Insomnia / API Circle JSON, or a "curl …" command'
            spellCheck={false}
            aria-label="Import source"
            className="min-h-[200px] w-full rounded-sm border border-border bg-card p-2.5 font-mono text-[0.6875rem] text-text-primary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30"
          />
          <p className="text-[0.625rem] text-text-dim">
            Auto-detect picks the right parser; force a format above if a file looks ambiguous.
          </p>
          {readError && (
            <p role="alert" className="text-[0.6875rem] text-danger">
              {readError}
            </p>
          )}
        </div>

        {result.error && (
          <p
            role="alert"
            className="rounded-sm border border-danger/30 bg-danger/5 px-2.5 py-1.5 text-[0.6875rem] text-danger"
          >
            {result.error}
          </p>
        )}

        {result.detected && (
          <div className="flex flex-col gap-1.5 rounded-sm border border-border-subtle bg-card p-3">
            <header className="flex items-center gap-2 text-[0.6875rem]">
              {result.detected.kind === 'curl' ? (
                <Sparkles size={12} className="text-accent" />
              ) : result.detected.kind === 'postman-environment' ||
                result.detected.kind === 'apicircle-environment' ? (
                <FlaskConical size={12} className="text-accent" />
              ) : result.detected.kind === 'apicircle-folder' ? (
                <Package size={12} className="text-accent" />
              ) : (
                <FolderTree size={12} className="text-accent" />
              )}
              <span className="font-medium text-text-primary">{detectedLabel}</span>
            </header>
            <DetectionPreview detection={result.detected} />
          </div>
        )}

        <footer className="flex items-center justify-end gap-2 border-t border-border-subtle pt-3">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 items-center rounded-sm border border-border bg-surface px-3 text-[0.6875rem] text-text-muted hover:border-accent hover:text-text-primary"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onImport}
            disabled={!result.detected}
            className={cn(
              'inline-flex h-8 items-center rounded-sm border px-3 text-[0.6875rem]',
              result.detected
                ? 'border-accent/40 bg-accent/15 text-accent hover:bg-accent/25'
                : 'border-border bg-surface text-text-faint',
            )}
          >
            <Send size={11} className="mr-1" />
            Import
          </button>
        </footer>
      </div>
    </Modal>
  );
}

function detect(text: string, format: SourceFormat): DetectedKind {
  const trimmed = text.trim();

  // cURL is detected by prefix; never via JSON.parse.
  if ((format === 'curl' || format === 'auto') && /^curl\s/i.test(trimmed)) {
    const parsed = parseCurl(trimmed);
    return { kind: 'curl', parsed };
  }
  if (format === 'curl') {
    throw new Error('Selected source is "cURL" but the input doesn\'t start with "curl ".');
  }

  // The remaining formats are JSON.
  let json: unknown;
  try {
    json = JSON.parse(trimmed);
  } catch (err) {
    throw new Error(`Couldn't parse JSON: ${err instanceof Error ? err.message : String(err)}`);
  }

  // The "API Circle exchange" source covers both folder and environment
  // exports — they share the same dropdown entry but ship distinct magic
  // keys (`format: 'apicircle.folder/v1'` vs `apicircleEnvironment: 1`).
  // Sniff the document; if the user forced this format on an unrecognised
  // shape, fall through to the folder parser so they get the clearer
  // "expected an API Circle folder export" error.
  if (isApicircleEnvironment(json)) {
    return { kind: 'apicircle-environment', parsed: parseApicircleEnvironment(trimmed) };
  }
  if (format === 'apicircle' || isApicircleFolderExport(json)) {
    return {
      kind: 'apicircle-folder',
      parsed: parseApicircleFolderExport(trimmed),
    };
  }

  if (format === 'postman' || (format === 'auto' && isPostmanV2Collection(json))) {
    return { kind: 'postman-collection', parsed: parsePostmanCollection(trimmed) };
  }

  if (format === 'postman-env' || (format === 'auto' && isPostmanEnvironment(json))) {
    return {
      kind: 'postman-environment',
      parsed: parsePostmanEnvironment(trimmed),
    };
  }

  if (format === 'insomnia' || (format === 'auto' && isInsomniaExport(json))) {
    return { kind: 'insomnia-collection', parsed: parseInsomniaCollection(trimmed) };
  }

  throw new Error(
    'Format not recognized. Pick a specific source from the dropdown if auto-detect missed.',
  );
}

function labelForDetection(d: DetectedKind): string {
  if (d.kind === 'postman-collection') {
    return `${d.parsed.collectionName} · ${d.parsed.requests.length} request${d.parsed.requests.length === 1 ? '' : 's'} (Postman)`;
  }
  if (d.kind === 'postman-environment') {
    return `${d.parsed.name} · ${d.parsed.variables.length} variable${d.parsed.variables.length === 1 ? '' : 's'} (Postman environment)`;
  }
  if (d.kind === 'insomnia-collection') {
    return `${d.parsed.collectionName} · ${d.parsed.requests.length} request${d.parsed.requests.length === 1 ? '' : 's'} (Insomnia)`;
  }
  if (d.kind === 'curl') {
    return `${d.parsed.method} ${d.parsed.url || '(no URL)'} (cURL)`;
  }
  if (d.kind === 'apicircle-environment') {
    return `${d.parsed.name} · ${d.parsed.variables.length} variable${d.parsed.variables.length === 1 ? '' : 's'} (API Circle environment)`;
  }
  const folderCount = d.parsed.subfolders.length + 1;
  return `${d.parsed.rootFolder.name} · ${d.parsed.requests.length} request${d.parsed.requests.length === 1 ? '' : 's'}, ${folderCount} folder${folderCount === 1 ? '' : 's'} (API Circle)`;
}

function DetectionPreview({ detection }: { detection: DetectedKind }) {
  if (detection.kind === 'postman-collection' || detection.kind === 'insomnia-collection') {
    return <CollectionPreview parsed={detection.parsed} />;
  }
  if (detection.kind === 'postman-environment') {
    return <EnvironmentPreview parsed={detection.parsed} />;
  }
  if (detection.kind === 'curl') {
    return <CurlPreview parsed={detection.parsed} />;
  }
  if (detection.kind === 'apicircle-environment') {
    return <ApicircleEnvironmentPreview parsed={detection.parsed} />;
  }
  return <ApicircleFolderPreview parsed={detection.parsed} />;
}

/**
 * Second step of the API Circle environment import flow. The env has
 * already been persisted with the source's original `secretKeyId`s on
 * the encrypted rows; this step lets the user provide a value per
 * unresolved binding, which we then turn into a fresh vault slot +
 * bound ciphertext on the row. Skippable — the env is usable either way.
 */
function BindStep({
  bindings,
  values,
  onChangeValues,
  vaultState,
  binding,
  onBindFinish,
  onSkip,
  openPassphraseSetup,
  openPassphraseUnlock,
}: {
  bindings: ApicircleEnvironmentPendingBinding[];
  values: Record<string, string>;
  onChangeValues: (next: Record<string, string>) => void;
  vaultState: 'unset' | 'locked' | 'unlocked';
  binding: boolean;
  onBindFinish: () => void;
  onSkip: () => void;
  openPassphraseSetup: () => void;
  openPassphraseUnlock: () => void;
}) {
  const envName = bindings[0]?.envName ?? '';
  const filledCount = bindings.filter((b) => (values[b.varKey] ?? '').trim().length > 0).length;
  const vaultBlocked = vaultState !== 'unlocked';
  const canBind = !binding && !vaultBlocked && filledCount > 0;

  return (
    <div className="flex w-full flex-col gap-4 text-xs">
      <header className="flex flex-col gap-1">
        <div className="flex items-center gap-1.5 text-text-primary">
          <KeyRound size={12} className="text-accent" />
          <span className="font-medium">
            {bindings.length} secret binding{bindings.length === 1 ? '' : 's'} for &ldquo;{envName}
            &rdquo;
          </span>
        </div>
        <p className="text-[0.6875rem] text-text-muted">
          The imported environment expects vault slots that don&rsquo;t exist on this workspace yet.
          Provide a value for each one to bind it now, or skip — the variables will resolve to empty
          until you bind them under Environments.
        </p>
      </header>

      {vaultBlocked && (
        <div
          role="alert"
          className="flex flex-col gap-1.5 rounded-sm border border-amber/30 bg-amber/5 px-3 py-2 text-[0.6875rem] text-amber"
        >
          <span className="font-medium">
            {vaultState === 'unset'
              ? 'Set a vault passphrase to bind these secrets.'
              : 'Unlock the vault to bind these secrets.'}
          </span>
          <span className="text-text-muted">
            {vaultState === 'unset'
              ? 'Bound values are encrypted at rest with a key derived from your passphrase. Until one is set, the workspace can’t store secrets.'
              : 'Your in-memory key was cleared (cold start or idle-lock). Unlock to resume.'}
          </span>
          <button
            type="button"
            onClick={vaultState === 'unset' ? openPassphraseSetup : openPassphraseUnlock}
            className="mt-1 inline-flex h-7 w-fit items-center rounded-sm border border-amber/40 bg-amber/10 px-2 text-[0.6875rem] text-amber hover:bg-amber/20"
          >
            {vaultState === 'unset' ? 'Set passphrase' : 'Unlock vault'}
          </button>
        </div>
      )}

      <ul className="flex flex-col gap-2">
        {bindings.map((b) => (
          <li
            key={b.varKey}
            className="flex flex-col gap-1 rounded-sm border border-border-subtle bg-card p-2.5"
          >
            <div className="flex items-baseline justify-between gap-2 text-[0.6875rem]">
              <span className="font-medium text-text-primary">{b.label}</span>
              <span className="text-text-dim">
                binds to <code>{b.varKey}</code>
              </span>
            </div>
            {b.labelFromFallback && (
              <p className="text-[0.625rem] text-text-dim">
                The source export didn&rsquo;t carry a slot label — using the variable key as a
                fallback name. You can rename the slot later under Settings &rarr; Vault.
              </p>
            )}
            <input
              type="password"
              autoComplete="new-password"
              value={values[b.varKey] ?? ''}
              onChange={(e) => onChangeValues({ ...values, [b.varKey]: e.target.value })}
              placeholder="Value (leave blank to skip)"
              aria-label={`Secret value for ${b.label}`}
              disabled={binding || vaultBlocked}
              className="h-8 rounded-sm border border-border bg-surface px-2 font-mono text-[0.6875rem] text-text-primary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30 disabled:cursor-not-allowed disabled:opacity-60"
            />
          </li>
        ))}
      </ul>

      <footer className="flex items-center justify-end gap-2 border-t border-border-subtle pt-3">
        <button
          type="button"
          onClick={onSkip}
          disabled={binding}
          className="inline-flex h-8 items-center rounded-sm border border-border bg-surface px-3 text-[0.6875rem] text-text-muted hover:border-accent hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-60"
        >
          Skip & finish
        </button>
        <button
          type="button"
          onClick={onBindFinish}
          disabled={!canBind}
          className={cn(
            'inline-flex h-8 items-center rounded-sm border px-3 text-[0.6875rem]',
            canBind
              ? 'border-accent/40 bg-accent/15 text-accent hover:bg-accent/25'
              : 'border-border bg-surface text-text-faint',
          )}
        >
          <KeyRound size={11} className="mr-1" />
          {binding
            ? 'Binding…'
            : filledCount === 0
              ? 'Bind & finish'
              : `Bind ${filledCount} & finish`}
        </button>
      </footer>
    </div>
  );
}

function ApicircleEnvironmentPreview({ parsed }: { parsed: ParsedApicircleEnvironment }) {
  const encryptedCount = parsed.variables.filter((v) => v.encrypted).length;
  return (
    <div className="flex flex-col gap-1.5 text-[0.6875rem]">
      <div className="grid grid-cols-[120px_1fr] gap-y-1">
        <span className="text-text-dim">Environment</span>
        <span className="font-medium text-text-primary">{parsed.name}</span>
        <span className="text-text-dim">Variables</span>
        <span className="text-text-primary">
          {parsed.variables.length}
          {encryptedCount > 0 && (
            <span className="text-text-dim"> · {encryptedCount} secret-bound</span>
          )}
        </span>
      </div>
      {parsed.variables.length > 0 && (
        <ul className="max-h-40 overflow-y-auto rounded-sm border border-border-subtle bg-surface p-2 font-mono text-[0.625rem]">
          {parsed.variables.slice(0, 30).map((v, i) => (
            <li key={i} className="grid grid-cols-[140px_1fr] gap-2 py-0.5">
              <span className="truncate text-text-muted">{v.key}</span>
              <span className="truncate text-text-primary">
                {v.encrypted ? (
                  <em className="not-italic text-text-dim">(secret · bind on import)</em>
                ) : v.value ? (
                  v.value
                ) : (
                  <em className="text-text-dim">(empty)</em>
                )}
              </span>
            </li>
          ))}
          {parsed.variables.length > 30 && (
            <li className="px-1 py-1 text-text-dim">+ {parsed.variables.length - 30} more</li>
          )}
        </ul>
      )}
      {parsed.warnings.length > 0 && (
        <ul className="flex flex-col gap-0.5 text-[0.625rem] text-amber">
          {parsed.warnings.slice(0, 5).map((w, i) => (
            <li key={i}>· {w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ApicircleFolderPreview({ parsed }: { parsed: ParsedApicircleFolderExport }) {
  const schemaCount = parsed.dependencies.schemas.length;
  const graphqlCount = parsed.dependencies.graphql.length;
  const fileCount = parsed.dependencies.files.length;
  const hasDeps = schemaCount + graphqlCount + fileCount > 0;
  return (
    <div className="flex flex-col gap-1.5 text-[0.6875rem]">
      <div className="grid grid-cols-[120px_1fr] gap-y-1">
        <span className="text-text-dim">Root folder</span>
        <span className="font-medium text-text-primary">{parsed.rootFolder.name}</span>
        <span className="text-text-dim">Subfolders</span>
        <span className="text-text-primary">{parsed.subfolders.length}</span>
        <span className="text-text-dim">Requests</span>
        <span className="text-text-primary">{parsed.requests.length}</span>
      </div>
      {hasDeps && (
        <div className="rounded-sm border border-border-subtle bg-surface p-2">
          <div className="mb-1 text-[0.625rem] uppercase tracking-wide text-text-dim">
            Captured dependencies
          </div>
          <ul className="flex flex-col gap-0.5 text-text-muted">
            {schemaCount > 0 && (
              <li>
                <span className="text-text-primary">{schemaCount}</span> JSON schema
                {schemaCount === 1 ? '' : 's'} (embedded — added to Global Assets)
              </li>
            )}
            {graphqlCount > 0 && (
              <li>
                <span className="text-text-primary">{graphqlCount}</span> GraphQL definition
                {graphqlCount === 1 ? '' : 's'} (embedded — added to Global Assets)
              </li>
            )}
            {fileCount > 0 && (
              <li>
                <span className="text-text-primary">{fileCount}</span> file asset
                {fileCount === 1 ? '' : 's'} (metadata only — re-attach files after import)
              </li>
            )}
          </ul>
        </div>
      )}
      {parsed.warnings.length > 0 && (
        <ul className="flex flex-col gap-0.5 text-[0.625rem] text-amber">
          {parsed.warnings.slice(0, 5).map((w, i) => (
            <li key={i}>· {w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CollectionPreview({ parsed }: { parsed: ParsedPostmanCollection }) {
  const folderByKey = new Map<string, { name: string; depth: number }>();
  for (const f of parsed.folders) {
    const depth = f.parentPathIds ? f.parentPathIds.length + 1 : 1;
    folderByKey.set(f.pathIds.join('.'), { name: f.name, depth });
  }
  const rows: Array<{ id: string; depth: number; el: React.ReactNode }> = [];
  for (const f of parsed.folders) {
    const depth = f.parentPathIds ? f.parentPathIds.length + 1 : 1;
    rows.push({
      id: `f:${f.pathIds.join('.')}`,
      depth,
      el: (
        <span className="flex items-center gap-1 text-text-primary">
          <FolderTree size={11} className="text-text-faint" />
          {f.name}
        </span>
      ),
    });
  }
  for (const r of parsed.requests) {
    const parentKey = r.folderPathIds ? r.folderPathIds.join('.') : '';
    const parent = parentKey ? folderByKey.get(parentKey) : null;
    rows.push({
      id: `r:${r.name}-${rows.length}`,
      depth: (parent?.depth ?? 0) + 1,
      el: (
        <span className="flex items-center gap-1.5 text-text-muted">
          <span className="text-[0.625rem] uppercase text-text-dim">{r.method}</span>
          <span className="truncate">{r.name}</span>
        </span>
      ),
    });
  }
  return (
    <ul className="max-h-48 overflow-y-auto text-[0.6875rem]">
      {rows.slice(0, 200).map((row) => (
        <li key={row.id} style={{ paddingLeft: row.depth * 12 }} className="truncate py-0.5">
          {row.el}
        </li>
      ))}
      {rows.length > 200 && (
        <li className="px-2 py-1 text-[0.625rem] text-text-dim">
          + {rows.length - 200} more (preview truncated)
        </li>
      )}
      {parsed.warnings.length > 0 && (
        <li className="mt-1 flex flex-col gap-0.5 text-[0.625rem] text-amber">
          {parsed.warnings.slice(0, 5).map((w, i) => (
            <span key={i}>· {w}</span>
          ))}
        </li>
      )}
    </ul>
  );
}

function EnvironmentPreview({ parsed }: { parsed: ParsedPostmanEnvironment }) {
  return (
    <ul className="max-h-40 overflow-y-auto font-mono text-[0.625rem]">
      {parsed.variables.slice(0, 30).map((v, i) => (
        <li key={i} className="grid grid-cols-[140px_1fr] gap-2 py-0.5">
          <span className="truncate text-text-muted">{v.key}</span>
          <span className="truncate text-text-primary">
            {v.value || <em className="text-text-dim">(empty)</em>}
          </span>
        </li>
      ))}
      {parsed.variables.length > 30 && (
        <li className="px-1 py-1 text-text-dim">+ {parsed.variables.length - 30} more</li>
      )}
      {parsed.warnings.length > 0 && (
        <li className="mt-1 flex flex-col gap-0.5 text-[0.625rem] text-amber">
          {parsed.warnings.slice(0, 5).map((w, i) => (
            <span key={i}>· {w}</span>
          ))}
        </li>
      )}
    </ul>
  );
}

function CurlPreview({ parsed }: { parsed: ParsedCurl }) {
  return (
    <div className="grid grid-cols-[80px_1fr] gap-y-1 text-[0.6875rem]">
      <span className="text-text-dim">Method</span>
      <code className="text-text-primary">{parsed.method}</code>
      <span className="text-text-dim">URL</span>
      <code className="truncate font-mono text-text-primary">
        {parsed.url || <em className="not-italic text-warning">(none)</em>}
      </code>
      <span className="text-text-dim">Headers</span>
      <span className="text-text-primary">{parsed.headers.length}</span>
      <span className="text-text-dim">Body</span>
      <code className="text-text-primary">{parsed.body.type}</code>
      <span className="text-text-dim">Auth</span>
      <code className="text-text-primary">{parsed.auth.type}</code>
      {parsed.warnings.length > 0 && (
        <ul className="col-span-2 mt-1 flex flex-col gap-0.5 text-[0.625rem] text-amber">
          {parsed.warnings.map((w, i) => (
            <li key={i}>⚠ {w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
