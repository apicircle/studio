// Pre-send validation. Lints a Request against the resolved variable
// scope and returns warnings (non-blocking) and blockers (Send is
// disabled until they're cleared).
//
// Rules — keep them simple, fast, and grounded in the actual request shape:
//   1. Every `{{var}}` reference in URL / headers / query / cookies / body
//      resolves in the active scope. Unresolved → warning.
//   2. Every path placeholder (`{name}` or `:name`) has a non-empty value
//      in `pathParams`. Empty → warning.
//   3. If body type ∈ {json, xml, urlencoded, graphql} but the user-set
//      Content-Type doesn't match the body type, warn.
//   4. If auth.type requires fields (token/key/etc.) and they're blank,
//      block. Without these the request will fail at send-time.
//
// Returns warnings + blockers separately so the UI can render them
// distinctly: warnings are yellow + Send-still-allowed, blockers are
// red + Send-disabled.

import type { Folder, Request as ApiRequest } from '@apicircle/shared';
import { findPathPlaceholders } from './buildRequest';
import { resolveString, type ResolutionScope } from '../environment/variableResolver';
import { resolveInheritedAuth } from './resolveInheritedAuth';

export interface PreSendWarning {
  kind:
    | 'unresolved-variable'
    | 'unbound-path-param'
    | 'content-type-mismatch'
    | 'url-embedded-credentials';
  message: string;
}

export interface PreSendBlocker {
  kind: 'auth-fields-missing' | 'unparseable-url' | 'empty-url';
  message: string;
}

export interface PreSendValidationResult {
  warnings: PreSendWarning[];
  blockers: PreSendBlocker[];
}

/** Inputs to the validator — the request + resolution scope. */
export interface PreSendValidationInput {
  request: ApiRequest;
  scope: ResolutionScope;
  /**
   * Folder map keyed by id. When provided AND the request's `auth.type` is
   * `inherit`, the validator resolves the upward chain via
   * `resolveInheritedAuth` and validates the EFFECTIVE auth's field
   * completeness — so an empty-token folder bearer doesn't slip past the
   * pre-send check. Omit for callers that don't have folder context (legacy
   * tests, ad-hoc plan steps), and the validator falls back to checking the
   * declared auth as-is.
   */
  folders?: Record<string, Folder>;
}

const TYPED_BODY_CT: Record<string, string[]> = {
  json: ['application/json', 'application/ld+json', 'application/vnd.api+json'],
  xml: ['application/xml', 'text/xml'],
  urlencoded: ['application/x-www-form-urlencoded'],
  graphql: ['application/graphql', 'application/json'],
};

function collectMissing(value: string, scope: ResolutionScope): string[] {
  return resolveString(value, scope).missing;
}

export function preSendValidation({
  request,
  scope,
  folders,
}: PreSendValidationInput): PreSendValidationResult {
  const warnings: PreSendWarning[] = [];
  const blockers: PreSendBlocker[] = [];

  // Rule 0: URL is required. Empty URL is always a blocker — without it
  // there is nothing to send. Unparseable URLs (after variable resolution)
  // are also blockers, since the fetch layer would throw on send.
  const urlTrimmed = request.url.trim();
  if (urlTrimmed === '') {
    blockers.push({ kind: 'empty-url', message: 'URL is required.' });
  } else {
    const { value: resolvedUrl, missing: urlMissing } = resolveString(request.url, scope);
    // Only attempt to parse if the URL has no unresolved {{var}} references —
    // otherwise the warning from Rule 1 is the right signal, not a blocker.
    if (urlMissing.length === 0) {
      try {
        // URL constructor throws on malformed input. Accept relative paths
        // (starting with /) since the runtime may be configured with a base.
        if (!resolvedUrl.startsWith('/')) {
          const parsed = new URL(resolvedUrl);
          // Embedded user:pass@host credentials persist into history and
          // get sent on the wire as Basic auth (Chromium converts the
          // userinfo into an `Authorization` header). Warn the user so
          // they can move the credentials into the Auth tab instead,
          // where they go through the Secret Vault and aren't echoed in
          // history records.
          if (parsed.username || parsed.password) {
            warnings.push({
              kind: 'url-embedded-credentials',
              message:
                'URL contains embedded user:pass credentials. These are sent as Basic auth ' +
                'and persisted into request history. Move them to the Auth tab to keep them out of stored runs.',
            });
          }
        }
      } catch {
        blockers.push({
          kind: 'unparseable-url',
          message: `URL "${resolvedUrl}" is not a valid URL.`,
        });
      }
    }
  }

  // Rule 1: unresolved variables in URL / headers / query / cookies / body.
  const unresolved = new Set<string>();
  for (const name of collectMissing(request.url, scope)) unresolved.add(name);
  for (const row of request.headers ?? []) {
    if (!row.enabled) continue;
    for (const n of collectMissing(row.key, scope)) unresolved.add(n);
    for (const n of collectMissing(row.value, scope)) unresolved.add(n);
  }
  for (const row of request.query ?? []) {
    if (!row.enabled) continue;
    for (const n of collectMissing(row.key, scope)) unresolved.add(n);
    for (const n of collectMissing(row.value, scope)) unresolved.add(n);
  }
  for (const row of request.cookies ?? []) {
    if (!row.enabled) continue;
    for (const n of collectMissing(row.key, scope)) unresolved.add(n);
    for (const n of collectMissing(row.value, scope)) unresolved.add(n);
  }
  if (request.body && 'content' in request.body && typeof request.body.content === 'string') {
    for (const n of collectMissing(request.body.content, scope)) unresolved.add(n);
  }
  for (const name of unresolved) {
    warnings.push({
      kind: 'unresolved-variable',
      message: `Variable "${name}" is referenced but not defined in the active scope.`,
    });
  }

  // Rule 2: unbound path placeholders.
  const placeholders = findPathPlaceholders(request.url);
  const pathParams = request.pathParams ?? {};
  for (const name of placeholders) {
    const value = pathParams[name];
    if (value === undefined || value.trim() === '') {
      warnings.push({
        kind: 'unbound-path-param',
        message: `Path parameter "${name}" is empty; the URL segment will collapse.`,
      });
    }
  }

  // Rule 3: Content-Type vs body type alignment (only when user has
  // explicitly set a Content-Type header).
  const userCt = (request.headers ?? [])
    .filter((r) => r.enabled && r.key.trim().toLowerCase() === 'content-type')
    .map((r) => r.value.trim().toLowerCase())[0];
  if (userCt && request.body) {
    const allowed = TYPED_BODY_CT[request.body.type];
    if (allowed && !allowed.some((ct) => userCt.startsWith(ct))) {
      warnings.push({
        kind: 'content-type-mismatch',
        message: `Body type "${request.body.type}" but Content-Type is "${userCt}". This may cause the server to reject the request.`,
      });
    }
  }

  // Rule 4: blank auth fields for types that require them. When the request
  // declares `auth.type === 'inherit'` AND the caller provided `folders`,
  // resolve through the inherit chain so a folder-level bearer with an
  // empty token gets caught here instead of slipping through to fail on the
  // wire. When `folders` is omitted (legacy callers), we fall back to the
  // declared auth — same behavior as before.
  let effectiveAuth = request.auth;
  let resolvedFromInherit = false;
  if (folders && effectiveAuth?.type === 'inherit') {
    effectiveAuth = resolveInheritedAuth({
      requestAuth: { type: 'inherit' },
      folderId: request.folderId,
      folders,
    });
    resolvedFromInherit = true;
  }
  const auth = effectiveAuth;
  const inheritedNote = resolvedFromInherit ? ' (resolved from folder-level auth)' : '';
  if (auth) {
    if (auth.type === 'bearer' && !auth.token?.trim()) {
      blockers.push({
        kind: 'auth-fields-missing',
        message: `Bearer token is empty.${inheritedNote}`,
      });
    } else if (auth.type === 'basic') {
      if (!auth.username?.trim() || !auth.password?.trim()) {
        blockers.push({
          kind: 'auth-fields-missing',
          message: `Basic auth requires both username and password.${inheritedNote}`,
        });
      }
    } else if (auth.type === 'api-key') {
      if (!auth.key?.trim() || !auth.value?.trim()) {
        blockers.push({
          kind: 'auth-fields-missing',
          message: `API key auth requires both name and value.${inheritedNote}`,
        });
      }
    } else if (auth.type === 'custom-header') {
      if (!auth.key?.trim()) {
        blockers.push({
          kind: 'auth-fields-missing',
          message: `Custom header auth requires a header name.${inheritedNote}`,
        });
      }
    }
  }

  return { warnings, blockers };
}
