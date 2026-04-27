import type { BodyType } from '@apicircle-v2/shared';

// Single source of truth for body-type ↔ Content-Type mapping. The Editor
// uses this to (a) seed the Content-Type header when the user picks a body
// type and (b) reverse-resolve a body type when the user edits the
// Content-Type header by hand.

export type HeaderEntry = { key: string; value: string; enabled: boolean };

const BODY_TYPE_TO_CONTENT_TYPE: Record<BodyType, string | null> = {
  none: null,
  json: 'application/json',
  text: 'text/plain',
  xml: 'application/xml',
  graphql: 'application/graphql',
  'form-data': 'multipart/form-data',
  urlencoded: 'application/x-www-form-urlencoded',
  binary: 'application/octet-stream',
};

export function getContentTypeForBodyType(bodyType: BodyType): string | null {
  return BODY_TYPE_TO_CONTENT_TYPE[bodyType];
}

/**
 * Reverse-map a Content-Type header value to a BodyType, or null if it
 * doesn't match any known type. Strips parameters (e.g. `;charset=utf-8`)
 * and is case-insensitive.
 */
export function getBodyTypeForContentType(contentType: string): BodyType | null {
  const main = contentType.toLowerCase().split(';')[0]?.trim();
  if (!main) return null;
  switch (main) {
    case 'application/json':
      return 'json';
    case 'text/plain':
      return 'text';
    case 'application/xml':
    case 'text/xml':
      return 'xml';
    case 'application/graphql':
      return 'graphql';
    case 'multipart/form-data':
      return 'form-data';
    case 'application/x-www-form-urlencoded':
      return 'urlencoded';
    case 'application/octet-stream':
      return 'binary';
    default:
      return null;
  }
}

/**
 * Apply (or remove) the Content-Type header on a header list to match the
 * given body type. Pure — returns a new array.
 *
 * - bodyType=none → strips any existing Content-Type entry.
 * - existing Content-Type entry → updated value, preserving order.
 * - no Content-Type entry → appended.
 */
export function applyContentTypeForBodyType(
  headers: HeaderEntry[],
  bodyType: BodyType,
): HeaderEntry[] {
  const target = getContentTypeForBodyType(bodyType);
  const idx = headers.findIndex((h) => h.key.trim().toLowerCase() === 'content-type');

  if (target === null) {
    return idx === -1 ? headers : headers.filter((_, i) => i !== idx);
  }

  if (idx === -1) {
    return [...headers, { key: 'Content-Type', value: target, enabled: true }];
  }

  return headers.map((entry, i) =>
    i === idx ? { ...entry, value: target, enabled: true } : entry,
  );
}
