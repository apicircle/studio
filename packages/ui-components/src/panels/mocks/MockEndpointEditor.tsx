import { useEffect, useState } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import type { HttpMethod, MockEndpoint, MockServer } from '@apicircle/shared';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { cn } from '../../primitives/cn';
import { Select } from '../../primitives/Select';
import { MockEndpointFlow } from './MockEndpointFlow';
import { MockNodeEditor, type MockNodeSelection } from './MockNodeEditor';

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
  // to the parent overview node.
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
  }, [endpoint.requestValidation, endpoint.responseRules, selection]);

  const setEndpoint = (patch: Partial<MockEndpoint>) =>
    updateMockEndpoint(server.id, endpoint.id, patch);

  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden">
      <header className="flex flex-wrap items-center gap-2 border-b border-border-subtle bg-card px-4 py-2.5">
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
        <input
          value={endpoint.pathPattern}
          onChange={(e) => setEndpoint({ pathPattern: e.target.value })}
          placeholder="/pets/{id}"
          aria-label="Mock endpoint path pattern"
          className="h-8 flex-1 min-w-[16rem] rounded-sm border border-border bg-surface px-2 font-mono text-xs text-text-primary focus:border-accent focus:outline-none"
        />
        <input
          value={endpoint.name}
          onChange={(e) => setEndpoint({ name: e.target.value })}
          placeholder="Get pet by id"
          aria-label="Mock endpoint name"
          className="h-8 w-56 rounded-sm border border-border bg-surface px-2 text-xs text-text-primary focus:border-accent focus:outline-none"
        />
      </header>
      <PanelGroup direction="vertical" className="flex-1">
        <Panel defaultSize={32} minSize={20}>
          {/* `flex items-center` vertically centers the flow row inside its
              panel; `overflow-auto` still kicks in if the flow is too tall
              for the panel (only true when the user shrinks the divider). */}
          <div className="flex h-full items-center overflow-auto bg-surface px-4 py-3">
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
            <MockNodeEditor
              server={server}
              endpoint={endpoint}
              selection={selection}
              onSelect={setSelection}
            />
          </div>
        </Panel>
      </PanelGroup>
    </div>
  );
}
