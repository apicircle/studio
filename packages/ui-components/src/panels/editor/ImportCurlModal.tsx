// Paste-import for cURL commands. The user pastes any `curl …` string
// (including multi-line copy-as-cURL output from browser dev-tools),
// gets a live preview of method/URL/headers/body that the parser
// derived, and clicks Import to commit it as a new request.
//
// All other import formats (OpenAPI / Postman / Insomnia / HAR) are
// delegated to the MCP server bundled with the desktop release —
// this modal is the cURL-specific quick path users want in-app.

import { useMemo, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { parseCurl } from '@apicircle/core';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { Modal } from '../../primitives/Modal';

interface ImportCurlModalProps {
  open: boolean;
  onClose: () => void;
  parentFolderId?: string | null;
}

const SAMPLE = `curl -X POST 'https://api.example.test/users' \\\n  -H 'Accept: application/json' \\\n  -H 'Authorization: Bearer YOUR_TOKEN' \\\n  --json '{"name": "alice"}'`;

export function ImportCurlModal({ open, onClose, parentFolderId = null }: ImportCurlModalProps) {
  const [text, setText] = useState('');
  const addRequestFromCurl = useWorkspaceStore((s) => s.addRequestFromCurl);
  const preview = useMemo(() => (text.trim() ? parseCurl(text) : null), [text]);

  if (!open) return null;

  const onImport = () => {
    if (!text.trim()) return;
    addRequestFromCurl(text, parentFolderId);
    setText('');
    onClose();
  };

  const onPasteSample = () => setText(SAMPLE);

  return (
    <Modal open onClose={onClose} title="Import cURL">
      <div className="flex w-[min(720px,95vw)] flex-col gap-3 text-xs">
        <p className="text-text-muted">
          Paste any <code>curl …</code> command. We&apos;ll create a new request with the method,
          URL, headers, body, and basic auth pre-filled. For OpenAPI / Postman / Insomnia / HAR
          imports, use the MCP server bundled with the desktop release.
        </p>
        <div className="flex items-center justify-between">
          <label htmlFor="curl-input" className="text-[11px] uppercase tracking-wide text-text-dim">
            cURL command
          </label>
          <button
            type="button"
            onClick={onPasteSample}
            className="inline-flex items-center gap-1 text-[11px] text-text-muted hover:text-accent"
          >
            <Sparkles size={11} aria-hidden="true" />
            Paste sample
          </button>
        </div>
        <textarea
          id="curl-input"
          aria-label="cURL command"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={10}
          spellCheck={false}
          placeholder={SAMPLE}
          className="min-h-[180px] w-full rounded-sm border border-border bg-card p-2 font-mono text-[11px] text-text-primary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30"
        />

        {preview && (
          <div className="rounded-sm border border-border-subtle bg-surface p-2 text-[11px]">
            <div className="grid grid-cols-[80px_1fr] gap-y-1">
              <span className="text-text-dim">Method</span>
              <code className="text-text-primary">{preview.method}</code>
              <span className="text-text-dim">URL</span>
              <code className="truncate font-mono text-text-primary">
                {preview.url || <em className="not-italic text-warning">(none)</em>}
              </code>
              <span className="text-text-dim">Headers</span>
              <span className="text-text-primary">{preview.headers.length}</span>
              <span className="text-text-dim">Body</span>
              <code className="text-text-primary">{preview.body.type}</code>
              <span className="text-text-dim">Auth</span>
              <code className="text-text-primary">{preview.auth.type}</code>
            </div>
            {preview.warnings.length > 0 && (
              <ul className="mt-2 space-y-0.5 text-[10px] text-warning">
                {preview.warnings.map((w, i) => (
                  <li key={i}>⚠ {w}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-7 items-center rounded-sm border border-border bg-surface px-3 text-xs text-text-muted hover:border-border-strong hover:text-text-primary"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onImport}
            disabled={!preview || !preview.url}
            className="inline-flex h-7 items-center rounded-sm border border-accent/40 bg-accent/10 px-3 text-xs text-accent hover:bg-accent/20 disabled:opacity-50"
          >
            Import
          </button>
        </div>
      </div>
    </Modal>
  );
}
