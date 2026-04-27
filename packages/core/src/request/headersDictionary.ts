// HTTP headers dictionary — used for autocomplete in the Headers editor.
// Curated subset of the most-used request headers; expand as Editor UX
// surfaces gaps. Matches v1's data shape so future ports plug in cleanly.

export interface HeaderEntry {
  name: string;
  description: string;
  values: string[];
  /**
   * `browser` — Forbidden by the Fetch spec; browsers ignore JS attempts to set.
   * `app`     — Auto-injected by the app at send time; user values override.
   */
  reserved?: 'browser' | 'app';
  reservedNote?: string;
}

export const HTTP_HEADERS_MAP: HeaderEntry[] = [
  {
    name: 'Accept',
    description: 'Media types the client accepts',
    values: [
      'application/json',
      'application/xml',
      'text/html',
      'text/plain',
      'application/octet-stream',
      'multipart/form-data',
      'application/x-www-form-urlencoded',
      '*/*',
    ],
  },
  {
    name: 'Accept-Encoding',
    description: 'Acceptable content encodings',
    values: ['gzip', 'deflate', 'br', 'zstd', 'identity'],
    reserved: 'browser',
    reservedNote: 'Set by the browser; ignored from JS in web fetch',
  },
  {
    name: 'Accept-Language',
    description: 'Acceptable human languages',
    values: ['en', 'en-US', 'en-GB', 'fr', 'de', 'ja', 'zh-CN', 'es', '*'],
  },
  {
    name: 'Authorization',
    description: 'Authentication credentials',
    values: ['Bearer ', 'Basic ', 'Digest ', 'AWS4-HMAC-SHA256 ', 'ApiKey '],
  },
  {
    name: 'Cache-Control',
    description: 'Caching directives',
    values: [
      'no-cache',
      'no-store',
      'max-age=0',
      'max-age=3600',
      'must-revalidate',
      'private',
      'public',
    ],
  },
  {
    name: 'Connection',
    description: 'Control whether to keep the connection open',
    values: ['keep-alive', 'close'],
    reserved: 'browser',
  },
  {
    name: 'Content-Length',
    description: 'Size of the request body in bytes',
    values: [],
    reserved: 'browser',
    reservedNote: 'Computed automatically from the body',
  },
  {
    name: 'Content-Type',
    description: 'Media type of the request body',
    values: [
      'application/json',
      'application/xml',
      'text/plain',
      'text/html',
      'application/x-www-form-urlencoded',
      'multipart/form-data',
      'application/graphql',
      'application/octet-stream',
    ],
  },
  {
    name: 'Cookie',
    description: 'Cookies sent with the request',
    values: [],
  },
  {
    name: 'Host',
    description: 'Hostname of the server',
    values: [],
    reserved: 'browser',
    reservedNote: 'Set by the browser from the URL',
  },
  {
    name: 'If-Match',
    description: 'Make the request conditional on the matching ETag',
    values: ['*'],
  },
  {
    name: 'If-None-Match',
    description: 'Make the request conditional on a non-matching ETag',
    values: ['*'],
  },
  {
    name: 'If-Modified-Since',
    description: 'Make the request conditional on the resource being modified',
    values: [],
  },
  {
    name: 'Origin',
    description: 'Origin of the request',
    values: [],
    reserved: 'browser',
  },
  {
    name: 'Referer',
    description: 'Address of the previous web page',
    values: [],
    reserved: 'browser',
  },
  {
    name: 'User-Agent',
    description: 'Identifies the client software',
    values: [],
    reserved: 'browser',
    reservedNote: 'Set by the browser; cannot be overridden in web fetch',
  },
  {
    name: 'X-API-Key',
    description: 'API key authentication',
    values: [],
  },
  {
    name: 'X-Request-ID',
    description: 'Client-generated request ID for tracing',
    values: [],
  },
  {
    name: 'X-Forwarded-For',
    description: 'Originating IP when proxied',
    values: [],
  },
];

const HEADER_MAP = new Map<string, HeaderEntry>(
  HTTP_HEADERS_MAP.map((h) => [h.name.toLowerCase(), h]),
);

const SUGGESTABLE_HEADERS = HTTP_HEADERS_MAP.filter((h) => h.reserved !== 'app').sort((a, b) =>
  a.name.localeCompare(b.name),
);

/**
 * Suggest header names by case-insensitive prefix. Empty prefix returns the
 * full suggestable list; auto-fed (`reserved: 'app'`) headers are excluded.
 */
export function suggestHeaders(prefix: string, limit?: number): HeaderEntry[] {
  const lower = prefix.toLowerCase().trim();
  if (!lower)
    return limit !== undefined ? SUGGESTABLE_HEADERS.slice(0, limit) : SUGGESTABLE_HEADERS;
  const filtered = SUGGESTABLE_HEADERS.filter((h) => h.name.toLowerCase().startsWith(lower));
  return limit !== undefined ? filtered.slice(0, limit) : filtered;
}

export function getHeaderValues(headerName: string): string[] {
  return HEADER_MAP.get(headerName.toLowerCase().trim())?.values ?? [];
}

export function getHeaderEntry(headerName: string): HeaderEntry | undefined {
  return HEADER_MAP.get(headerName.toLowerCase().trim());
}
