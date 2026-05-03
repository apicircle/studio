import { Plus, Sparkles, Trash2 } from 'lucide-react';
import type { Request as ApiRequest } from '@apicircle/shared';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { useVariableScope } from '../../editors/useVariableScope';
import { VariableAutocompleteField } from '../../editors/VariableAutocompleteField';
import { HeaderKeyAutocomplete, HeaderValueSuggestions } from './HeaderAutocomplete';

interface HeadersTabProps {
  request: ApiRequest;
}

export function HeadersTab({ request }: HeadersTabProps) {
  const setRequestHeaders = useWorkspaceStore((s) => s.setRequestHeaders);
  const scope = useVariableScope(request);

  const update = (
    index: number,
    patch: Partial<{ key: string; value: string; enabled: boolean }>,
  ) => {
    setRequestHeaders(
      request.id,
      request.headers.map((r, i) => (i === index ? { ...r, ...patch } : r)),
    );
  };
  const addRow = () =>
    setRequestHeaders(request.id, [...request.headers, { key: '', value: '', enabled: true }]);
  const removeRow = (index: number) =>
    setRequestHeaders(
      request.id,
      request.headers.filter((_, i) => i !== index),
    );

  return (
    <div className="flex flex-col gap-2">
      <div role="group" aria-label="Headers" className="flex flex-col gap-1">
        {request.headers.length === 0 && (
          <p className="rounded-sm border border-dashed border-border-subtle p-3 text-center text-xs text-text-dim">
            No headers yet. Type a name to see the dictionary, or add a custom one.
          </p>
        )}
        {request.headers.map((row, index) => (
          <div key={index} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={row.enabled}
              onChange={(e) => update(index, { enabled: e.target.checked })}
              aria-label={`Enable header ${index + 1}`}
              style={{ accentColor: 'var(--purple)' }}
            />
            <HeaderKeyAutocomplete
              value={row.key}
              onChange={(k) => update(index, { key: k })}
              ariaLabel={`Headers key ${index + 1}`}
              placeholder="Header name"
            />
            <div className="flex flex-[2] items-center gap-1">
              <div className="flex-1">
                <VariableAutocompleteField
                  value={row.value}
                  onChange={(v) => update(index, { value: v })}
                  scope={scope}
                  ariaLabel={`Headers value ${index + 1}`}
                  placeholder="Header value"
                  className="h-7"
                />
              </div>
              <HeaderValueSuggestions
                headerKey={row.key}
                onPick={(v) => update(index, { value: v })}
                ariaLabel={`Common values for header ${index + 1}`}
              />
            </div>
            <button
              type="button"
              onClick={() => removeRow(index)}
              className="text-text-faint hover:text-danger"
              aria-label={`Delete Headers row ${index + 1}`}
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={addRow}
          className="inline-flex h-7 items-center gap-1.5 self-start rounded-sm border border-dashed border-border px-2 text-xs text-text-muted hover:border-accent hover:text-text-primary"
        >
          <Plus size={12} />
          Add row
        </button>
      </div>

      <aside
        aria-label="Auto-fed headers"
        className="mt-2 rounded-sm border border-accent/30 bg-accent/5 px-3 py-2 text-[11px]"
      >
        <div className="mb-1 flex items-center gap-1.5 text-accent">
          <Sparkles size={11} />
          <span className="font-medium uppercase tracking-wider">Auto-fed at send</span>
        </div>
        <ul className="flex flex-col gap-0.5 text-text-muted">
          <li>
            <code className="text-text-primary">X-APICircle-Trace-Id</code> — fresh UUID per send
            for cross-request tracing
          </li>
          <li>
            <code className="text-text-primary">X-APICircle-Runtime</code> — identifies the host
            (e.g. <code>apicircle-studio/web</code>)
          </li>
        </ul>
        <p className="mt-1 text-text-dim">Add a row above with the same name to override.</p>
      </aside>
    </div>
  );
}
