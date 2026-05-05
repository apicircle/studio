/**
 * Auto-fed request headers — platform-specific, non-editable, not stored.
 *
 * These headers are injected at send-time by the execution engine:
 *   • They are NEVER written to IndexedDB or Git remote.
 *   • A new X-Trace-Span-Id and traceparent are generated for every send.
 *   • They do NOT appear in the user-visible "Headers" editor tab — the
 *     HeadersTab "Auto-fed at send" aside lists them for reference only.
 *
 * User-set headers always win: if the user typed `X-Client-Version` into the
 * Headers tab, the auto value is suppressed.
 */

import { isDesktop } from './platformDetection';

const APP_VERSION = '0.1.0'; // Keep in sync with package.json `version`.
const APP_NAME = 'APICircle Studio';

/** Canonical desktop origin used in requests (also used by the native HTTP layer). */
export const DESKTOP_APP_ORIGIN = 'http://app.studio.apicircle.dev';

/**
 * Generate a random hex span-id (16 hex chars = 64 bits, compatible with
 * W3C Trace Context `traceparent` and OpenTelemetry span-id format).
 */
export function generateSpanId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Generate a W3C traceparent header value.
 * Format: 00-<trace-id (32 hex)>-<span-id (16 hex)>-01
 */
export function generateTraceParent(): string {
  const traceId = Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const spanId = generateSpanId();
  return `00-${traceId}-${spanId}-01`;
}

/**
 * Override hooks for tests — let test code feed deterministic values
 * for span-id / traceparent / platform without monkey-patching `crypto`.
 * Production code never passes these.
 */
export interface AutoHeaderOverrides {
  spanId?: string;
  traceparent?: string;
  platform?: 'desktop' | 'web';
  version?: string;
  name?: string;
}

/**
 * Returns the set of auto-fed headers for a single request execution.
 * Call this once per send — `X-Trace-Span-Id` and `traceparent` are
 * re-generated on every invocation.
 *
 * @param userHeaders The headers the user has configured so auto-headers
 *   do NOT override anything the user has explicitly set.
 * @param overrides Test-only override hooks; never set in production.
 */
export function buildAutoHeaders(
  userHeaders: Record<string, string>,
  overrides: AutoHeaderOverrides = {},
): Record<string, string> {
  const auto: Record<string, string> = {};
  const userLower = Object.fromEntries(
    Object.keys(userHeaders).map((k) => [k.toLowerCase(), true]),
  );

  // ── Platform identity ─────────────────────────────────────────────────────
  if (!userLower['x-client-name']) {
    auto['X-Client-Name'] = overrides.name ?? APP_NAME;
  }
  if (!userLower['x-client-platform']) {
    auto['X-Client-Platform'] = overrides.platform ?? (isDesktop() ? 'desktop' : 'web');
  }
  if (!userLower['x-client-version']) {
    auto['X-Client-Version'] = overrides.version ?? APP_VERSION;
  }

  // ── Distributed tracing (auto-generated per send) ─────────────────────────
  // Always generate fresh — never reuse a stored value.
  auto['X-Trace-Span-Id'] = overrides.spanId ?? generateSpanId();
  if (!userLower['traceparent']) {
    auto['traceparent'] = overrides.traceparent ?? generateTraceParent();
  }

  // ── Origin / Referer (desktop only — the native HTTP layer also injects
  //    these, but we set them here so the request preview shows accurate
  //    values) ─────────────────────────────────────────────────────────────
  const platform = overrides.platform ?? (isDesktop() ? 'desktop' : 'web');
  if (platform === 'desktop') {
    if (!userLower['origin']) {
      auto['Origin'] = DESKTOP_APP_ORIGIN;
    }
    if (!userLower['referer']) {
      auto['Referer'] = `${DESKTOP_APP_ORIGIN}/`;
    }
  }

  return auto;
}

/**
 * Merge auto-headers into user headers. User-defined values always win —
 * auto-headers only fill gaps.
 */
export function mergeWithAutoHeaders(
  userHeaders: Record<string, string>,
  overrides: AutoHeaderOverrides = {},
): Record<string, string> {
  return { ...buildAutoHeaders(userHeaders, overrides), ...userHeaders };
}
