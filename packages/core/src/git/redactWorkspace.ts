// Redact secret-bearing fields from a `WorkspaceSynced` before it goes to
// Git. The pushed `workspace.json` is visible to every collaborator (and to
// the world on public repos), so it CANNOT carry passwords, bearer tokens,
// client secrets, AWS keys, Hawk keys, JWT signing keys, OAuth2 refresh
// tokens — none of it.
//
// Design:
//
//   1. `redactForGit(synced)` walks every Request.auth and returns a copy
//      with the credential-bearing fields blanked to `''`. Identity
//      fields (clientId, username, tokenUrl, authUrl, etc.) are kept —
//      they're not secrets and consumers need them to know which IdP to
//      talk to.
//
//   2. `assertNoPlaintextCredentials(serialized)` is a fail-closed lint
//      pass over the already-serialised JSON. If any credential-only
//      field name appears with a non-empty value, push is refused.
//      Defends against:
//        - a future RequestAuth variant we forget to wire into redactForGit
//        - a future workspace-state field that ends up carrying secrets
//        - any path that bypasses redactForGit by mistake
//
// Pre-launch tradeoff: we accept that pulling from git will surface
// requests with blank credentials. The user re-supplies them from the
// Secret Vault locally. A future Phase 8 follow-up will introduce a
// `{{!SECRET:<id>}}` placeholder system so the vault auto-fills on pull.

import type { RequestAuth, WorkspaceSynced } from '@apicircle/shared';

/** Field names that ALWAYS carry a credential when non-empty. Used by the
 *  serialised-output lint pass below. Names like `value`, `token` (in
 *  `JwtBearerAuth.token` it's a pre-computed JWT — also a credential) and
 *  `key` are deliberately NOT in this list because they appear in many
 *  non-credential contexts (header rows, secret-vault metadata, etc.); the
 *  redactor takes care of those structurally rather than by regex. */
const PLAINTEXT_CREDENTIAL_FIELD_NAMES = [
  'password',
  'clientSecret',
  'secretAccessKey',
  'sessionToken',
  'refreshToken',
  'accessToken',
  'hawkKey',
  'secretOrKey',
] as const;

/**
 * Return a copy of `synced` with every credential-bearing field in every
 * Request.auth blanked to ''. Identity fields are preserved. Pure — does
 * not mutate the input. Safe to call on partially-shaped workspaces.
 */
export function redactForGit(synced: WorkspaceSynced): WorkspaceSynced {
  const requests: WorkspaceSynced['collections']['requests'] = {};
  for (const [id, req] of Object.entries(synced.collections.requests)) {
    requests[id] = { ...req, auth: redactAuth(req.auth) };
  }
  // Folders carry auth too (folder-level auth inheritance). Redact those.
  const folders: WorkspaceSynced['collections']['folders'] = {};
  for (const [id, folder] of Object.entries(synced.collections.folders)) {
    folders[id] = folder.auth ? { ...folder, auth: redactAuth(folder.auth) } : { ...folder };
  }
  return {
    ...synced,
    collections: { ...synced.collections, requests, folders },
  };
}

function redactAuth(auth: RequestAuth): RequestAuth {
  switch (auth.type) {
    case 'none':
    case 'inherit':
    case 'custom-header':
      // Custom header `value` is user-typed text — could be a secret but
      // the redactor can't know. Users wanting secret semantics should
      // use the Secret Vault + variable interpolation. Same applies to
      // api-key.value below.
      return auth;
    case 'basic':
      return { ...auth, password: '' };
    case 'bearer':
      return { ...auth, token: '' };
    case 'api-key':
      // api-key.value is the credential. Blank it.
      return { ...auth, value: '' };
    case 'digest':
    case 'ntlm':
      return { ...auth, password: '' };
    case 'hawk':
      return { ...auth, hawkKey: '' };
    case 'jwt-bearer':
      // Blank both the signing key AND the pre-computed token — both are
      // credential material (the token is what's actually sent on the
      // wire; the key lets you mint more of them).
      return { ...auth, secretOrKey: '', token: '' };
    case 'aws-sigv4':
      return { ...auth, secretAccessKey: '', sessionToken: '' };
    case 'oauth2-client-credentials':
    case 'oauth2-auth-code':
    case 'oauth2-pkce':
      return { ...auth, clientSecret: '', accessToken: '', refreshToken: '' };
    case 'oauth2-password':
      return { ...auth, clientSecret: '', password: '', accessToken: '', refreshToken: '' };
    case 'oauth2-implicit':
      // Implicit grant has no clientSecret + no refreshToken in the type.
      return { ...auth, accessToken: '' };
    case 'oauth2-device':
      // Device flow is public-client by design — no clientSecret in the
      // type. Just blank the tokens.
      return { ...auth, accessToken: '', refreshToken: '' };
    default: {
      // Exhaustiveness check — if a new auth variant is added without a
      // case here, TypeScript flags the assignment below.
      const _exhaustive: never = auth;
      void _exhaustive;
      return auth;
    }
  }
}

/**
 * Scan the already-serialised workspace JSON for any credential-only
 * field name with a non-empty value. Throws if found — the push path
 * should treat the throw as fatal (refuse to upload).
 *
 * The match is intentionally narrow: only the names in
 * `PLAINTEXT_CREDENTIAL_FIELD_NAMES`, only with a NON-EMPTY string value.
 * An empty-string credential (`"password":""`) is acceptable — that's
 * what `redactForGit` produces.
 *
 * Implementation note: we use a regex rather than walking the parsed
 * tree because (a) the input has already been serialised, and (b) the
 * regex catches every nesting level without us having to know the shape.
 * The risk of false positives is bounded because the field names are
 * specific (no `value` / `token` / `key` in the list).
 */
export function assertNoPlaintextCredentials(serialized: string): void {
  for (const name of PLAINTEXT_CREDENTIAL_FIELD_NAMES) {
    // `"name":"<at least one char that isn't a closing quote>"`
    // We allow any chars in the value (incl. escaped) — the test is
    // "is the value non-empty?". A zero-length value (`""`) doesn't match.
    const re = new RegExp(`"${name}"\\s*:\\s*"(?:[^"\\\\]|\\\\.)+"`);
    const match = re.exec(serialized);
    if (match) {
      throw new Error(
        `Refusing to push workspace.json: credential field "${name}" carries a non-empty value. ` +
          `This is a redaction bug — every plaintext credential MUST be blanked before serialisation.`,
      );
    }
  }
}
