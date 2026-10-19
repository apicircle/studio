import type { RequestRun } from '@apicircle/shared';
import { RUN_HIDDEN_VALUE } from '@apicircle/shared';
import { isCredentialName, secretValueReason, stripUrlCredentials } from '../git/secretShapes';

// =============================================================================
// Hide secrets in a RequestRun before it is stored.
//
// History lives in `WorkspaceLocal` — IndexedDB and the plain-JSON disk mirror
// (`~/.apicircle/workspace-<id>/workspace.local.json`) — which any process of
// the user can read. A run records the resolved request, so without this step
// a token from an encrypted variable or a Secret Vault slot would sit there in
// plain text, as would a token a server returned.
//
// The live response the user is looking at is untouched; only the stored copy
// is. What is hidden, each replaced by `RUN_HIDDEN_VALUE`:
//
//   - a header value (request or response) whose header is named like a
//     credential (`Authorization`, `Cookie`, `Set-Cookie`, `X-API-Key`, …),
//     that holds one of the run's known secrets, or that has the shape of a
//     credential (a JWT, a GitHub token, a random-looking key). The header's
//     name is kept.
//   - any known secret inside the URL or a body preview.
//   - a URL query value, a JSON string value or a form-encoded value whose
//     name is a credential's, or whose value has a credential's shape.
//
// A URL's `user:pass@` is removed outright, as the push path does.
//
// "Known secrets" are the plaintext values the caller resolved from encrypted
// environment variables and Secret Vault slots for this send.
// =============================================================================

/** A known secret shorter than this is only hidden where it is a whole value:
 *  replacing every occurrence of `"ab"` would mangle the text around it. */
const MIN_SUBSTRING_SECRET_LENGTH = 4;

/** `"name": "value"` in JSON text, string values only. Each alternative of a
 *  string body is disjoint, so a match attempt is linear in what it reads. */
const JSON_STRING_FIELD = /"((?:[^"\\]|\\.)*)"(\s*:\s*)"((?:[^"\\]|\\.)*)"/g;

/** A whole body in `application/x-www-form-urlencoded` shape. */
const FORM_ENCODED = /^[^\s=&]+=[^\s&]*(?:&[^\s=&]+=[^\s&]*)*$/;

function tryDecode(text: string): string {
  try {
    return decodeURIComponent(text.replace(/\+/g, ' '));
  } catch {
    return text;
  }
}

function jsonUnescape(text: string): string {
  try {
    return JSON.parse(`"${text}"`) as string;
  } catch {
    return text;
  }
}

/** Prepared known secrets: exact values, and the spellings to cut out of text. */
interface KnownSecrets {
  exact: ReadonlySet<string>;
  /** Longest first, so a secret that contains another is cut whole. */
  substrings: readonly string[];
}

function prepare(secrets: readonly string[]): KnownSecrets {
  const exact = new Set<string>();
  const substrings = new Set<string>();
  for (const secret of secrets) {
    if (secret.trim().length === 0) continue;
    exact.add(secret);
    if (secret.length < MIN_SUBSTRING_SECRET_LENGTH) continue;
    // As written, as a URL carries it, and as JSON text carries it.
    substrings.add(secret);
    substrings.add(encodeURIComponent(secret));
    substrings.add(JSON.stringify(secret).slice(1, -1));
  }
  return { exact, substrings: [...substrings].sort((a, b) => b.length - a.length) };
}

function holdsKnownSecret(value: string, known: KnownSecrets): boolean {
  return known.exact.has(value) || known.substrings.some((s) => value.includes(s));
}

function cutKnownSecrets(text: string, known: KnownSecrets): string {
  let out = text;
  for (const s of known.substrings) out = out.split(s).join(RUN_HIDDEN_VALUE);
  return out;
}

/** Whether a `name: value` pair must not be stored. */
function isSecretPair(name: string, value: string, known: KnownSecrets): boolean {
  if (value.length === 0 || value === RUN_HIDDEN_VALUE) return false;
  return (
    isCredentialName(name) || holdsKnownSecret(value, known) || secretValueReason(value) !== null
  );
}

function hideHeaders(headers: Record<string, string>, known: KnownSecrets): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    out[name] = isSecretPair(name, value, known) ? RUN_HIDDEN_VALUE : value;
  }
  return out;
}

/** `a=1&b=2` with every secret pair's value replaced; separators kept. */
function hideFormPairs(text: string, known: KnownSecrets): string {
  return text
    .split('&')
    .map((segment) => {
      const eq = segment.indexOf('=');
      if (eq < 0) return segment;
      const name = tryDecode(segment.slice(0, eq));
      const value = tryDecode(segment.slice(eq + 1));
      return isSecretPair(name, value, known)
        ? `${segment.slice(0, eq + 1)}${RUN_HIDDEN_VALUE}`
        : segment;
    })
    .join('&');
}

function hideUrl(url: string, known: KnownSecrets): string {
  const cut = cutKnownSecrets(stripUrlCredentials(url), known);
  const q = cut.indexOf('?');
  if (q < 0) return cut;
  const hash = cut.indexOf('#', q);
  const end = hash < 0 ? cut.length : hash;
  return cut.slice(0, q + 1) + hideFormPairs(cut.slice(q + 1, end), known) + cut.slice(end);
}

function hideBody(text: string, known: KnownSecrets): string {
  const cut = cutKnownSecrets(text, known);
  const json = cut.replace(
    JSON_STRING_FIELD,
    (match, rawName: string, colon: string, rawValue: string) =>
      isSecretPair(jsonUnescape(rawName), jsonUnescape(rawValue), known)
        ? `"${rawName}"${colon}"${RUN_HIDDEN_VALUE}"`
        : match,
  );
  return FORM_ENCODED.test(json.trim()) ? hideFormPairs(json, known) : json;
}

/**
 * `run` with its secrets hidden (see the module header). `secrets` are the
 * plaintext values resolved from encrypted variables and Secret Vault slots
 * for this send. Sets `secretsHidden` when anything changed; returns `run`
 * itself when nothing did.
 */
export function hideRunSecrets(run: RequestRun, secrets: readonly string[] = []): RequestRun {
  const known = prepare(secrets);
  const next: RequestRun = {
    ...run,
    url: hideUrl(run.url, known),
    requestHeaders: hideHeaders(run.requestHeaders, known),
    requestBodyPreview:
      run.requestBodyPreview === null ? null : hideBody(run.requestBodyPreview, known),
    responseHeaders: hideHeaders(run.responseHeaders, known),
    responseBodyPreview: hideBody(run.responseBodyPreview, known),
  };
  const changed =
    next.url !== run.url ||
    next.requestBodyPreview !== run.requestBodyPreview ||
    next.responseBodyPreview !== run.responseBodyPreview ||
    Object.entries(next.requestHeaders).some(([k, v]) => run.requestHeaders[k] !== v) ||
    Object.entries(next.responseHeaders).some(([k, v]) => run.responseHeaders[k] !== v);
  return changed ? { ...next, secretsHidden: true } : run;
}
