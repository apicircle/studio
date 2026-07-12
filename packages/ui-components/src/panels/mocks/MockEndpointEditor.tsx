import { useEffect, useState } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { Radio } from 'lucide-react';
import type { HttpMethod, MockEndpoint, MockServer } from '@apicircle/shared';
import { isLinkedMockSource, validateMockPath } from '@apicircle/shared';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { cn } from '../../primitives/cn';
import { Select } from '../../primitives/Select';
import { MockEndpointFlow } from './MockEndpointFlow';
import { MockNodeEditor, type MockNodeSelection } from './MockNodeEditor';
import { MockReadOnlyContext } from './mockReadOnly';

// Editor pane for a single mock endpoint. Layout follows the Editor
// pattern but for mocks: a flow diagram up top showing the request-
// handling pipeline (Endpoint → Validation → Rules → Default), and a
// node-editor pane below that surfaces whichever node the user clicked.
//
// Selection state is local to this component; resetting on endpoint
// switch keeps the editor predictable.

const HTTP_METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
// Mirror the request Editor's method-color scheme so the mock editor
// reads the same at a glance. Class drives the closed-select label color;
// inline style drives each <option> (native dropdown ignores Tailwind).
const METHOD_COLOR: Record<HttpMethod, string> = {
  GET: 'text-http-get',
  POST: 'text-http-post',
  PUT: 'text-http-put',
  PATCH: 'text-http-patch',
  DELETE: 'text-http-delete',
  HEAD: 'text-http-head',
  OPTIONS: 'text-http-options',
};
const METHOD_OPTION_COLOR: Record<HttpMethod, string> = {
  GET: 'rgb(var(--http-get))',
  POST: 'rgb(var(--http-post))',
  PUT: 'rgb(var(--http-put))',
  PATCH: 'rgb(var(--http-patch))',
  DELETE: 'rgb(var(--http-delete))',
  HEAD: 'rgb(var(--http-head))',
  OPTIONS: 'rgb(var(--http-options))',
};

export function MockEndpointEditor({
  server,
  endpoint,
}: {
  server: MockServer;
  endpoint: MockEndpoint;
}) {
  const updateMockEndpoint = useWorkspaceStore((s) => s.updateMockEndpoint);
  const [selection, setSelection] = useState<MockNodeSelection>({ kind: 'endpoint' });

  // Reset selection whenever the active endpoint changes — the user
  // expects clicking a different endpoint in the sidebar to land them
  // on its overview, not on whatever fragment they were editing in the
  // previous endpoint.
  useEffect(() => {
    setSelection({ kind: 'endpoint' });
  }, [endpoint.id]);

  // If the selected validation rule or response rule got deleted from
  // under us (e.g. the user deleted it in the editor below), fall back
  // to the parent overview node. We deliberately omit `selection` from
  // the dependency array — clicking around the flow updates `selection`
  // but doesn't change whether the currently-selected rule still exists,
  // so re-running the existence check on every selection click was dead
  // work. The effect should fire ONLY when the rule lists change.
  useEffect(() => {
    if (
      selection.kind === 'validation-rule' &&
      !endpoint.requestValidation.some((r) => r.id === selection.ruleId)
    ) {
      setSelection({ kind: 'validation' });
    } else if (
      selection.kind === 'rule' &&
      !endpoint.responseRules.some((r) => r.id === selection.ruleId)
    ) {
      setSelection({ kind: 'rules' });
    }
    // selection is intentionally not in deps — see comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint.requestValidation, endpoint.responseRules]);

  const setEndpoint = (patch: Partial<MockEndpoint>) =>
    updateMockEndpoint(server.id, endpoint.id, patch);

  // Linked ("run live") contract mocks are read-only — endpoints are derived
  // from the spec asset. `<fieldset disabled>` disables every native control
  // (the store also rejects the mutations); Monaco reads the context below. The
  // flow diagram stays enabled so the contract remains fully inspectable.
  const readOnly = isLinkedMockSource(server.source);

  return (
    <MockReadOnlyContext.Provider value={readOnly}>
      <div className="flex h-full flex-1 flex-col overflow-hidden">
        {readOnly && (
          <div className="flex items-center gap-2 border-b border-accent/30 bg-accent/5 px-4 py-1.5 text-[0.6875rem] text-text-dim">
            <Radio size={12} className="shrink-0 text-accent" aria-hidden="true" />
            <span>
              <strong className="text-text-primary">Read-only</strong> — served live from the
              contract and kept in sync with the spec asset. To edit, import an editable copy via{' '}
              <strong className="text-text-primary">New Mock Server &rarr; From spec asset</strong>.
            </span>
          </div>
        )}
        <fieldset
          disabled={readOnly}
          className="flex min-w-0 flex-wrap items-center gap-2 border-b border-border-subtle bg-card px-4 py-2.5"
        >
          <Select
            size="md"
            value={endpoint.method}
            onChange={(e) => setEndpoint({ method: e.target.value as HttpMethod })}
            aria-label="Mock endpoint method"
            className={cn('bg-surface font-mono font-medium', METHOD_COLOR[endpoint.method])}
          >
            {HTTP_METHODS.map((m) => (
              <option key={m} value={m} style={{ color: METHOD_OPTION_COLOR[m] }}>
                {m}
              </option>
            ))}
          </Select>
          <PathPatternInput
            server={server}
            endpoint={endpoint}
            onChange={(next) => setEndpoint({ pathPattern: next })}
          />
          <input
            value={endpoint.name}
            onChange={(e) => setEndpoint({ name: e.target.value })}
            placeholder="Get pet by id"
            aria-label="Mock endpoint name"
            className="h-8 w-56 rounded-sm border border-border bg-surface px-2 text-xs text-text-primary focus:border-accent focus:outline-none"
          />
        </fieldset>
        <PanelGroup direction="vertical" className="flex-1">
          <Panel defaultSize={32} minSize={20}>
            {/* `flex items-center` vertically centers the flow row inside its
              panel. `overflow-x-auto` lets the pipeline scroll horizontally
              when the right dock crowds the available width; `overflow-y-hidden`
              keeps vertical scroll out of this row (the bottom panel handles
              its own scroll). */}
            <div className="flex h-full items-center overflow-x-auto overflow-y-hidden bg-surface px-4 py-3">
              <MockEndpointFlow
                serverId={server.id}
                endpoint={endpoint}
                selection={selection}
                onSelect={setSelection}
              />
            </div>
          </Panel>
          <PanelResizeHandle
            className="h-1 cursor-row-resize bg-border-subtle hover:bg-accent/40"
            aria-label="Resize flow diagram"
          />
          <Panel defaultSize={68} minSize={30}>
            <div className="h-full overflow-y-auto bg-surface p-4">
              <fieldset disabled={readOnly} className="min-w-0">
                <MockNodeEditor
                  server={server}
                  endpoint={endpoint}
                  selection={selection}
                  onSelect={setSelection}
                />
              </fieldset>
            </div>
          </Panel>
        </PanelGroup>
      </div>
    </MockReadOnlyContext.Provider>
  );
}

/**
 * Path-pattern input with two live checks:
 *  - syntactic validity via `validateMockPath` (leading slash, no whitespace,
 *    no query/fragment)
 *  - duplicate-detection within the same server for `(method, path)` —
 *    silent collisions made runtime resolution order-dependent (audit gap).
 *
 * Renders a `role="alert"` line below the input on failure and marks the
 * input `aria-invalid` so screen readers announce the rejection.
 */
function PathPatternInput({
  server,
  endpoint,
  onChange,
}: {
  server: MockServer;
  endpoint: MockEndpoint;
  onChange: (next: string) => void;
}) {
  const syntax = validateMockPath(endpoint.pathPattern);
  const duplicate = server.endpoints.some(
    (e) =>
      e.id !== endpoint.id &&
      e.method === endpoint.method &&
      e.pathPattern === endpoint.pathPattern,
  );
  const reason = !syntax.ok
    ? syntax.reason
    : duplicate
      ? `Another endpoint already serves ${endpoint.method} ${endpoint.pathPattern} on this server.`
      : null;

  return (
    <div className="flex flex-1 min-w-[16rem] flex-col">
      <input
        value={endpoint.pathPattern}
        onChange={(e) => onChange(e.target.value)}
        placeholder="/pets/{id}"
        aria-label="Mock endpoint path pattern"
        aria-invalid={reason !== null}
        className={cn(
          'h-8 rounded-sm border bg-surface px-2 font-mono text-xs text-text-primary focus:outline-none',
          reason !== null
            ? 'border-danger focus:border-danger'
            : 'border-border focus:border-accent',
        )}
      />
      {reason && (
        <p role="alert" className="mt-1 text-[0.625rem] text-danger">
          {reason}
        </p>
      )}
    </div>
  );
}
