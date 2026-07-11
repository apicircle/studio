import { useMemo, useState } from 'react';
import { AlertTriangle, FileCode, Info, Server } from 'lucide-react';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { Modal } from '../../primitives/Modal';

// "Serve OpenAPI contract" — the dedicated run-live entry point. It stands up a
// mock server that serves an OpenAPI/Swagger contract DIRECTLY from a spec
// asset: the source is `openapi-asset` in `linked` mode, so endpoints are
// derived from the contract, kept in sync with the asset, and read-only.
//
// This is deliberately separate from "New Mock Server → From spec asset", which
// IMPORTS a spec as editable endpoints (materialized). Keeping the two as
// distinct affordances is what makes "run the contract directly" legible —
// select a contract, name it, pick a port, and start/stop it from the mock's
// panel like any other server.

export function ServeContractModal() {
  const open = useWorkspaceStore((s) => s.mocksServeContractModalOpen);
  const close = useWorkspaceStore((s) => s.closeMocksServeContractModal);
  const createMockServer = useWorkspaceStore((s) => s.createMockServer);
  const setMockServerDefaultPort = useWorkspaceStore((s) => s.setMockServerDefaultPort);
  const setActiveMockEndpoint = useWorkspaceStore((s) => s.setActiveMockEndpoint);

  // Only spec-typed Global File Assets can back a contract server (Increment A).
  const files = useWorkspaceStore((s) => s.synced?.globalAssets.files);
  const specAssets = useMemo(() => Object.values(files ?? {}).filter((f) => f.spec), [files]);

  const [assetId, setAssetId] = useState('');
  const [name, setName] = useState('');
  const [port, setPort] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const selected = useMemo(() => specAssets.find((f) => f.id === assetId), [specAssets, assetId]);

  const reset = () => {
    setAssetId('');
    setName('');
    setPort('');
    setError(null);
  };

  const onSelectAsset = (id: string) => {
    setAssetId(id);
    // Pre-fill a helpful name from the contract's title, but never clobber a
    // name the user has already typed.
    const asset = specAssets.find((f) => f.id === id);
    if (asset?.spec && !name.trim()) {
      setName(`${asset.spec.title ?? asset.name} (contract)`);
    }
  };

  const onSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const asset = specAssets.find((f) => f.id === assetId);
      if (!asset?.spec) {
        setError('Select an OpenAPI/Swagger contract to serve.');
        return;
      }
      if (!name.trim()) {
        setError('Give the contract server a name.');
        return;
      }
      // Port is optional — blank means "let the runtime pick a free port at
      // start". A provided port must be in the same 1024–65535 window the
      // store's setter enforces, validated here so bad input surfaces now.
      let portValue: number | null = null;
      if (port.trim()) {
        const n = Number(port);
        if (!Number.isInteger(n) || n < 1024 || n > 65535) {
          setError('Port must be a whole number between 1024 and 65535, or blank for auto.');
          return;
        }
        portValue = n;
      }
      const { id } = await createMockServer({
        name,
        source: {
          kind: 'openapi-asset',
          assetId: asset.id,
          format: asset.spec.format,
          mode: 'linked',
        },
      });
      if (portValue !== null) setMockServerDefaultPort(id, portValue);
      // Activate the new server so its panel (with Start/Stop) is front-and-centre.
      setActiveMockEndpoint({ serverId: id, endpointId: null });
      reset();
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the contract server');
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
    <Modal open onClose={close} title="Serve OpenAPI contract" className="max-w-2xl">
      <div className="space-y-3">
        <div className="flex items-start gap-2 rounded-sm border border-accent/40 bg-accent/10 p-2">
          <Info size={13} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
          <p className="text-[0.6875rem] text-text-primary">
            Stands up a live mock server{' '}
            <strong className="text-text-primary">directly from an OpenAPI/Swagger contract</strong>
            . Endpoints are derived from the contract and stay in sync with the asset —
            they&rsquo;re read-only. Start and stop it from the mock&rsquo;s panel after it&rsquo;s
            created. Want editable endpoints instead? Use{' '}
            <strong className="text-text-primary">New Mock Server &rarr; From spec asset</strong>.
          </p>
        </div>

        {specAssets.length === 0 ? (
          <div className="flex items-start gap-2 rounded-sm border border-warning/40 bg-warning/10 p-2">
            <AlertTriangle size={12} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
            <p className="text-[0.6875rem] text-text-dim">
              No OpenAPI/Swagger assets yet. Upload one under Assets &rarr; Files, then return here.
            </p>
          </div>
        ) : (
          <>
            <div>
              <label htmlFor="serve-spec-asset" className="block text-[0.6875rem] text-text-dim">
                OpenAPI / Swagger contract
              </label>
              <select
                id="serve-spec-asset"
                value={assetId}
                onChange={(ev) => onSelectAsset(ev.target.value)}
                aria-label="OpenAPI / Swagger contract"
                className="mt-1 h-8 w-full rounded-sm border border-border bg-card px-2 text-xs text-text-primary focus:border-accent focus:outline-none"
              >
                <option value="">Select a contract…</option>
                {specAssets.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name} — {f.spec?.dialect === 'swagger-2' ? 'Swagger 2' : 'OpenAPI 3'} ·{' '}
                    {f.spec?.operationCount ?? 0} ops
                  </option>
                ))}
              </select>
            </div>

            {selected?.spec && (
              <div
                className="rounded-sm border border-border-subtle bg-card p-2"
                aria-label="Selected contract"
              >
                <div className="flex items-center gap-1.5">
                  <FileCode size={12} className="shrink-0 text-accent" aria-hidden="true" />
                  <span className="text-xs font-medium text-text-primary">
                    {selected.spec.title ?? selected.name}
                    {selected.spec.version ? ` · v${selected.spec.version}` : ''}
                  </span>
                </div>
                <p className="mt-1 text-[0.625rem] text-text-dim">
                  {selected.spec.dialect === 'swagger-2' ? 'Swagger 2.0' : 'OpenAPI 3.x'} ·{' '}
                  {selected.spec.operationCount} operation
                  {selected.spec.operationCount === 1 ? '' : 's'} · served live from{' '}
                  <span className="font-mono">{selected.filename}</span>
                </p>
              </div>
            )}

            <div>
              <label htmlFor="serve-name" className="block text-[0.6875rem] text-text-dim">
                Server name
              </label>
              <input
                id="serve-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Payments API (contract)"
                aria-label="Server name"
                className="mt-1 h-8 w-full rounded-sm border border-border bg-surface px-2 text-xs text-text-primary focus:border-accent focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="serve-port" className="block text-[0.6875rem] text-text-dim">
                Port{' '}
                <span className="text-text-faint">
                  (optional — blank picks a free port at start)
                </span>
              </label>
              <input
                id="serve-port"
                value={port}
                onChange={(e) => setPort(e.target.value)}
                inputMode="numeric"
                placeholder="e.g. 4010"
                aria-label="Port"
                className="mt-1 h-8 w-40 rounded-sm border border-border bg-surface px-2 text-xs text-text-primary focus:border-accent focus:outline-none"
              />
            </div>
          </>
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
            disabled={submitting || !assetId || !name.trim()}
            className="inline-flex h-7 items-center gap-1.5 rounded-sm border border-accent/40 bg-accent/10 px-3 text-xs text-accent hover:bg-accent/20 disabled:opacity-50"
          >
            <Server size={11} aria-hidden="true" />
            {submitting ? 'Creating…' : 'Create contract server'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
