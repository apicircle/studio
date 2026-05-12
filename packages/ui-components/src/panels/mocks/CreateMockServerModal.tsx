import { useState } from 'react';
import { FileCode, Plus } from 'lucide-react';
import type { MockServerSource } from '@apicircle/shared';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { Modal } from '../../primitives/Modal';

// Standalone "Create mock server" modal. Driven by `mocksCreateModalOpen`
// in the store so the sidebar's CTA + the empty-state CTA + any other
// surface that wants to spawn a new server share one entry point.
//
// Two creation paths:
//   • Manual — seed an empty server; users add endpoints via the
//     sidebar's per-server + button after creation.
//   • Paste spec — verbatim OpenAPI / Postman / Insomnia text. The
//     runtime (Desktop / CLI) parses on Start; web app never invokes a
//     Node-only parser.

export function CreateMockServerModal() {
  const open = useWorkspaceStore((s) => s.mocksCreateModalOpen);
  const close = useWorkspaceStore((s) => s.closeMocksCreateModal);
  const createMockServer = useWorkspaceStore((s) => s.createMockServer);
  const setActiveMockEndpoint = useWorkspaceStore((s) => s.setActiveMockEndpoint);

  const [tab, setTab] = useState<'manual' | 'spec'>('manual');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [specKind, setSpecKind] = useState<'openapi' | 'postman' | 'insomnia'>('openapi');
  const [specFormat, setSpecFormat] = useState<'json' | 'yaml'>('json');
  const [specText, setSpecText] = useState('');

  const reset = () => {
    setName('');
    setSpecKind('openapi');
    setSpecFormat('json');
    setSpecText('');
    setError(null);
    setTab('manual');
  };

  const onSubmit = () => {
    setSubmitting(true);
    setError(null);
    try {
      let source: MockServerSource;
      if (tab === 'manual') {
        source = { kind: 'manual', endpoints: [] };
      } else {
        if (!specText.trim()) {
          setError('Paste the spec content.');
          return;
        }
        // Lightweight pre-parse so completely malformed input is caught at
        // create-time rather than at start-time on the desktop runtime. We
        // don't run the full parser here (it lives in mock-server-core,
        // which is Node-only); this just confirms the text is a parseable
        // JSON document. YAML pre-parse stays for the runtime since the
        // browser has no YAML parser bundled.
        if (specKind !== 'openapi' || specFormat === 'json') {
          try {
            JSON.parse(specText);
          } catch (e) {
            setError(`Spec is not valid JSON: ${e instanceof Error ? e.message : 'parse failed'}.`);
            return;
          }
        }
        source =
          specKind === 'openapi'
            ? { kind: 'openapi', spec: specText, format: specFormat }
            : specKind === 'postman'
              ? { kind: 'postman', collection: specText }
              : { kind: 'insomnia', export: specText };
      }
      const id = createMockServer({ name, source });
      // Activate the new server so the panel surfaces its (empty) endpoint
      // list right away. No endpoint is selected yet — the user clicks +
      // on the server row to add the first one.
      setActiveMockEndpoint({ serverId: id, endpointId: null });
      reset();
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;
  return (
    <Modal open onClose={close} title="Create mock server" className="max-w-2xl">
      <div className="space-y-3">
        <div>
          <label htmlFor="mock-name" className="block text-[0.6875rem] text-text-dim">
            Mock server name
          </label>
          <input
            id="mock-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Payments mock"
            aria-label="Mock server name"
            autoFocus
            className="mt-1 h-8 w-full rounded-sm border border-border bg-surface px-2 text-xs text-text-primary focus:border-accent focus:outline-none"
          />
        </div>

        <div className="flex gap-1 border-b border-border-subtle">
          <button
            type="button"
            onClick={() => setTab('manual')}
            className={`px-3 py-1.5 text-[0.6875rem] ${tab === 'manual' ? 'border-b-2 border-accent text-text-primary' : 'text-text-muted hover:text-text-primary'}`}
          >
            <Plus size={10} className="mr-1 inline align-text-bottom" aria-hidden="true" />
            Empty (add endpoints later)
          </button>
          <button
            type="button"
            onClick={() => setTab('spec')}
            className={`px-3 py-1.5 text-[0.6875rem] ${tab === 'spec' ? 'border-b-2 border-accent text-text-primary' : 'text-text-muted hover:text-text-primary'}`}
          >
            <FileCode size={10} className="mr-1 inline align-text-bottom" aria-hidden="true" />
            Paste spec
          </button>
        </div>

        {tab === 'manual' ? (
          <p className="text-[0.6875rem] text-text-dim">
            Creates an empty mock server. After it&rsquo;s created, click the{' '}
            <strong className="text-text-primary">+</strong> next to the server in the sidebar to
            add endpoints — you can edit method, path, response body, headers, and rules per
            endpoint there.
          </p>
        ) : (
          <div className="space-y-2">
            <p className="text-[0.6875rem] text-text-dim">
              Paste the spec verbatim. We store it as-is; the runtime (Desktop / CLI) parses it on
              Start — the web app never invokes a Node-only parser.
            </p>
            <div className="flex gap-2">
              <select
                value={specKind}
                onChange={(ev) =>
                  setSpecKind(ev.target.value as 'openapi' | 'postman' | 'insomnia')
                }
                aria-label="Spec source kind"
                className="h-7 rounded-sm border border-border bg-card px-2 text-[0.6875rem] text-text-primary focus:border-accent focus:outline-none"
              >
                <option value="openapi">OpenAPI</option>
                <option value="postman">Postman</option>
                <option value="insomnia">Insomnia</option>
              </select>
              {specKind === 'openapi' && (
                <select
                  value={specFormat}
                  onChange={(ev) => setSpecFormat(ev.target.value as 'json' | 'yaml')}
                  aria-label="OpenAPI spec format"
                  className="h-7 rounded-sm border border-border bg-card px-2 text-[0.6875rem] text-text-primary focus:border-accent focus:outline-none"
                >
                  <option value="json">JSON</option>
                  <option value="yaml">YAML</option>
                </select>
              )}
            </div>
            <textarea
              value={specText}
              onChange={(ev) => setSpecText(ev.target.value)}
              placeholder="Paste the spec content here…"
              aria-label="Spec text"
              rows={10}
              className="w-full resize-y rounded-sm border border-border bg-card px-2 py-1 font-mono text-[0.625rem] text-text-primary focus:border-accent focus:outline-none"
            />
          </div>
        )}

        {error && (
          <p className="text-xs text-danger" role="alert">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={() => {
              reset();
              close();
            }}
            className="inline-flex h-7 items-center rounded-sm border border-border bg-surface px-3 text-xs text-text-muted hover:border-border-strong hover:text-text-primary"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void onSubmit()}
            disabled={submitting || !name.trim()}
            className="inline-flex h-7 items-center gap-1.5 rounded-sm border border-accent/40 bg-accent/10 px-3 text-xs text-accent hover:bg-accent/20 disabled:opacity-50"
          >
            <Plus size={11} aria-hidden="true" />
            {submitting ? 'Creating…' : 'Create mock server'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
