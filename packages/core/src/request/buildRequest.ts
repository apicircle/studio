import type { Request as ApiRequest } from '@apicircle-v2/shared';

export interface BuiltRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: BodyInit | null;
}

/**
 * Resolves an attachment slotId to a Blob (with filename for form-data).
 * The host (UI layer) reads this from its IndexedDB attachments store.
 * Returns null when the attachment is missing — composeBody treats missing
 * attachments as empty fields rather than throwing.
 */
export type AttachmentResolver = (
  slotId: string,
) => Promise<{ blob: Blob; filename: string } | null>;

export function composeUrl(
  rawUrl: string,
  params: ReadonlyArray<{ key: string; value: string; enabled: boolean }>,
): string {
  const enabled = params.filter((p) => p.enabled && p.key.trim().length > 0);
  if (enabled.length === 0) return rawUrl;

  let parsed: URL | null = null;
  try {
    parsed = new URL(rawUrl);
  } catch {
    parsed = null;
  }
  if (parsed) {
    for (const p of enabled) parsed.searchParams.append(p.key, p.value);
    return parsed.toString();
  }

  const query = enabled
    .map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`)
    .join('&');
  if (query.length === 0) return rawUrl;
  return rawUrl.includes('?') ? `${rawUrl}&${query}` : `${rawUrl}?${query}`;
}

export function composeHeaders(
  rows: ReadonlyArray<{ key: string; value: string; enabled: boolean }>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of rows) {
    if (!row.enabled) continue;
    const k = row.key.trim();
    if (!k) continue;
    out[k] = row.value;
  }
  return out;
}

/**
 * Strip Content-Type from a header set. Used for form-data and binary bodies
 * where the browser must set Content-Type itself (multipart boundary, blob's
 * own type) — a manually-set header would corrupt the request.
 */
function stripContentType(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (k.trim().toLowerCase() === 'content-type') continue;
    out[k] = v;
  }
  return out;
}

/**
 * Serialize a request body for fetch(). Async because form-data and binary
 * may need to read attachment blobs from the host's storage layer.
 */
export async function composeBody(
  body: ApiRequest['body'],
  resolveAttachment?: AttachmentResolver,
): Promise<BodyInit | null> {
  if (body.type === 'none') return null;

  if (
    body.type === 'json' ||
    body.type === 'text' ||
    body.type === 'xml' ||
    body.type === 'graphql'
  ) {
    return body.content;
  }

  if (body.type === 'urlencoded') {
    const params = new URLSearchParams();
    for (const line of body.content.split(/\r?\n/)) {
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      const value = line.slice(eq + 1);
      if (!key) continue;
      params.append(key, value);
    }
    return params.toString();
  }

  if (body.type === 'form-data') {
    const fd = new FormData();
    for (const row of body.formRows ?? []) {
      if (!row.enabled || !row.key.trim()) continue;
      if (row.kind === 'text') {
        fd.append(row.key, row.value);
      } else if (row.slotId && resolveAttachment) {
        const file = await resolveAttachment(row.slotId);
        if (file) fd.append(row.key, file.blob, file.filename);
      }
    }
    return fd;
  }

  if (body.type === 'binary') {
    if (body.attachment?.slotId && resolveAttachment) {
      const file = await resolveAttachment(body.attachment.slotId);
      if (file) return file.blob;
    }
    return null;
  }

  return null;
}

export async function buildRequest(
  req: ApiRequest,
  resolveAttachment?: AttachmentResolver,
): Promise<BuiltRequest> {
  const headers = composeHeaders(req.headers);
  // form-data and binary: let fetch set Content-Type from the FormData
  // boundary or the Blob's own type. Any user-set Content-Type would break
  // the request.
  const sanitizedHeaders =
    req.body.type === 'form-data' || req.body.type === 'binary'
      ? stripContentType(headers)
      : headers;
  return {
    url: composeUrl(req.url, req.query),
    method: req.method,
    headers: sanitizedHeaders,
    body: await composeBody(req.body, resolveAttachment),
  };
}
