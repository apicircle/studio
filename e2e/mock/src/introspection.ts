// Captures every request the mock server receives so e2e tests can
// assert against the *actual wire shape* (parsed body, headers, query,
// cookies, etc.) instead of relying on browser-side observation. Two
// endpoints expose the buffer:
//
//   GET    /__inspect/last?n=1   → last n captured requests, newest first
//   DELETE /__inspect            → clears the buffer (tests call this in
//                                  `beforeEach` to isolate runs)
//
// The buffer is bounded — older entries drop off when capacity is hit so
// a misbehaving spec can't explode memory.

import type { Context, MiddlewareHandler } from 'hono';

export interface CapturedRequest {
  /** Wall-clock time of capture, ISO8601. */
  capturedAt: string;
  method: string;
  /** Full request URL as the server saw it (path + querystring). */
  url: string;
  /** Just the pathname for quick filtering. */
  path: string;
  /** Querystring decoded into key→value pairs. Repeats keys append `,`. */
  query: Record<string, string>;
  /** Lowercased header names (HTTP is case-insensitive). */
  headers: Record<string, string>;
  /** Parsed Cookie header into key→value (empty when no cookies). */
  cookies: Record<string, string>;
  /**
   * Body shape — { kind: 'text' | 'json' | 'form' | 'multipart' | 'binary' | 'empty' }.
   * For `binary`, only byte length is captured to keep the buffer bounded.
   */
  body: CapturedBody;
}

export type CapturedBody =
  | { kind: 'empty' }
  | { kind: 'text'; text: string }
  | { kind: 'json'; json: unknown }
  | { kind: 'form'; form: Record<string, string> }
  | { kind: 'multipart'; parts: CapturedMultipartPart[] }
  | { kind: 'binary'; bytes: number };

export interface CapturedMultipartPart {
  name: string;
  filename?: string;
  contentType?: string;
  /** For text parts. Files just record byte length. */
  text?: string;
  bytes?: number;
}

/** Bounded ring buffer. */
export class RequestCapture {
  private buf: CapturedRequest[] = [];
  constructor(private readonly capacity = 200) {}

  push(entry: CapturedRequest): void {
    this.buf.push(entry);
    if (this.buf.length > this.capacity) this.buf.shift();
  }

  /** Last N entries, newest first. N=0 returns all. */
  last(n: number): CapturedRequest[] {
    if (n <= 0) return [...this.buf].reverse();
    return this.buf.slice(-n).reverse();
  }

  clear(): void {
    this.buf = [];
  }

  size(): number {
    return this.buf.length;
  }
}

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const pair of header.split(';')) {
    const idx = pair.indexOf('=');
    if (idx < 0) continue;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

async function readBody(c: Context): Promise<CapturedBody> {
  const ct = c.req.header('content-type') ?? '';
  // Empty body — Content-Length:0 or no content-type.
  const contentLength = c.req.header('content-length');
  if (
    contentLength === '0' ||
    (!ct && c.req.method !== 'POST' && c.req.method !== 'PUT' && c.req.method !== 'PATCH')
  ) {
    // Need to drain anyway in case the body is present but not declared.
    try {
      const buf = await c.req.arrayBuffer();
      if (buf.byteLength === 0) return { kind: 'empty' };
      // Fall through with the buffer.
      const text = new TextDecoder().decode(buf);
      return text.length > 0 ? { kind: 'text', text } : { kind: 'empty' };
    } catch {
      return { kind: 'empty' };
    }
  }

  if (ct.includes('application/json')) {
    try {
      return { kind: 'json', json: await c.req.json() };
    } catch {
      // Malformed JSON — capture as text so tests can still assert on it.
      const text = await c.req.text();
      return { kind: 'text', text };
    }
  }

  if (ct.includes('application/x-www-form-urlencoded')) {
    const form: Record<string, string> = {};
    try {
      const parsed = await c.req.parseBody();
      // Hono's parseBody return type is `Record<string, unknown>`; we
      // only echo the textual representation. File entries surface as
      // their filename (the closest stable string handle); arrays
      // collapse to a JSON array of the same.
      for (const [k, v] of Object.entries(parsed) as Array<[string, unknown]>) {
        if (typeof v === 'string') {
          form[k] = v;
        } else if (v instanceof File) {
          form[k] = v.name;
        } else if (Array.isArray(v)) {
          const entries = v as ReadonlyArray<unknown>;
          form[k] = JSON.stringify(
            entries.map((entry) =>
              typeof entry === 'string' ? entry : entry instanceof File ? entry.name : '',
            ),
          );
        } else {
          form[k] = JSON.stringify(v);
        }
      }
    } catch {
      /* leave empty */
    }
    return { kind: 'form', form };
  }

  if (ct.includes('multipart/form-data')) {
    const parts: CapturedMultipartPart[] = [];
    try {
      const formData = await c.req.formData();
      for (const [name, value] of formData.entries()) {
        if (typeof value === 'string') {
          parts.push({ name, text: value });
        } else {
          // It's a File / Blob.
          parts.push({
            name,
            filename: value.name,
            contentType: value.type || undefined,
            bytes: value.size,
          });
        }
      }
    } catch {
      /* leave empty */
    }
    return { kind: 'multipart', parts };
  }

  if (ct.startsWith('text/') || ct.includes('xml') || ct.includes('graphql')) {
    const text = await c.req.text();
    return { kind: 'text', text };
  }

  // Default: treat as binary, just record size.
  try {
    const buf = await c.req.arrayBuffer();
    return buf.byteLength === 0 ? { kind: 'empty' } : { kind: 'binary', bytes: buf.byteLength };
  } catch {
    return { kind: 'empty' };
  }
}

export function captureMiddleware(capture: RequestCapture): MiddlewareHandler {
  return async (c, next) => {
    // Skip introspection endpoints themselves to avoid recursive captures.
    if (c.req.path.startsWith('/__inspect') || c.req.path === '/__health') {
      return next();
    }

    const url = new URL(c.req.url);
    const query: Record<string, string> = {};
    for (const [k, v] of url.searchParams.entries()) {
      // If multiple values for same key, comma-join.
      query[k] = query[k] ? `${query[k]},${v}` : v;
    }

    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(c.req.header())) {
      headers[k.toLowerCase()] = v;
    }

    const cookies = parseCookies(c.req.header('cookie'));

    // Body parsing is destructive, so we read here, then attach the parsed
    // shape to the context so route handlers can re-read without needing
    // to consume the stream again.
    const body = await readBody(c);

    capture.push({
      capturedAt: new Date().toISOString(),
      method: c.req.method,
      url: c.req.url,
      path: url.pathname,
      query,
      headers,
      cookies,
      body,
    });

    // Stash the parsed body so route handlers can use it.
    c.set('capturedBody', body);

    await next();
  };
}

declare module 'hono' {
  interface ContextVariableMap {
    capturedBody?: CapturedBody;
  }
}
