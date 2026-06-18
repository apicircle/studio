import { useMemo } from 'react';
import type { Request as ApiRequest } from '@apicircle/shared';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { KeyValueRows, type KeyValueRow } from './KeyValueRows';

/**
 * Key/value editor for `application/x-www-form-urlencoded` bodies. Wraps
 * KeyValueRows; round-trips through the request's `body.content` string
 * so the on-wire shape is unchanged. Disabled rows are filtered at
 * serialization time (matches Headers/Query semantics).
 *
 * Why this exists: the body editor previously dropped users into a raw
 * text Monaco for urlencoded — surprising UX given the format is itself a
 * key/value list. Audit gap A6.
 */
export function UrlencodedEditor({ request }: { request: ApiRequest }) {
  const setRequestBody = useWorkspaceStore((s) => s.setRequestBody);
  const content = request.body.type === 'urlencoded' ? request.body.content : '';

  const rows = useMemo<KeyValueRow[]>(() => parseUrlencoded(content), [content]);

  const onChange = (next: KeyValueRow[]): void => {
    setRequestBody(request.id, { ...request.body, content: serializeUrlencoded(next) });
  };

  return (
    <div className="flex flex-col gap-1.5">
      <KeyValueRows
        ariaLabel="Form field"
        rows={rows}
        onChange={onChange}
        keyPlaceholder="Field key"
        valuePlaceholder="Field value"
      />
      <p className="text-[0.625rem] text-text-dim">
        Sent as <code>application/x-www-form-urlencoded</code> — keys and values are percent-encoded
        automatically. Disabled rows are skipped at send time.
      </p>
    </div>
  );
}

/**
 * Parse the request's `body.content` into editor rows. The stored format
 * is raw, newline-delimited `key=value` lines — un-encoded, with any
 * `{{var}}` references left intact. `buildRequest.composeBody` percent-
 * encodes each pair at send time, so the editor must NOT encode here
 * (doing so would double-encode the wire body and hide variables from
 * resolution). Empty input → one empty enabled row to type into.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function parseUrlencoded(content: string): KeyValueRow[] {
  if (!content || content.trim() === '') {
    return [{ key: '', value: '', enabled: true }];
  }
  const out: KeyValueRow[] = [];
  for (const line of content.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    const eqIdx = line.indexOf('=');
    const key = eqIdx === -1 ? line : line.slice(0, eqIdx);
    const value = eqIdx === -1 ? '' : line.slice(eqIdx + 1);
    out.push({ key, value, enabled: true });
  }
  return out.length > 0 ? out : [{ key: '', value: '', enabled: true }];
}

/**
 * Serialize rows into `body.content` — raw, newline-delimited `key=value`
 * lines, filtering disabled and empty-key rows. Values are stored verbatim
 * (no percent-encoding): `composeBody` encodes the pairs when it builds
 * the wire body. This is the format `buildRequest` expects.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function serializeUrlencoded(rows: ReadonlyArray<KeyValueRow>): string {
  return rows
    .filter((r) => r.enabled && r.key !== '')
    .map((r) => `${r.key}=${r.value}`)
    .join('\n');
}
