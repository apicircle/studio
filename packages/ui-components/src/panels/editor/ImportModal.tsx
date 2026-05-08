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
//   - APICircle exchange (placeholder — will land when export ships)
//
// The user can override auto-detect via the source-format dropdown.

import { useMemo, useRef, useState } from 'react';
import { AlertTriangle, FileJson, FlaskConical, FolderTree, Send, Sparkles } from 'lucide-react';
import {
  isInsomniaExport,
  isPostmanEnvironment,
  isPostmanV2Collection,
  parseCurl,
  parseInsomniaCollection,
  parsePostmanCollection,
  parsePostmanEnvironment,
  type ParsedCurl,
  type ParsedPostmanCollection,
  type ParsedPostmanEnvironment,
} from '@apicircle/core';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { Modal } from '../../primitives/Modal';
import { Select } from '../../primitives/Select';
import { cn } from '../../primitives/cn';

type SourceFormat = 'auto' | 'postman' | 'postman-env' | 'insomnia' | 'curl' | 'apicircle';
type DetectedKind =
  | { kind: 'postman-collection'; parsed: ParsedPostmanCollection }
  | { kind: 'postman-environment'; parsed: ParsedPostmanEnvironment }
  | { kind: 'insomnia-collection'; parsed: ParsedPostmanCollection }
  | { kind: 'curl'; parsed: ParsedCurl }
  | { kind: 'apicircle'; message: string };

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
  apicircle: 'APICircle exchange',
};

export function ImportModal({
  open,
  onClose,
  parentFolderId = null,
  initialText = '',
  initialFormat = 'auto',
}: ImportModalProps) {
  const [text, setText] = useState(initialText);
  const [format, setFormat] = useState<SourceFormat>(initialFormat);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const importPostmanCollection = useWorkspaceStore((s) => s.importPostmanCollection);
  const importPostmanEnvironment = useWorkspaceStore((s) => s.importPostmanEnvironment);
  const addRequestFromCurl = useWorkspaceStore((s) => s.addRequestFromCurl);

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
    }
    setText('');
    onClose();
  };

  const onUpload = (file: File) => {
    void file.text().then((c) => {
      setText(c);
      setFormat('auto');
    });
  };

  const detectedLabel = result.detected ? labelForDetection(result.detected) : null;
  const isApicirclePlaceholder = result.detected?.kind === 'apicircle';

  return (
    <Modal open onClose={onClose} title="Import">
      <div className="flex w-[min(720px,95vw)] flex-col gap-4 text-xs">
        <div className="flex items-center gap-2">
          <label
            htmlFor="import-source-format"
            className="text-[11px] uppercase tracking-wide text-text-dim"
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
            className="ml-auto inline-flex h-7 items-center gap-1 rounded-sm border border-border bg-surface px-2 text-[11px] text-text-muted hover:border-accent hover:text-text-primary"
          >
            <FileJson size={11} />
            Upload .json
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
            placeholder='Paste Postman / Insomnia / APICircle JSON, or a "curl …" command'
            spellCheck={false}
            aria-label="Import source"
            className="min-h-[200px] w-full rounded-sm border border-border bg-card p-2.5 font-mono text-[11px] text-text-primary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30"
          />
          <p className="text-[10px] text-text-dim">
            Auto-detect picks the right parser; force a format above if a file looks ambiguous.
          </p>
        </div>

        {result.error && (
          <p
            role="alert"
            className="rounded-sm border border-danger/30 bg-danger/5 px-2.5 py-1.5 text-[11px] text-danger"
          >
            {result.error}
          </p>
        )}

        {result.detected && (
          <div className="flex flex-col gap-1.5 rounded-sm border border-border-subtle bg-card p-3">
            <header className="flex items-center gap-2 text-[11px]">
              {result.detected.kind === 'curl' ? (
                <Sparkles size={12} className="text-accent" />
              ) : result.detected.kind === 'postman-environment' ? (
                <FlaskConical size={12} className="text-accent" />
              ) : isApicirclePlaceholder ? (
                <AlertTriangle size={12} className="text-amber" />
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
            className="inline-flex h-8 items-center rounded-sm border border-border bg-surface px-3 text-[11px] text-text-muted hover:border-accent hover:text-text-primary"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onImport}
            disabled={!result.detected || isApicirclePlaceholder}
            className={cn(
              'inline-flex h-8 items-center rounded-sm border px-3 text-[11px]',
              result.detected && !isApicirclePlaceholder
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

  if (format === 'apicircle' || isApicircleExchange(json)) {
    // Placeholder: APICircle's own export format is on the roadmap. We
    // recognize the marker so users can paste the file and see a clear
    // "not yet" message rather than a parser error.
    return {
      kind: 'apicircle',
      message:
        'APICircle exchange format is recognized but not yet importable. Import the source workspace via Link Workspace, or export to Postman v2.1 from the source and re-paste.',
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

function isApicircleExchange(doc: unknown): boolean {
  if (!doc || typeof doc !== 'object') return false;
  const d = doc as { format?: string };
  return typeof d.format === 'string' && d.format.startsWith('apicircle');
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
  return 'APICircle exchange (placeholder)';
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
  return <p className="text-[11px] text-amber">{detection.message}</p>;
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
          <span className="text-[10px] uppercase text-text-dim">{r.method}</span>
          <span className="truncate">{r.name}</span>
        </span>
      ),
    });
  }
  return (
    <ul className="max-h-48 overflow-y-auto text-[11px]">
      {rows.slice(0, 200).map((row) => (
        <li key={row.id} style={{ paddingLeft: row.depth * 12 }} className="truncate py-0.5">
          {row.el}
        </li>
      ))}
      {rows.length > 200 && (
        <li className="px-2 py-1 text-[10px] text-text-dim">
          + {rows.length - 200} more (preview truncated)
        </li>
      )}
      {parsed.warnings.length > 0 && (
        <li className="mt-1 flex flex-col gap-0.5 text-[10px] text-amber">
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
    <ul className="max-h-40 overflow-y-auto font-mono text-[10px]">
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
        <li className="mt-1 flex flex-col gap-0.5 text-[10px] text-amber">
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
    <div className="grid grid-cols-[80px_1fr] gap-y-1 text-[11px]">
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
        <ul className="col-span-2 mt-1 flex flex-col gap-0.5 text-[10px] text-amber">
          {parsed.warnings.map((w, i) => (
            <li key={i}>⚠ {w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
