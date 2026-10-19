import type { ExecutionResult } from '@apicircle/core';

type BodyKind = ExecutionResult['bodyKind'];

/** The file extension for a response body, from what it is and its Content-Type. */
export function responseFileExtension(kind: BodyKind, contentType: string | undefined): string {
  if (kind === 'json') return 'json';
  if (kind === 'binary') return 'bin';
  const ct = (contentType ?? '').toLowerCase();
  if (ct.includes('xml')) return 'xml';
  if (ct.includes('html')) return 'html';
  if (ct.includes('csv')) return 'csv';
  if (ct.includes('javascript')) return 'js';
  if (ct.includes('yaml')) return 'yaml';
  return 'txt';
}

/** Letters, digits, dot, dash and underscore; anything else becomes `_`. */
function safeName(raw: string): string {
  return raw.replace(/[^a-z0-9._-]+/gi, '_').replace(/^[._]+|[._]+$/g, '');
}

/**
 * The name to save a response body under: the last part of the URL's path
 * (`/v1/users` → `users.json`), or its host when the path is `/`, or
 * `response`. A name that already ends in the extension keeps it once.
 */
export function responseFileName(
  url: string,
  kind: BodyKind,
  contentType: string | undefined,
): string {
  const extension = responseFileExtension(kind, contentType);
  let base = '';
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split('/').filter(Boolean);
    const last = segments[segments.length - 1];
    base = safeName(last ? decodeURIComponent(last) : parsed.hostname);
  } catch {
    // Not a URL Studio can read (a template that never resolved): fall back.
  }
  if (!base) base = 'response';
  return base.toLowerCase().endsWith(`.${extension}`) ? base : `${base}.${extension}`;
}
