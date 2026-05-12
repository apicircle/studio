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
 * Parse `a=1&b=2&c=` into rows. Empty input → one empty enabled row so
 * the user has somewhere to start typing. Decoding uses `decodeURIComponent`
 * so percent-encoded source is editable as plain text in the UI.
 */
export function parseUrlencoded(content: string): KeyValueRow[] {
  if (!content || content.trim() === '') {
    return [{ key: '', value: '', enabled: true }];
  }
  const out: KeyValueRow[] = [];
  for (const segment of content.split('&')) {
    if (segment === '') continue;
    const eqIdx = segment.indexOf('=');
    const rawKey = eqIdx === -1 ? segment : segment.slice(0, eqIdx);
    const rawValue = eqIdx === -1 ? '' : segment.slice(eqIdx + 1);
    out.push({
      key: safeDecode(rawKey),
      value: safeDecode(rawValue),
      enabled: true,
    });
  }
  return out.length > 0 ? out : [{ key: '', value: '', enabled: true }];
}

/**
 * Encode rows back into the wire-format string, filtering disabled rows.
 * `+` in keys/values → `%20` (form spec uses `+` for space, but
 * encodeURIComponent emits `%20`; either is accepted by parsers).
 */
export function serializeUrlencoded(rows: ReadonlyArray<KeyValueRow>): string {
  return rows
    .filter((r) => r.enabled && r.key !== '')
    .map((r) => `${encodeURIComponent(r.key)}=${encodeURIComponent(r.value)}`)
    .join('&');
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    // Malformed percent escape — fall back to the raw segment.
    return value;
  }
}
