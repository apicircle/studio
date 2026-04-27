import type { Request as ApiRequest } from '@apicircle-v2/shared';
import { buildRequest, type AttachmentResolver } from './buildRequest';

export interface ExecutionResult {
  startedAt: string;
  durationMs: number;
  status: number | null; // null when the request never completed (network error)
  ok: boolean;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  bodyKind: 'json' | 'text' | 'binary' | 'empty';
  error?: string;
  url: string;
  method: string;
}

export interface ExecuteOptions {
  fetchImpl?: typeof fetch;
  // Hard timeout in ms. Defaults to 30s; null disables.
  timeoutMs?: number | null;
  signal?: AbortSignal;
  // Resolver for form-data file rows and binary bodies. Wired to the IDB
  // attachments store on the host side. When omitted, file rows in form-data
  // are skipped and binary bodies send as null.
  resolveAttachment?: AttachmentResolver;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Execute a request through the browser's fetch (or an injected impl for
 * tests). Returns a flat ExecutionResult — never throws for HTTP errors.
 * Network failures and timeouts are captured into result.error with status=null.
 */
export async function executeRequest(
  req: ApiRequest,
  opts: ExecuteOptions = {},
): Promise<ExecutionResult> {
  const built = await buildRequest(req, opts.resolveAttachment);
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const timeoutMs = opts.timeoutMs === undefined ? DEFAULT_TIMEOUT_MS : opts.timeoutMs;

  const startedAt = new Date().toISOString();
  const t0 =
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();

  const controller = new AbortController();
  const externalAbort = () => controller.abort(opts.signal!.reason);
  if (opts.signal) {
    if (opts.signal.aborted) controller.abort(opts.signal.reason);
    else opts.signal.addEventListener('abort', externalAbort, { once: true });
  }
  const timeoutHandle =
    timeoutMs === null
      ? null
      : setTimeout(
          () => controller.abort(new Error(`Request timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );

  try {
    const response = await fetchImpl(built.url, {
      method: built.method,
      headers: built.headers,
      body: built.body,
      signal: controller.signal,
    });
    const headers: Record<string, string> = {};
    response.headers.forEach((v, k) => {
      headers[k] = v;
    });
    const contentType = headers['content-type'] ?? '';
    const text = await response.text();
    const bodyKind: ExecutionResult['bodyKind'] =
      text.length === 0
        ? 'empty'
        : contentType.includes('json') ||
            contentType.includes('xml') ||
            contentType.startsWith('text/')
          ? contentType.includes('json')
            ? 'json'
            : 'text'
          : 'binary';
    const t1 =
      typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();
    return {
      startedAt,
      durationMs: Math.max(0, Math.round(t1 - t0)),
      status: response.status,
      ok: response.ok,
      statusText: response.statusText,
      headers,
      body: text,
      bodyKind,
      url: built.url,
      method: built.method,
    };
  } catch (err) {
    const t1 =
      typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();
    return {
      startedAt,
      durationMs: Math.max(0, Math.round(t1 - t0)),
      status: null,
      ok: false,
      statusText: '',
      headers: {},
      body: '',
      bodyKind: 'empty',
      error: err instanceof Error ? err.message : String(err),
      url: built.url,
      method: built.method,
    };
  } finally {
    if (timeoutHandle !== null) clearTimeout(timeoutHandle);
    if (opts.signal) opts.signal.removeEventListener('abort', externalAbort);
  }
}
