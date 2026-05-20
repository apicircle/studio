/**
 * HTTP Headers dictionary — used for autocomplete in the Headers editor.
 *
 * Each entry maps a header name to its known values (empty array = free text).
 * Values that depend on context (e.g. specific MIME types) provide a curated
 * set of the most common options.
 */

export interface HeaderEntry {
  name: string;
  description: string;
  values: string[];
  /**
   * `browser` — Forbidden by the Fetch spec; browsers silently ignore any
   *             attempt to set this header from JavaScript. On Desktop (native
   *             HTTP layer) the restriction does NOT apply — the header can
   *             still be set manually.
   *
   * `app`     — Automatically injected by API Circle Studio at send-time (see
   *             autoHeaders.ts). Users can override these in the Headers tab
   *             and their value will take precedence.
   *
   * Omitted   — Fully user-controlled on both Web and Desktop.
   */
  reserved?: 'browser' | 'app';
  /** Short note shown in the autocomplete to explain the reservation. */
  reservedNote?: string;
}

export const HTTP_HEADERS_MAP: HeaderEntry[] = [
  // ── Request headers ────────────────────────────────────────────────────────
  {
    name: 'Accept',
    description: 'Media types the client accepts',
    values: [
      'application/json',
      'application/xml',
      'text/html',
      'text/plain',
      'text/csv',
      'application/octet-stream',
      'multipart/form-data',
      'application/x-www-form-urlencoded',
      'application/graphql',
      'image/png',
      'image/jpeg',
      'image/webp',
      'image/gif',
      'image/svg+xml',
      '*/*',
    ],
  },
  {
    name: 'Accept-Encoding',
    description: 'Acceptable content encodings',
    values: ['gzip', 'deflate', 'br', 'zstd', 'identity', 'gzip, deflate, br'],
    reserved: 'browser',
    reservedNote: 'Set automatically by the browser; ignored in web fetch',
  },
  {
    name: 'Accept-Language',
    description: 'Acceptable human languages',
    values: ['en', 'en-US', 'en-GB', 'fr', 'de', 'ja', 'zh-CN', 'es', '*'],
  },
  {
    name: 'Authorization',
    description: 'Authentication credentials',
    values: ['Bearer ', 'Basic ', 'Digest ', 'NTLM ', 'AWS4-HMAC-SHA256 ', 'ApiKey '],
  },
  {
    name: 'Cache-Control',
    description: 'Directives for caching mechanisms',
    values: [
      'no-cache',
      'no-store',
      'max-age=0',
      'max-age=3600',
      'must-revalidate',
      'private',
      'public',
      'no-cache, no-store, must-revalidate',
    ],
  },
  {
    name: 'Connection',
    description: 'Control options for the current connection',
    values: ['keep-alive', 'close', 'upgrade'],
    reserved: 'browser',
    reservedNote: 'Forbidden by Fetch spec; browser controls connection management',
  },
  {
    name: 'Content-Encoding',
    description: 'Encoding applied to the body',
    values: ['gzip', 'deflate', 'br', 'identity'],
  },
  {
    name: 'Content-Length',
    description: 'Size of the request body in bytes',
    values: [],
    reserved: 'browser',
    reservedNote: 'Computed automatically; ignored in web fetch',
  },
  {
    name: 'Content-Type',
    description: 'Media type of the request body',
    values: [
      'application/json',
      'application/xml',
      'text/xml',
      'text/html',
      'text/plain',
      'text/csv',
      'application/x-www-form-urlencoded',
      'multipart/form-data',
      'application/octet-stream',
      'application/graphql',
      'application/ld+json',
      'application/vnd.api+json',
      'application/problem+json',
    ],
  },
  {
    name: 'Cookie',
    description: 'HTTP cookies sent by the client',
    values: [],
    reserved: 'browser',
    reservedNote: 'Managed by the browser cookie jar; forbidden in web fetch',
  },
  {
    name: 'Host',
    description: 'Host and port of the target server',
    values: [],
    reserved: 'browser',
    reservedNote: 'Derived from the request URL; forbidden in web fetch',
  },
  {
    name: 'If-Match',
    description: 'Conditional request based on ETag',
    values: ['*'],
  },
  {
    name: 'If-Modified-Since',
    description: 'Conditional GET if modified after this date',
    values: [],
  },
  {
    name: 'If-None-Match',
    description: 'Conditional request — only respond if ETag differs',
    values: ['*'],
  },
  {
    name: 'If-Unmodified-Since',
    description: 'Conditional request based on date',
    values: [],
  },
  {
    name: 'Origin',
    description: 'Origin of the cross-origin request',
    values: ['http://app.studio.apicircle.dev', 'https://app.studio.apicircle.dev'],
    reserved: 'browser',
    reservedNote: 'Set by browser on cross-origin requests; auto-fed on Desktop',
  },
  {
    name: 'Prefer',
    description: 'Client preferences for server behaviour',
    values: [
      'respond-async',
      'return=representation',
      'return=minimal',
      'handling=strict',
      'handling=lenient',
    ],
  },
  {
    name: 'Range',
    description: 'Request partial content',
    values: ['bytes=0-', 'bytes=0-1023'],
  },
  {
    name: 'Referer',
    description: 'URL of the page making the request',
    values: ['http://app.studio.apicircle.dev/'],
    reserved: 'browser',
    reservedNote: 'Set by browser from document context; auto-fed on Desktop',
  },
  {
    name: 'User-Agent',
    description: 'Client application identifier',
    values: [
      'API Circle Studio/1.0.0',
      'Mozilla/5.0 (compatible; API Circle Studio)',
      'curl/8.0.0',
    ],
    reserved: 'browser',
    reservedNote: 'Forbidden in web fetch; settable in Desktop (native) requests',
  },
  {
    name: 'X-API-Key',
    description: 'API key for authentication',
    values: [],
  },
  {
    name: 'X-Client-Name',
    description: 'Auto-fed: client application name',
    values: ['API Circle Studio'],
    reserved: 'app',
    reservedNote: 'Injected automatically; your value overrides it',
  },
  {
    name: 'X-Client-Platform',
    description: 'Auto-fed: runtime platform',
    values: ['desktop', 'web'],
    reserved: 'app',
    reservedNote: 'Injected automatically; your value overrides it',
  },
  {
    name: 'X-Client-Version',
    description: 'Auto-fed: application version',
    values: ['1.0.0'],
    reserved: 'app',
    reservedNote: 'Injected automatically; your value overrides it',
  },
  {
    name: 'X-Correlation-Id',
    description: 'Correlation ID for distributed tracing',
    values: [],
  },
  {
    name: 'X-Custom-Auth',
    description: 'Custom authentication header',
    values: [],
  },
  {
    name: 'X-Forwarded-For',
    description: 'Originating IP in proxy chains',
    values: [],
  },
  {
    name: 'X-Forwarded-Host',
    description: 'Originating host in proxy chains',
    values: [],
  },
  {
    name: 'X-Forwarded-Proto',
    description: 'Originating protocol in proxy chains',
    values: ['http', 'https'],
  },
  {
    name: 'X-Request-ID',
    description: 'Unique identifier for this request',
    values: [],
  },
  {
    name: 'X-Trace-Span-Id',
    description: 'Auto-fed: distributed trace span ID (generated per send)',
    values: [],
    reserved: 'app',
    reservedNote: 'Regenerated on every send; cannot be stored or overridden',
  },
  {
    name: 'traceparent',
    description: 'W3C Trace Context parent (auto-fed per send)',
    values: [],
    reserved: 'app',
    reservedNote: 'Regenerated on every send; your value overrides it',
  },
  // ── Conditional / caching ─────────────────────────────────────────────────
  {
    name: 'Pragma',
    description: 'Legacy cache control (HTTP/1.0)',
    values: ['no-cache'],
  },
  {
    name: 'Expires',
    description: 'Date/time after which the response is stale',
    values: [],
  },
  {
    name: 'Date',
    description: 'Date and time the message was sent',
    values: [],
    reserved: 'browser',
    reservedNote: 'Set by the HTTP stack; forbidden in web fetch',
  },
  {
    name: 'Age',
    description: 'Seconds the object has been in a proxy cache',
    values: [],
  },
  {
    name: 'Last-Modified',
    description: 'Date the resource was last modified',
    values: [],
  },
  {
    name: 'Vary',
    description: 'Headers that determine cache key',
    values: ['Accept', 'Accept-Encoding', 'Accept-Language', 'Origin', '*'],
  },
  // ── Transfer / encoding ───────────────────────────────────────────────────
  {
    name: 'Transfer-Encoding',
    description: 'Transfer encoding applied to the message body',
    values: ['chunked', 'compress', 'deflate', 'gzip', 'identity'],
    reserved: 'browser',
    reservedNote: 'Managed by the HTTP stack; forbidden in web fetch',
  },
  {
    name: 'TE',
    description: 'Transfer encodings the client can accept',
    values: ['trailers', 'deflate', 'gzip'],
    reserved: 'browser',
    reservedNote: 'Forbidden in web fetch',
  },
  {
    name: 'Trailer',
    description: 'Headers included in the trailer of a chunked transfer',
    values: [],
    reserved: 'browser',
    reservedNote: 'Forbidden in web fetch',
  },
  {
    name: 'Upgrade',
    description: 'Protocol upgrade request',
    values: ['websocket', 'HTTP/2.0', 'h2c'],
    reserved: 'browser',
    reservedNote: 'Forbidden in web fetch; use WebSocket API instead',
  },
  // ── Proxy / forwarding ────────────────────────────────────────────────────
  {
    name: 'Forwarded',
    description: 'Standard proxy forwarding header (replaces X-Forwarded-*)',
    values: [],
  },
  {
    name: 'Max-Forwards',
    description: 'Maximum number of proxy hops for TRACE/OPTIONS',
    values: ['10'],
  },
  {
    name: 'Proxy-Authorization',
    description: 'Credentials for authenticating with a proxy',
    values: ['Basic ', 'Bearer '],
    reserved: 'browser',
    reservedNote: 'Proxy-* headers are forbidden in web fetch',
  },
  {
    name: 'Via',
    description: 'Proxies/gateways this message has passed through',
    values: [],
    reserved: 'browser',
    reservedNote: 'Set by proxy infrastructure; forbidden in web fetch',
  },
  // ── Content negotiation (extra) ───────────────────────────────────────────
  {
    name: 'Accept-Charset',
    description: 'Character sets the client accepts',
    values: ['utf-8', 'iso-8859-1', '*'],
    reserved: 'browser',
    reservedNote: 'Forbidden in web fetch',
  },
  {
    name: 'Accept-Ranges',
    description: 'Whether partial requests are supported',
    values: ['bytes', 'none'],
  },
  // ── Content description ───────────────────────────────────────────────────
  {
    name: 'Allow',
    description: 'HTTP methods supported by the resource',
    values: ['GET, HEAD', 'GET, POST', 'GET, POST, PUT, DELETE, OPTIONS'],
  },
  {
    name: 'Content-Disposition',
    description: 'How content should be displayed / filename hint',
    values: ['inline', 'attachment', 'attachment; filename="file.bin"'],
  },
  {
    name: 'Content-Language',
    description: 'Language(s) of the response body',
    values: ['en', 'en-US', 'fr', 'de'],
  },
  {
    name: 'Content-Location',
    description: 'Alternate URL for the returned data',
    values: [],
  },
  {
    name: 'Content-Range',
    description: 'Byte range of a partial content response',
    values: [],
  },
  // ── Security ──────────────────────────────────────────────────────────────
  {
    name: 'Strict-Transport-Security',
    description: 'HSTS: force HTTPS for future requests',
    values: [
      'max-age=31536000',
      'max-age=31536000; includeSubDomains',
      'max-age=31536000; includeSubDomains; preload',
    ],
  },
  {
    name: 'Content-Security-Policy',
    description: 'Restrict sources of content to mitigate XSS',
    values: ["default-src 'self'", "default-src 'self'; script-src 'none'"],
  },
  {
    name: 'X-Content-Type-Options',
    description: 'Prevent MIME-type sniffing',
    values: ['nosniff'],
  },
  {
    name: 'X-Frame-Options',
    description: 'Prevent clickjacking via iframes',
    values: ['DENY', 'SAMEORIGIN'],
  },
  {
    name: 'X-XSS-Protection',
    description: 'Legacy XSS filter hint for older browsers',
    values: ['0', '1', '1; mode=block'],
  },
  {
    name: 'Permissions-Policy',
    description: 'Control browser feature permissions',
    values: ['geolocation=(), microphone=()', 'interest-cohort=()'],
  },
  {
    name: 'Cross-Origin-Opener-Policy',
    description: 'Control browsing context group sharing',
    values: ['same-origin', 'same-origin-allow-popups', 'unsafe-none'],
  },
  {
    name: 'Cross-Origin-Resource-Policy',
    description: 'Control cross-origin resource loading',
    values: ['same-origin', 'same-site', 'cross-origin'],
  },
  {
    name: 'Cross-Origin-Embedder-Policy',
    description: 'Require CORP for sub-resources',
    values: ['require-corp', 'unsafe-none'],
  },
  {
    name: 'DNT',
    description: 'Do Not Track signal',
    values: ['1', '0'],
    reserved: 'browser',
    reservedNote: 'Forbidden in web fetch',
  },
  // ── Cookies ───────────────────────────────────────────────────────────────
  {
    name: 'Set-Cookie',
    description: 'Set an HTTP cookie on the client',
    values: [],
  },
  // ── Server info ───────────────────────────────────────────────────────────
  {
    name: 'Server',
    description: 'Software handling the request',
    values: ['nginx', 'Apache', 'Caddy', 'Kestrel'],
  },
  {
    name: 'X-Powered-By',
    description: 'Technology powering the server',
    values: ['Express', 'Hono', 'Next.js', 'ASP.NET'],
  },
  // ── Distributed tracing (extra) ───────────────────────────────────────────
  {
    name: 'tracestate',
    description: 'W3C Trace Context vendor state',
    values: [],
  },
  {
    name: 'baggage',
    description: 'W3C Baggage propagation header',
    values: [],
  },
  // ── Link / pre-load ───────────────────────────────────────────────────────
  {
    name: 'Link',
    description: 'Related resource links (preload, pagination, canonical)',
    values: ['</api>; rel="preload"', '</next>; rel="next"'],
  },
  // ── Fetch metadata (browser-set, may be forwarded) ───────────────────────
  {
    name: 'Sec-Fetch-Dest',
    description: 'Fetch metadata: destination of the request',
    values: ['empty', 'document', 'fetch', 'image', 'script'],
  },
  {
    name: 'Sec-Fetch-Mode',
    description: 'Fetch metadata: request mode',
    values: ['cors', 'navigate', 'no-cors', 'same-origin'],
  },
  {
    name: 'Sec-Fetch-Site',
    description: 'Fetch metadata: origin relationship',
    values: ['cross-site', 'same-origin', 'same-site', 'none'],
  },
  {
    name: 'Sec-Fetch-User',
    description: 'Fetch metadata: whether triggered by user action',
    values: ['?1'],
  },
  // ── Misc request ─────────────────────────────────────────────────────────
  {
    name: 'Expect',
    description: 'Expected behaviour from the server before sending the body',
    values: ['100-continue'],
  },
  {
    name: 'From',
    description: 'Email of the user controlling the requesting agent',
    values: [],
  },
  {
    name: 'Keep-Alive',
    description: 'Parameters for persistent connections',
    values: ['timeout=5', 'timeout=5, max=1000'],
  },
  // ── Common response headers ───────────────────────────────────────────────
  {
    name: 'Access-Control-Allow-Origin',
    description: 'CORS: allowed origins',
    values: ['*', 'http://app.studio.apicircle.dev', 'https://app.studio.apicircle.dev'],
  },
  {
    name: 'Access-Control-Allow-Methods',
    description: 'CORS: allowed HTTP methods',
    values: ['GET, POST, PUT, DELETE, OPTIONS', 'GET, POST, OPTIONS', '*'],
  },
  {
    name: 'Access-Control-Allow-Headers',
    description: 'CORS: allowed request headers',
    values: ['Content-Type, Authorization', 'Content-Type, Authorization, X-API-Key', '*'],
  },
  {
    name: 'Access-Control-Allow-Credentials',
    description: 'CORS: whether credentials are allowed',
    values: ['true', 'false'],
  },
  {
    name: 'Access-Control-Expose-Headers',
    description: 'CORS: headers exposed to the client',
    values: ['Content-Type, X-Request-ID', 'Authorization'],
  },
  {
    name: 'Access-Control-Max-Age',
    description: 'CORS: how long preflight results can be cached (seconds)',
    values: ['3600', '86400'],
  },
  {
    name: 'Access-Control-Request-Headers',
    description: 'CORS preflight: headers to be included in actual request',
    values: [],
  },
  {
    name: 'Access-Control-Request-Method',
    description: 'CORS preflight: method to be used in actual request',
    values: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  },
  {
    name: 'ETag',
    description: 'Entity tag for cache validation',
    values: [],
  },
  {
    name: 'Location',
    description: 'URL to redirect to',
    values: [],
  },
  {
    name: 'Retry-After',
    description: 'When to retry after 429/503',
    values: ['30', '60', '120'],
  },
  {
    name: 'WWW-Authenticate',
    description: 'Authentication challenge',
    values: ['Basic realm="API"', 'Bearer', 'Digest', 'NTLM'],
  },
  {
    name: 'Proxy-Authenticate',
    description: 'Proxy authentication challenge',
    values: ['Basic realm="Proxy"'],
  },
  {
    name: 'Warning',
    description: 'Advisory about possible problems with the message',
    values: ['110 - "Response is Stale"', '214 - "Transformation Applied"'],
  },
  // ── Reporting ─────────────────────────────────────────────────────────────
  {
    name: 'NEL',
    description: 'Network Error Logging configuration',
    values: [],
  },
  {
    name: 'Report-To',
    description: 'Endpoint for reporting API events',
    values: [],
  },
];

/** Lower-cased name → HeaderEntry lookup. */
const HEADER_MAP = new Map<string, HeaderEntry>(
  HTTP_HEADERS_MAP.map((h) => [h.name.toLowerCase(), h]),
);

/**
 * Headers that are auto-fed at send-time should not appear in suggestions — the
 * user cannot meaningfully set them (they are injected automatically by the app).
 */
const SUGGESTABLE_HEADERS = HTTP_HEADERS_MAP.filter((h) => h.reserved !== 'app').sort((a, b) =>
  a.name.localeCompare(b.name),
);

/**
 * Lower-cased names of headers that meaningfully appear on responses.
 * Drives `mode: 'response'` filtering for `suggestHeaders` — used by the
 * mock response editor so its key autocomplete surfaces only headers a
 * server would realistically set.
 *
 * Mix of two groups:
 *   • Headers that are response-only (Set-Cookie, ETag, Location, etc.).
 *   • Headers that exist on both sides but where the server-side use is
 *     the dominant case (Content-Type, Cache-Control, Vary, etc.).
 */
const RESPONSE_HEADER_NAMES = new Set([
  // Content + caching
  'content-type',
  'content-length',
  'content-encoding',
  'content-disposition',
  'content-language',
  'content-location',
  'cache-control',
  'expires',
  'last-modified',
  'etag',
  'vary',
  'age',
  'pragma',
  // Auth + cookies
  'set-cookie',
  'www-authenticate',
  'proxy-authenticate',
  // Connection / framing
  'server',
  'date',
  'connection',
  'keep-alive',
  'transfer-encoding',
  'upgrade',
  // CORS (response side)
  'access-control-allow-origin',
  'access-control-allow-methods',
  'access-control-allow-headers',
  'access-control-allow-credentials',
  'access-control-expose-headers',
  'access-control-max-age',
  // Redirect + retry
  'location',
  'retry-after',
  'allow',
  // Security
  'strict-transport-security',
  'content-security-policy',
  'x-frame-options',
  'x-content-type-options',
  'referrer-policy',
  'permissions-policy',
  // Observability + reporting
  'nel',
  'report-to',
  'warning',
  // Custom-x catch-alls users frequently set
  'x-request-id',
  'x-correlation-id',
  'x-rate-limit-limit',
  'x-rate-limit-remaining',
  'x-rate-limit-reset',
]);

/** Filtered view of the suggestable headers, scoped to response-side names. */
const SUGGESTABLE_RESPONSE_HEADERS = SUGGESTABLE_HEADERS.filter((h) =>
  RESPONSE_HEADER_NAMES.has(h.name.toLowerCase()),
);

export type HeaderSuggestionMode = 'request' | 'response';

/**
 * Suggest header names by case-insensitive prefix. Empty prefix returns the
 * full suggestable list; auto-fed (`reserved: 'app'`) headers are excluded.
 * An optional `limit` caps the number of filtered (non-empty prefix) results.
 *
 * `mode` filters by whether the header is request- or response-side
 * relevant. Defaults to `'request'` for back-compat with the request
 * editor's existing call sites.
 */
export function suggestHeaders(
  prefix: string,
  limit?: number,
  mode: HeaderSuggestionMode = 'request',
): HeaderEntry[] {
  const source = mode === 'response' ? SUGGESTABLE_RESPONSE_HEADERS : SUGGESTABLE_HEADERS;
  const lower = prefix.toLowerCase().trim();
  if (!lower) return limit !== undefined ? source.slice(0, limit) : source;
  const filtered = source.filter((h) => h.name.toLowerCase().startsWith(lower));
  return limit !== undefined ? filtered.slice(0, limit) : filtered;
}

/**
 * Get the known values for a specific header name (case-insensitive).
 * Returns an empty array when the header has no predefined values (free text).
 */
export function getHeaderValues(headerName: string): string[] {
  return HEADER_MAP.get(headerName.toLowerCase().trim())?.values ?? [];
}

/**
 * Returns the HeaderEntry for an exact name match, or undefined.
 */
export function getHeaderEntry(headerName: string): HeaderEntry | undefined {
  return HEADER_MAP.get(headerName.toLowerCase().trim());
}
