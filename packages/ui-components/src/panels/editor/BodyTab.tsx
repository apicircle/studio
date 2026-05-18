import { memo, useMemo, useState } from 'react';
import { Maximize2, Sparkles } from 'lucide-react';
import { useWorkspaceStore as useWorkspaceStoreForToast } from '../../store/workspaceStore';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import type { BodyType, Request as ApiRequest, RequestBody } from '@apicircle/shared';
import { applyContentTypeForBodyType } from '@apicircle/core';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { cn } from '../../primitives/cn';
import { FullscreenOverlay } from '../../primitives/FullscreenOverlay';
import { MonacoBodyEditor } from '../../editors/MonacoBodyEditor';
import { MonacoEditorBase } from '../../editors/MonacoEditorBase';
import { FormDataEditor } from './FormDataEditor';
import { BinaryEditor } from './BinaryEditor';
import { UrlencodedEditor } from './UrlencodedEditor';

interface BodyTabProps {
  request: ApiRequest;
}

const BODY_TYPES: Array<{ id: BodyType; label: string }> = [
  { id: 'none', label: 'none' },
  { id: 'json', label: 'JSON' },
  { id: 'text', label: 'text' },
  { id: 'xml', label: 'XML' },
  { id: 'urlencoded', label: 'urlencoded' },
  { id: 'form-data', label: 'form-data' },
  { id: 'graphql', label: 'GraphQL' },
  { id: 'binary', label: 'binary' },
];

function findContentType(headers: ApiRequest['headers']): string | undefined {
  const entry = headers.find((h) => h.enabled && h.key.trim().toLowerCase() === 'content-type');
  return entry?.value || undefined;
}

// memo'd — see ParamsTab for the rationale.
export const BodyTab = memo(function BodyTab({ request }: BodyTabProps) {
  const setRequestBody = useWorkspaceStore((s) => s.setRequestBody);
  const setRequestHeaders = useWorkspaceStore((s) => s.setRequestHeaders);
  const detachBinaryFile = useWorkspaceStore((s) => s.detachBinaryFile);
  const [fullscreen, setFullscreen] = useState(false);

  const onChangeType = (next: BodyType) => {
    if (next === request.body.type) return;
    if (request.body.type === 'binary' && request.body.attachment?.slotId) {
      void detachBinaryFile(request.id);
    }

    let nextBody: RequestBody;
    if (next === 'form-data') {
      nextBody = { type: 'form-data', content: '', formRows: request.body.formRows ?? [] };
    } else if (next === 'binary') {
      nextBody = { type: 'binary', content: '', attachment: request.body.attachment };
    } else {
      nextBody = { type: next, content: request.body.content };
    }
    setRequestBody(request.id, nextBody);

    const updated = applyContentTypeForBodyType(request.headers, next);
    setRequestHeaders(request.id, updated);
  };

  const onChangeContent = (content: string) => {
    setRequestBody(request.id, { ...request.body, content });
  };

  // urlencoded now has a dedicated key/value editor (audit gap A6 — raw
  // text Monaco was surprising for a key/value format). Keep it out of
  // the Monaco branch so the new editor renders below.
  const showMonaco =
    request.body.type !== 'none' &&
    request.body.type !== 'form-data' &&
    request.body.type !== 'binary' &&
    request.body.type !== 'urlencoded';

  const contentType = findContentType(request.headers);
  const editorAriaLabel = 'Request body';

  const isGraphQL = request.body.type === 'graphql';
  const queryEditor = showMonaco ? (
    <MonacoBodyEditor
      value={request.body.content}
      bodyType={request.body.type}
      contentType={contentType}
      onChange={onChangeContent}
      modelPath={`inmemory://apicircle/request/${request.id}.body`}
      ariaLabel={isGraphQL ? 'GraphQL query' : editorAriaLabel}
      height="100%"
      minHeight={120}
      request={request}
    />
  ) : null;

  const onChangeVariables = (vars: string) => {
    setRequestBody(request.id, { ...request.body, variables: vars });
  };

  const editorElement = isGraphQL ? (
    <PanelGroup direction="horizontal" autoSaveId={`apicircle:graphql:${request.id}`}>
      <Panel defaultSize={60} minSize={20}>
        <div className="flex h-full w-full flex-col">
          <span className="px-2 py-1 text-[0.6875rem] uppercase tracking-wide text-text-dim">
            Query
          </span>
          <div className="min-h-0 flex-1 overflow-hidden">{queryEditor}</div>
        </div>
      </Panel>
      <PanelResizeHandle
        aria-label="Resize GraphQL query and variables"
        className="group flex w-1.5 cursor-col-resize items-center justify-center border-x border-border-subtle bg-surface hover:bg-accent/20"
      >
        <span className="h-8 w-0.5 rounded-full bg-border group-hover:bg-accent" />
      </PanelResizeHandle>
      <Panel defaultSize={40} minSize={20}>
        <div className="flex h-full w-full flex-col">
          <span className="px-2 py-1 text-[0.6875rem] uppercase tracking-wide text-text-dim">
            Variables (JSON)
          </span>
          <div className="min-h-0 flex-1 overflow-hidden">
            <MonacoEditorBase
              value={request.body.variables ?? ''}
              language="json"
              onChange={onChangeVariables}
              ariaLabel="GraphQL variables"
              height="100%"
              modelPath={`inmemory://apicircle/request/${request.id}.gql-vars`}
            />
          </div>
        </div>
      </Panel>
    </PanelGroup>
  ) : (
    queryEditor
  );

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div
          role="radiogroup"
          aria-label="Body type"
          className="flex flex-wrap gap-1"
          onKeyDown={(e) => {
            // Arrow-key cycle through body types (WAI-ARIA radiogroup pattern).
            // Without this, keyboard users had to Tab through every option.
            const currentIdx = BODY_TYPES.findIndex((b) => b.id === request.body.type);
            let next = currentIdx;
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown')
              next = (currentIdx + 1) % BODY_TYPES.length;
            else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp')
              next = (currentIdx - 1 + BODY_TYPES.length) % BODY_TYPES.length;
            else if (e.key === 'Home') next = 0;
            else if (e.key === 'End') next = BODY_TYPES.length - 1;
            else return;
            e.preventDefault();
            onChangeType(BODY_TYPES[next].id);
            requestAnimationFrame(() => {
              const target = e.currentTarget.querySelector<HTMLElement>(
                `[data-radio-index="${next}"]`,
              );
              target?.focus();
            });
          }}
        >
          {BODY_TYPES.map((bt, idx) => (
            <button
              key={bt.id}
              type="button"
              role="radio"
              aria-checked={request.body.type === bt.id}
              tabIndex={request.body.type === bt.id ? 0 : -1}
              data-radio-index={idx}
              onClick={() => onChangeType(bt.id)}
              className={cn(
                'inline-flex h-6 items-center rounded-sm border px-2 text-[0.6875rem] transition-colors',
                request.body.type === bt.id
                  ? 'border-accent/40 bg-accent/10 text-accent'
                  : 'border-border bg-surface text-text-muted hover:text-text-primary',
              )}
            >
              {bt.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1">
          {request.body.type === 'json' && (
            <button
              type="button"
              onClick={() => {
                try {
                  const reformatted = JSON.stringify(JSON.parse(request.body.content), null, 2);
                  onChangeContent(reformatted);
                } catch (err) {
                  useWorkspaceStoreForToast.getState().pushToast({
                    tone: 'error',
                    title: 'Cannot prettify',
                    detail:
                      err instanceof Error
                        ? `Body is not valid JSON: ${err.message}`
                        : 'Body is not valid JSON.',
                  });
                }
              }}
              aria-label="Prettify JSON body"
              title="Prettify JSON (Ctrl+Shift+F equivalent)"
              className="inline-flex h-6 items-center gap-1 rounded-sm border border-border bg-surface px-2 text-[0.625rem] text-text-muted hover:border-accent hover:text-text-primary"
            >
              <Sparkles size={11} />
              Prettify
            </button>
          )}
          {showMonaco && (
            <button
              type="button"
              onClick={() => setFullscreen(true)}
              aria-label="Fullscreen request body"
              title="Fullscreen (Esc to exit)"
              className="inline-flex h-6 w-6 items-center justify-center rounded-sm border border-border bg-surface text-text-muted hover:text-text-primary"
            >
              <Maximize2 size={12} />
            </button>
          )}
        </div>
      </div>

      {request.body.type === 'none' && (
        <p className="rounded-sm border border-dashed border-border-subtle p-3 text-center text-xs text-text-dim">
          No body will be sent.
        </p>
      )}

      {request.body.type === 'form-data' && <FormDataEditor request={request} />}

      {request.body.type === 'binary' && <BinaryEditor request={request} />}

      {request.body.type === 'urlencoded' && <UrlencodedEditor request={request} />}

      {showMonaco && !fullscreen && (
        <div className="flex min-h-0 flex-1 overflow-hidden rounded-sm border border-border">
          {editorElement}
        </div>
      )}

      <FullscreenOverlay
        open={fullscreen && showMonaco}
        onClose={() => setFullscreen(false)}
        title={`Request body — ${request.name || 'Untitled'}`}
      >
        <div className="h-full w-full">{editorElement}</div>
      </FullscreenOverlay>

      {request.body.type === 'json' && <JsonSchemaPicker request={request} />}
      {request.body.type === 'graphql' && <GraphqlSchemaPicker request={request} />}
    </div>
  );
});

function JsonSchemaPicker({ request }: { request: ApiRequest }) {
  const schemas = useWorkspaceStore((s) =>
    s.synced ? Object.values(s.synced.globalAssets.schemas) : [],
  );
  const setRequestBodySchemaId = useWorkspaceStore((s) => s.setRequestBodySchemaId);
  const openRightDockTab = useWorkspaceStore((s) => s.openRightDockTab);

  // Quick parse-validity cue. Monaco's JSON language service surfaces full
  // schema errors as inline markers; this pill is the at-a-glance status
  // so the user knows whether the body is even parseable before reading
  // squiggles. Empty body is silent (no opinion).
  const parseStatus = useMemo(() => {
    const trimmed = request.body.content.trim();
    if (trimmed === '') return 'empty' as const;
    try {
      JSON.parse(trimmed);
      return 'ok' as const;
    } catch (e) {
      return { kind: 'error' as const, message: e instanceof Error ? e.message : 'parse failed' };
    }
  }, [request.body.content]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label
        className="text-[0.6875rem] uppercase tracking-wide text-text-dim"
        htmlFor={`schema-${request.id}`}
      >
        Validate against
      </label>
      <select
        id={`schema-${request.id}`}
        aria-label="JSON schema"
        value={request.bodySchemaId ?? ''}
        onChange={(e) => setRequestBodySchemaId(request.id, e.target.value || null)}
        className="h-7 rounded-sm border border-border bg-card px-2 text-xs text-text-primary focus:border-accent focus:outline-none"
      >
        <option value="">No schema</option>
        {schemas.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => openRightDockTab('assets')}
        className="text-[0.6875rem] text-text-muted hover:text-accent"
      >
        Manage…
      </button>
      {parseStatus === 'ok' && (
        <span
          className="inline-flex h-6 items-center gap-1 rounded-sm border border-success/40 bg-success/10 px-2 text-[0.625rem] uppercase tracking-wider text-success"
          aria-label="Body parses as valid JSON"
        >
          ✓ Valid JSON
        </span>
      )}
      {typeof parseStatus === 'object' && parseStatus.kind === 'error' && (
        <span
          role="alert"
          className="inline-flex h-6 max-w-md items-center gap-1 truncate rounded-sm border border-danger/40 bg-danger/10 px-2 text-[0.625rem] text-danger"
          title={parseStatus.message}
        >
          ✗ {parseStatus.message}
        </span>
      )}
      {request.bodySchemaId && parseStatus === 'ok' && (
        <span className="text-[0.625rem] text-text-dim">
          Schema errors (if any) appear inline in the editor.
        </span>
      )}
    </div>
  );
}

function GraphqlSchemaPicker({ request }: { request: ApiRequest }) {
  const schemas = useWorkspaceStore((s) =>
    s.synced ? Object.values(s.synced.globalAssets.graphql) : [],
  );
  const setRequestGraphqlSchemaId = useWorkspaceStore((s) => s.setRequestGraphqlSchemaId);
  const openRightDockTab = useWorkspaceStore((s) => s.openRightDockTab);

  return (
    <div className="flex items-center gap-2">
      <label
        className="text-[0.6875rem] uppercase tracking-wide text-text-dim"
        htmlFor={`gql-${request.id}`}
      >
        GraphQL schema
      </label>
      <select
        id={`gql-${request.id}`}
        aria-label="GraphQL schema"
        value={request.graphqlSchemaId ?? ''}
        onChange={(e) => setRequestGraphqlSchemaId(request.id, e.target.value || null)}
        className="h-7 rounded-sm border border-border bg-card px-2 text-xs text-text-primary focus:border-accent focus:outline-none"
      >
        <option value="">No schema</option>
        {schemas.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => openRightDockTab('assets')}
        className="text-[0.6875rem] text-text-muted hover:text-accent"
      >
        Manage…
      </button>
    </div>
  );
}
