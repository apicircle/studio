import type { BodyType, Request as ApiRequest, RequestBody } from '@apicircle-v2/shared';
import { applyContentTypeForBodyType } from '@apicircle-v2/core';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { cn } from '../../primitives/cn';
import { FormDataEditor } from './FormDataEditor';
import { BinaryEditor } from './BinaryEditor';

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

const PLACEHOLDER: Record<BodyType, string> = {
  none: '',
  json: '{\n  "key": "value"\n}',
  text: 'Plain text body',
  xml: '<root>\n  <key>value</key>\n</root>',
  urlencoded: 'key=value\nanother=value',
  'form-data': '',
  graphql: 'query {\n  user(id: 1) { name }\n}',
  binary: '',
};

export function BodyTab({ request }: BodyTabProps) {
  const setRequestBody = useWorkspaceStore((s) => s.setRequestBody);
  const setRequestHeaders = useWorkspaceStore((s) => s.setRequestHeaders);
  const detachBinaryFile = useWorkspaceStore((s) => s.detachBinaryFile);

  const onChangeType = (next: BodyType) => {
    if (next === request.body.type) return;
    // When leaving binary, clean up any held attachment.
    if (request.body.type === 'binary' && request.body.attachment?.slotId) {
      void detachBinaryFile(request.id);
    }

    let nextBody: RequestBody;
    if (next === 'form-data') {
      nextBody = { type: 'form-data', content: '', formRows: request.body.formRows ?? [] };
    } else if (next === 'binary') {
      nextBody = { type: 'binary', content: '', attachment: request.body.attachment };
    } else {
      // Text-shaped types share the `content` field. Carry it across so users
      // don't lose their JSON when they accidentally toggle to text and back.
      nextBody = { type: next, content: request.body.content };
    }
    setRequestBody(request.id, nextBody);

    // Sync Content-Type header to match the new body type. The reverse sync
    // (header edit → body type) lives in HeadersTab via a future hook.
    const updated = applyContentTypeForBodyType(request.headers, next);
    setRequestHeaders(request.id, updated);
  };

  const onChangeContent = (content: string) => {
    setRequestBody(request.id, { ...request.body, content });
  };

  return (
    <div className="flex flex-col gap-2">
      <div role="radiogroup" aria-label="Body type" className="flex flex-wrap gap-1">
        {BODY_TYPES.map((bt) => (
          <button
            key={bt.id}
            type="button"
            role="radio"
            aria-checked={request.body.type === bt.id}
            onClick={() => onChangeType(bt.id)}
            className={cn(
              'inline-flex h-6 items-center rounded-sm border px-2 text-[11px] transition-colors',
              request.body.type === bt.id
                ? 'border-accent/40 bg-accent/10 text-accent'
                : 'border-border bg-surface text-text-muted hover:text-text-primary',
            )}
          >
            {bt.label}
          </button>
        ))}
      </div>

      {request.body.type === 'none' && (
        <p className="rounded-sm border border-dashed border-border-subtle p-3 text-center text-xs text-text-dim">
          No body will be sent.
        </p>
      )}

      {request.body.type === 'form-data' && <FormDataEditor request={request} />}

      {request.body.type === 'binary' && <BinaryEditor request={request} />}

      {request.body.type !== 'none' &&
        request.body.type !== 'form-data' &&
        request.body.type !== 'binary' && (
          <textarea
            value={request.body.content}
            onChange={(e) => onChangeContent(e.target.value)}
            placeholder={PLACEHOLDER[request.body.type]}
            aria-label="Request body"
            className="min-h-[160px] w-full rounded-sm border border-border bg-card p-2 font-mono text-xs text-text-primary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30"
            spellCheck={false}
          />
        )}
    </div>
  );
}
