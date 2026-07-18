import { useMemo, useState } from 'react';
import { AlertTriangle, FileCode, Info, Plus } from 'lucide-react';
import type { MockServerSource } from '@apicircle/shared';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { getDesktopMockBridge } from '../../desktop/bridge';
import { Modal } from '../../primitives/Modal';

// Standalone "Create mock server" modal. Driven by `mocksCreateModalOpen`
// in the store so the sidebar's CTA + the empty-state CTA + any other
// surface that wants to spawn a new server share one entry point.
//
// Two creation paths:
//   • Manual — seed an empty server; users add endpoints via the
//     sidebar's per-server + button after creation.
//   • Paste spec — verbatim OpenAPI / Postman / Insomnia text. The spec is
//     parsed at create time so the endpoint table is materialized right
//     away. On Desktop the parse runs in the Node main process (full
//     external-`$ref` resolution); in the browser it resolves in-document
//     refs only and warns about external references it can't follow.

export function CreateMockServerModal() {
  const open = useWorkspaceStore((s) => s.mocksCreateModalOpen);
  const close = useWorkspaceStore((s) => s.closeMocksCreateModal);
  const createMockServer = useWorkspaceStore((s) => s.createMockServer);
  const setActiveMockEndpoint = useWorkspaceStore((s) => s.setActiveMockEndpoint);

  // When the Desktop mock bridge is present, external `$ref`s resolve fully
  // in the Node main process; otherwise we're browser-only (web app).
  const canResolveExternalRefs = getDesktopMockBridge()?.parseSpec != null;

  const [tab, setTab] = useState<'manual' | 'spec' | 'asset'>('manual');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [specKind, setSpecKind] = useState<'openapi' | 'postman' | 'insomnia'>('openapi');
  const [specFormat, setSpecFormat] = useState<'json' | 'yaml'>('json');
  const [specText, setSpecText] = useState('');
  // Set after a spec import that produced warnings or zero endpoints — keeps
  // the modal open so the user sees the outcome instead of it silently
  // closing on a partially-resolved import.
  const [result, setResult] = useState<{ endpointCount: number; warnings: string[] } | null>(null);

  // Spec-typed Global File Assets available to build a mock from (Increment A).
  const files = useWorkspaceStore((s) => s.synced?.globalAssets.files);
  const specAssets = useMemo(() => Object.values(files ?? {}).filter((f) => f.spec), [files]);
  const [assetId, setAssetId] = useState('');

  const reset = () => {
    setName('');
    setSpecKind('openapi');
    setSpecFormat('json');
    setSpecText('');
    setAssetId('');
    setError(null);
    setResult(null);
    setTab('manual');
  };

  const onSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      let source: MockServerSource;
      if (tab === 'manual') {
        source = { kind: 'manual', endpoints: [] };
      } else if (tab === 'asset') {
        const asset = specAssets.find((f) => f.id === assetId);
        if (!asset?.spec) {
          setError('Select a spec asset to build the mock from.');
          return;
        }
        // This unified modal always IMPORTS a spec asset as editable endpoints
        // (materialized). Running a contract live (read-only) is its own
        // first-class flow — the "Serve OpenAPI contract" entry point.
        source = {
          kind: 'openapi-asset',
          assetId: asset.id,
          format: asset.spec.format,
          mode: 'materialized',
        };
      } else {
        if (!specText.trim()) {
          setError('Paste the spec content.');
          return;
        }
        // Lightweight pre-parse so completely malformed input is caught here
        // rather than deep in the parser. YAML pre-parse is skipped (the
        // parser owns YAML); JSON kinds must be a parseable JSON document.
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
      const { id, warnings } = await createMockServer({ name, source });
      // Activate the new server so the panel surfaces its endpoint list.
      setActiveMockEndpoint({ serverId: id, endpointId: null });
      if (tab !== 'manual') {
        const endpointCount =
          useWorkspaceStore.getState().synced?.mockServers[id]?.endpoints.length ?? 0;
        if (warnings.length > 0 || endpointCount === 0) {
          // Surface the outcome instead of closing silently.
          setResult({ endpointCount, warnings });
          return;
        }
      }
      reset();
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
    } finally {
      setSubmitting(false);
    }
  };

  const onCloseAndReset = () => {
    reset();
    close();
  };

  if (!open) return null;
  return (
    <Modal open onClose={close} title="Create mock server" className="max-w-2xl">
      {result ? (
        <div className="space-y-3" role="status">
          <div
            className={`flex items-start gap-2 rounded-sm border p-2 ${
              result.endpointCount > 0
                ? 'border-accent/40 bg-accent/10 text-text-primary'
                : 'border-warning/40 bg-warning/10 text-text-primary'
            }`}
          >
            {result.endpointCount > 0 ? (
              <Info size={13} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
            ) : (
              <AlertTriangle
                size={13}
                className="mt-0.5 shrink-0 text-warning"
                aria-hidden="true"
              />
            )}
            <p className="text-xs">
              {result.endpointCount > 0
                ? `Imported ${result.endpointCount} endpoint${result.endpointCount === 1 ? '' : 's'}.`
                : 'No endpoints were found in this spec. Check that it defines paths with 2xx responses.'}
            </p>
          </div>
          {result.warnings.length > 0 && (
            <div>
              <p className="mb-1 text-[0.6875rem] font-medium text-text-muted">
                {result.warnings.length} warning{result.warnings.length === 1 ? '' : 's'}
              </p>
              <ul className="max-h-48 space-y-1 overflow-y-auto rounded-sm border border-border-subtle bg-card p-2">
                {result.warnings.map((w, i) => (
                  <li key={i} className="text-[0.6875rem] text-text-dim">
                    • {w}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex justify-end pt-1">
            <button
              type="button"
              onClick={onCloseAndReset}
              className="inline-flex h-7 items-center rounded-sm border border-accent/40 bg-accent/10 px-3 text-xs text-accent hover:bg-accent/20"
            >
              Done
            </button>
          </div>
        </div>
      ) : (
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
            <button
              type="button"
              onClick={() => setTab('asset')}
              className={`px-3 py-1.5 text-[0.6875rem] ${tab === 'asset' ? 'border-b-2 border-accent text-text-primary' : 'text-text-muted hover:text-text-primary'}`}
            >
              <FileCode size={10} className="mr-1 inline align-text-bottom" aria-hidden="true" />
              From spec asset
            </button>
          </div>

          {tab === 'manual' ? (
            <p className="text-[0.6875rem] text-text-dim">
              Creates an empty mock server. After it&rsquo;s created, click the{' '}
              <strong className="text-text-primary">+</strong> next to the server in the sidebar to
              add endpoints — you can edit method, path, response body, headers, and rules per
              endpoint there.
            </p>
          ) : tab === 'asset' ? (
            <div className="space-y-2">
              <p className="text-[0.6875rem] text-text-dim">
                Import a spec you&rsquo;ve uploaded to Global Assets as editable endpoints you can
                modify — re-import from the spec anytime. To run a contract{' '}
                <strong className="text-text-primary">live</strong> (read-only, always in sync), use{' '}
                <strong className="text-text-primary">Serve OpenAPI contract</strong> in the Mocks
                menu instead. Upload OpenAPI/Swagger files under Assets &rarr; Files first.
              </p>
              {specAssets.length === 0 ? (
                <div className="flex items-start gap-2 rounded-sm border border-warning/40 bg-warning/10 p-2">
                  <AlertTriangle
                    size={12}
                    className="mt-0.5 shrink-0 text-warning"
                    aria-hidden="true"
                  />
                  <p className="text-[0.6875rem] text-text-dim">
                    No spec assets yet. Upload an OpenAPI/Swagger file under Assets &rarr; Files,
                    then return here.
                  </p>
                </div>
              ) : (
                <>
                  <label htmlFor="mock-spec-asset" className="block text-[0.6875rem] text-text-dim">
                    Spec asset
                  </label>
                  <select
                    id="mock-spec-asset"
                    value={assetId}
                    onChange={(ev) => setAssetId(ev.target.value)}
                    aria-label="Spec asset"
                    className="h-7 w-full rounded-sm border border-border bg-card px-2 text-[0.6875rem] text-text-primary focus:border-accent focus:outline-none"
                  >
                    <option value="">Select a spec…</option>
                    {specAssets.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name} — {f.spec?.dialect === 'swagger-2' ? 'Swagger 2' : 'OpenAPI 3'} ·{' '}
                        {f.spec?.operationCount ?? 0} ops
                      </option>
                    ))}
                  </select>
                  <p className="text-[0.625rem] text-text-faint">
                    Endpoints are parsed into an editable table you can modify after creating.
                  </p>
                </>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-[0.6875rem] text-text-dim">
                Paste the spec verbatim. Endpoints are parsed and added to the mock as soon as you
                create it.
              </p>
              {specKind === 'openapi' && !canResolveExternalRefs && (
                <div className="flex items-start gap-2 rounded-sm border border-border-subtle bg-card p-2">
                  <Info size={12} className="mt-0.5 shrink-0 text-text-muted" aria-hidden="true" />
                  <p className="text-[0.6875rem] text-text-dim">
                    The web app resolves in-document <code className="font-mono">$ref</code>s only.
                    External or remote references (to other files / URLs) aren&rsquo;t resolved here
                    — open the mock in the Desktop app, CLI, or VS Code extension for full
                    resolution.
                  </p>
                </div>
              )}
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
              onClick={onCloseAndReset}
              className="inline-flex h-7 items-center rounded-sm border border-border bg-surface px-3 text-xs text-text-muted hover:border-border-strong hover:text-text-primary"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void onSubmit()}
              disabled={submitting || !name.trim() || (tab === 'asset' && !assetId)}
              className="inline-flex h-7 items-center gap-1.5 rounded-sm border border-accent/40 bg-accent/10 px-3 text-xs text-accent hover:bg-accent/20 disabled:opacity-50"
            >
              <Plus size={11} aria-hidden="true" />
              {submitting ? 'Creating…' : 'Create mock server'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
