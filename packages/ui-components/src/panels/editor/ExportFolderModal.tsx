// "Export folder as JSON" prompt — surfaces:
//   • the dependency manifest (JSON Schemas + GraphQL definitions
//     embedded inline; global-file metadata embedded with a clear
//     "re-attach in the destination workspace" cue),
//   • the credentials manifest (every credential-bearing auth field in
//     the subtree — defaults to redact; the user opts in per-field
//     before the JSON file leaves the workspace).
//
// The exported file is importable via the same ImportModal's API Circle
// exchange branch.

import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Download,
  FileJson,
  FolderTree,
  KeyRound,
  Layers,
  Paperclip,
} from 'lucide-react';
import {
  redactFolderExportCredentials,
  serializeFolderExport,
  suggestFolderExportFilename,
  type ApicircleFolderExportV1,
  type FolderExportCredential,
  type FolderExportReport,
} from '@apicircle/core';
import { Modal } from '../../primitives/Modal';
import { useWorkspaceStore } from '../../store/workspaceStore';

export interface ExportFolderModalProps {
  /** When non-null, the modal renders for that source folder. */
  folderId: string | null;
  onClose: () => void;
  /**
   * Test seam — pass a custom downloader to swap out the default
   * `Blob` + `URL.createObjectURL` path when running under jsdom (which
   * doesn't implement `<a>.click()` faithfully). Receives the redaction
   * already applied to the file contents.
   */
  download?: (filename: string, contents: string) => boolean;
}

export function ExportFolderModal({ folderId, onClose, download }: ExportFolderModalProps) {
  const buildFolderExport = useWorkspaceStore((s) => s.buildFolderExport);
  // useMemo keeps the export pure for the lifetime of the modal — every
  // re-render against the same folderId returns the same payload, so
  // the download button doesn't capture a stale stamp.
  const computed = useMemo(() => {
    if (!folderId) return null;
    return buildFolderExport(folderId);
  }, [folderId, buildFolderExport]);

  if (!folderId) return null;

  return (
    <Modal open onClose={onClose} title="Export folder as JSON">
      <div className="flex w-full flex-col gap-4 text-xs">
        {!computed ? (
          <p
            role="alert"
            className="rounded-sm border border-danger/30 bg-danger/5 px-2.5 py-1.5 text-[0.6875rem] text-danger"
          >
            Couldn't read the folder — it may have been deleted. Close and retry.
          </p>
        ) : (
          <ExportFolderBody
            envelope={computed.envelope}
            report={computed.report}
            onClose={onClose}
            download={download}
          />
        )}
      </div>
    </Modal>
  );
}

interface ExportFolderBodyProps {
  envelope: ApicircleFolderExportV1;
  report: FolderExportReport;
  onClose: () => void;
  download?: ExportFolderModalProps['download'];
}

function ExportFolderBody({ envelope, report, onClose, download }: ExportFolderBodyProps) {
  const filename = suggestFolderExportFilename(envelope);
  // Set of credential ids the user has explicitly opted IN to include
  // verbatim. Anything NOT in this set gets redacted at download time.
  // Default = empty set = redact everything.
  const [includeIds, setIncludeIds] = useState<Set<string>>(() => new Set());

  const toggleCredential = (id: string): void => {
    setIncludeIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Recompute the serialized payload whenever the user changes their
  // include selection. Cheap — the envelope is already in memory.
  const contents = useMemo(
    () => serializeFolderExport(redactFolderExportCredentials(envelope, includeIds)),
    [envelope, includeIds],
  );

  const onDownload = (): void => {
    const ok = (download ?? defaultDownload)(filename, contents);
    if (ok) onClose();
  };

  const redactedCount = report.credentials.length - includeIds.size;

  return (
    <>
      <section aria-labelledby="export-summary-heading" className="flex flex-col gap-1.5">
        <h3
          id="export-summary-heading"
          className="text-[0.6875rem] uppercase tracking-wide text-text-dim"
        >
          Summary
        </h3>
        <div className="grid grid-cols-[120px_1fr] gap-y-1 rounded-sm border border-border-subtle bg-card p-2.5">
          <span className="text-text-dim">Folder</span>
          <span className="font-medium text-text-primary">{report.folderName}</span>
          <span className="text-text-dim">Folders</span>
          <span className="text-text-primary">{report.totalFolderCount}</span>
          <span className="text-text-dim">Requests</span>
          <span className="text-text-primary">{report.requestCount}</span>
          <span className="text-text-dim">Format</span>
          <code className="text-text-primary">{envelope.format}</code>
        </div>
      </section>

      <CredentialsSection
        credentials={report.credentials}
        includeIds={includeIds}
        onToggle={toggleCredential}
      />

      <DependencyReportSection report={report} />

      <footer className="flex items-center justify-end gap-2 border-t border-border-subtle pt-3">
        {report.hasCredentials && (
          <span
            data-testid="export-credentials-summary"
            className="mr-auto text-[0.625rem] text-text-dim"
          >
            {includeIds.size === 0
              ? `${report.credentials.length} credential${report.credentials.length === 1 ? '' : 's'} will be redacted`
              : `${includeIds.size} credential${includeIds.size === 1 ? '' : 's'} included · ${redactedCount} redacted`}
          </span>
        )}
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-8 items-center rounded-sm border border-border bg-surface px-3 text-[0.6875rem] text-text-muted hover:border-accent hover:text-text-primary"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onDownload}
          aria-label={`Download ${filename}`}
          className="inline-flex h-8 items-center gap-1 rounded-sm border border-accent/40 bg-accent/15 px-3 text-[0.6875rem] text-accent hover:bg-accent/25"
        >
          <Download size={11} aria-hidden="true" />
          Download {filename}
        </button>
      </footer>
    </>
  );
}

function CredentialsSection({
  credentials,
  includeIds,
  onToggle,
}: {
  credentials: FolderExportCredential[];
  includeIds: ReadonlySet<string>;
  onToggle: (id: string) => void;
}) {
  return (
    <section
      aria-labelledby="export-credentials-heading"
      className="flex flex-col gap-1.5"
      data-testid="export-credentials"
    >
      <h3
        id="export-credentials-heading"
        className="text-[0.6875rem] uppercase tracking-wide text-text-dim"
      >
        Security credentials
      </h3>
      {credentials.length === 0 ? (
        <p className="rounded-sm border border-dashed border-border-subtle bg-surface px-2.5 py-2 text-[0.6875rem] text-text-dim">
          No request or folder in this subtree carries a credential-bearing auth field. Safe to
          export as-is.
        </p>
      ) : (
        <div className="flex flex-col gap-2 rounded-sm border border-amber/30 bg-amber/5 p-2.5">
          <p className="flex items-start gap-1 text-[0.625rem] text-amber">
            <AlertTriangle size={10} className="mt-[1px] shrink-0" aria-hidden="true" />
            <span>
              These fields will be <strong className="font-semibold">redacted by default</strong>.
              Tick a row only if you genuinely want that credential to travel inside the JSON file —
              anyone with the file can replay the request.
            </span>
          </p>
          <ul className="flex flex-col gap-0.5 text-[0.6875rem]">
            {credentials.map((c) => {
              const included = includeIds.has(c.id);
              const inputId = `export-cred-${c.id}`;
              return (
                <li key={c.id} className="flex items-center gap-2">
                  <input
                    id={inputId}
                    type="checkbox"
                    checked={included}
                    onChange={() => onToggle(c.id)}
                    className="h-3 w-3 cursor-pointer accent-amber"
                    aria-label={`Include ${c.label} for ${c.ownerName}`}
                  />
                  <label
                    htmlFor={inputId}
                    className="flex flex-1 cursor-pointer items-center gap-1.5 truncate"
                  >
                    <KeyRound
                      size={11}
                      className={included ? 'text-amber' : 'text-text-faint'}
                      aria-hidden="true"
                    />
                    <span className="truncate text-text-primary">{c.label}</span>
                    <span className="truncate text-[0.625rem] text-text-dim">
                      {scopeLabel(c.scope)} · {c.ownerName}
                    </span>
                    {included && (
                      <span
                        data-testid={`include-flag-${c.id}`}
                        className="ml-auto rounded-sm border border-amber/40 bg-amber/15 px-1 py-0.5 text-[0.5625rem] uppercase tracking-wide text-amber"
                      >
                        included
                      </span>
                    )}
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

function scopeLabel(scope: FolderExportCredential['scope']): string {
  if (scope === 'root-folder') return 'Folder auth';
  if (scope === 'subfolder') return 'Subfolder auth';
  return 'Request';
}

function DependencyReportSection({ report }: { report: FolderExportReport }) {
  const { schemas, graphql, files } = report.dependencies;
  return (
    <section
      aria-labelledby="export-dependencies-heading"
      className="flex flex-col gap-1.5"
      data-testid="export-dependencies"
    >
      <h3
        id="export-dependencies-heading"
        className="text-[0.6875rem] uppercase tracking-wide text-text-dim"
      >
        Global Asset dependencies
      </h3>
      {!report.hasDependencies ? (
        <p className="rounded-sm border border-dashed border-border-subtle bg-surface px-2.5 py-2 text-[0.6875rem] text-text-dim">
          No global JSON Schemas, GraphQL definitions, or file assets are referenced by this folder.
        </p>
      ) : (
        <div className="flex flex-col gap-2 rounded-sm border border-border-subtle bg-card p-2.5">
          {schemas.length > 0 && (
            <DepGroup
              icon={<FileJson size={12} className="text-accent" aria-hidden="true" />}
              title={`JSON Schemas (${schemas.length})`}
              hint={
                'Schema content is embedded — Importer adds these to Global Assets → JSON Schemas.'
              }
            >
              {schemas.map((s) => (
                <li key={s.id} className="truncate text-text-primary">
                  {s.name}
                </li>
              ))}
            </DepGroup>
          )}
          {graphql.length > 0 && (
            <DepGroup
              icon={<Layers size={12} className="text-accent" aria-hidden="true" />}
              title={`GraphQL definitions (${graphql.length})`}
              hint={
                'GraphQL source is embedded — Importer adds these to Global Assets → GraphQL definitions.'
              }
            >
              {graphql.map((g) => (
                <li key={g.id} className="flex items-center gap-1.5 truncate text-text-primary">
                  <span>{g.name}</span>
                  <span className="text-[0.625rem] uppercase text-text-dim">{g.kind}</span>
                </li>
              ))}
            </DepGroup>
          )}
          {files.length > 0 && (
            <DepGroup
              icon={<Paperclip size={12} className="text-amber" aria-hidden="true" />}
              title={`Global files (${files.length})`}
              hint={
                'File bytes are NOT included — Importer surfaces these so you can re-attach them inside Global Assets → Global Files.'
              }
              warn
            >
              {files.map((f) => (
                <li key={f.id} className="flex items-center gap-2 truncate">
                  <FolderTree size={11} className="shrink-0 text-text-faint" aria-hidden="true" />
                  <span className="truncate text-text-primary">{f.name}</span>
                  <span className="truncate text-[0.625rem] text-text-dim">
                    {`${f.filename} · ${formatBytes(f.size)}`}
                  </span>
                </li>
              ))}
            </DepGroup>
          )}
        </div>
      )}
    </section>
  );
}

function DepGroup(props: {
  icon: React.ReactNode;
  title: string;
  hint: string;
  warn?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <header className="flex items-center gap-2 text-[0.6875rem] font-medium text-text-primary">
        {props.icon}
        {props.title}
      </header>
      <p
        className={
          props.warn
            ? 'flex items-start gap-1 text-[0.625rem] text-amber'
            : 'text-[0.625rem] text-text-dim'
        }
      >
        {props.warn && <AlertTriangle size={10} className="mt-[1px] shrink-0" aria-hidden="true" />}
        <span>{props.hint}</span>
      </p>
      <ul className="ml-4 list-disc text-[0.6875rem]">{props.children}</ul>
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function defaultDownload(filename: string, contents: string): boolean {
  // jsdom doesn't implement `<a>.click()` reliably — guard for the
  // non-browser path so unit tests can swap the downloader.
  if (
    typeof window === 'undefined' ||
    typeof document === 'undefined' ||
    typeof Blob === 'undefined' ||
    typeof URL === 'undefined' ||
    typeof URL.createObjectURL !== 'function'
  ) {
    return false;
  }
  const blob = new Blob([contents], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Release the object URL on the next microtask so the click handler
  // has a chance to start the download before the underlying blob is
  // garbage-collected.
  queueMicrotask(() => URL.revokeObjectURL(url));
  return true;
}
