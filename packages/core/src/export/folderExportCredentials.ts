// Credential detection + opt-in redaction for `apicircle.folder/v1`
// exports.
//
// The export envelope copies `RequestAuth` verbatim from the source
// workspace, which means it can carry live secrets (bearer tokens,
// OAuth2 client secrets / refresh tokens, AWS secret keys, NTLM
// passwords, JWT signing material, …). Letting a user click "Download"
// without confronting them with what's about to leave the workspace is
// the same kind of bug `redactForGit` exists to prevent on the Git path
// — except the export path is a *user-initiated* share, so the right
// model is opt-in inclusion rather than silent redaction.
//
// Two pure helpers below:
//
//   1. `collectFolderExportCredentials(envelope)` — enumerates every
//      credential-bearing field inside the envelope's `folder.auth`,
//      `subfolders[*].auth`, and `requests[*].auth`. Returns one
//      `FolderExportCredential` per field, with a stable composite id
//      the UI can use as a React key and as the index into the
//      include-set.
//
//   2. `redactFolderExportCredentials(envelope, include)` — returns a
//      new envelope with EVERY detected credential blanked, except
//      the ones whose ids appear in `include`. Pure; safe to call on
//      partial envelopes. The default-redact-all semantics match the
//      Modal's UI: every checkbox starts unchecked, so by default the
//      downloaded file carries zero secrets.

import type { RequestAuth } from '@apicircle/shared';
import type { ApicircleFolderExportV1 } from './folderExport';

/**
 * One credential-bearing field discovered inside an export envelope.
 *
 * `id` is a stable composite that survives ordering / re-serialization
 * — UIs can use it as the React key and as the `include` set member.
 *
 * Format:
 *   - Root folder auth:   `folder:<envelope.source.folderId>.<authType>.<field>`
 *   - Subfolder auth:     `folder:<subfolder.id>.<authType>.<field>`
 *   - Request auth:       `request:<request.id>.<authType>.<field>`
 */
export interface FolderExportCredential {
  id: string;
  /** Where the credential lives in the envelope. */
  scope: 'root-folder' | 'subfolder' | 'request';
  /** Discriminator of the auth variant that owns the field. */
  authType: RequestAuth['type'];
  /** Field name on the auth object (e.g. "token", "password", "clientSecret"). */
  field: string;
  /** Human-readable label for the UI ("Bearer · token"). */
  label: string;
  /**
   * Where this credential belongs to. For requests this is the
   * request name; for folders it's the folder name. UIs use this to
   * group rows so the user can see which entity is leaking what.
   */
  ownerName: string;
  /** Source-workspace id of the request/folder that owns this field. */
  ownerId: string;
}

/**
 * Sorted, stable list of every credential-bearing field in the envelope.
 *
 * Determinism: rows are ordered by `(scope-rank, ownerName, field)` so
 * the same envelope always produces the same UI row order. Re-running
 * the detector after the user toggles include-checkboxes returns the
 * same list with the same ids — the UI never needs to remap state.
 *
 * Pure — does not mutate the envelope.
 */
export function collectFolderExportCredentials(
  envelope: ApicircleFolderExportV1,
): FolderExportCredential[] {
  const out: FolderExportCredential[] = [];

  if (envelope.folder.auth) {
    out.push(
      ...authCredentialFields(envelope.folder.auth).map((f) =>
        buildCredential(
          'root-folder',
          envelope.source.folderId,
          envelope.folder.name,
          envelope.folder.auth as RequestAuth,
          f,
        ),
      ),
    );
  }
  for (const sub of envelope.folder.subfolders) {
    if (!sub.auth) continue;
    out.push(
      ...authCredentialFields(sub.auth).map((f) =>
        buildCredential('subfolder', sub.id, sub.name, sub.auth as RequestAuth, f),
      ),
    );
  }
  for (const req of envelope.folder.requests) {
    out.push(
      ...authCredentialFields(req.auth).map((f) =>
        buildCredential('request', req.id, req.name, req.auth, f),
      ),
    );
  }

  return out.sort(credentialCompare);
}

/**
 * Return a new envelope with every credential-bearing field blanked,
 * except for fields whose `id` appears in `includeIds`. The default
 * (empty `includeIds`) redacts everything — that's the safe default
 * the modal uses when the user hasn't explicitly opted any credential
 * in.
 *
 * The redaction shape mirrors `redactForGit`: credential FIELDS go to
 * `''`, identity fields (`clientId`, `username`, `tokenUrl`, …) stay so
 * the importer still knows which IdP the request originally talked to.
 */
export function redactFolderExportCredentials(
  envelope: ApicircleFolderExportV1,
  includeIds: ReadonlySet<string> = new Set(),
): ApicircleFolderExportV1 {
  const next: ApicircleFolderExportV1 = {
    ...envelope,
    folder: {
      ...envelope.folder,
      auth: envelope.folder.auth
        ? redactAuthForScope(
            envelope.folder.auth,
            credentialIdsFor('root-folder', envelope.source.folderId, envelope.folder.auth),
            includeIds,
          )
        : envelope.folder.auth,
      subfolders: envelope.folder.subfolders.map((sub) => {
        if (!sub.auth) return sub;
        const ids = credentialIdsFor('subfolder', sub.id, sub.auth);
        return {
          ...sub,
          auth: redactAuthForScope(sub.auth, ids, includeIds),
        };
      }),
      requests: envelope.folder.requests.map((req) => ({
        ...req,
        auth: redactAuthForScope(
          req.auth,
          credentialIdsFor('request', req.id, req.auth),
          includeIds,
        ),
      })),
    },
  };
  return next;
}

// -- internals --------------------------------------------------------------

interface CredentialFieldDescriptor {
  field: string;
  /** Short variant label used in the UI ("Bearer · token"). */
  label: string;
}

/**
 * Return the credential-bearing fields for a given auth variant. Order
 * matters — the UI renders rows in this order so semantically-related
 * fields stay grouped (e.g. `clientSecret` first, then `accessToken`,
 * then `refreshToken` for OAuth2).
 */
function authCredentialFields(auth: RequestAuth): CredentialFieldDescriptor[] {
  switch (auth.type) {
    case 'none':
    case 'inherit':
    case 'custom-header':
      // `custom-header.value` could be a secret but `redactForGit` also
      // refuses to redact it — users wanting secret semantics should
      // route through Secret Vault + variable interpolation. Same
      // policy here.
      return [];
    case 'basic':
      return [{ field: 'password', label: 'Basic · password' }];
    case 'bearer':
      return auth.token ? [{ field: 'token', label: 'Bearer · token' }] : [];
    case 'api-key':
      return auth.value ? [{ field: 'value', label: 'API key · value' }] : [];
    case 'digest':
      return [{ field: 'password', label: 'Digest · password' }];
    case 'ntlm':
      return [{ field: 'password', label: 'NTLM · password' }];
    case 'hawk':
      return auth.hawkKey ? [{ field: 'hawkKey', label: 'Hawk · hawkKey' }] : [];
    case 'jwt-bearer':
      return [
        ...(auth.secretOrKey ? [{ field: 'secretOrKey', label: 'JWT · secretOrKey' }] : []),
        ...(auth.token ? [{ field: 'token', label: 'JWT · token' }] : []),
      ];
    case 'aws-sigv4':
      return [
        ...(auth.secretAccessKey
          ? [{ field: 'secretAccessKey', label: 'AWS SigV4 · secretAccessKey' }]
          : []),
        ...(auth.sessionToken
          ? [{ field: 'sessionToken', label: 'AWS SigV4 · sessionToken' }]
          : []),
      ];
    case 'oauth2-client-credentials':
    case 'oauth2-auth-code':
    case 'oauth2-pkce':
      return [
        ...(auth.clientSecret
          ? [{ field: 'clientSecret', label: `${auth.type} · clientSecret` }]
          : []),
        ...(auth.accessToken
          ? [{ field: 'accessToken', label: `${auth.type} · accessToken` }]
          : []),
        ...(auth.refreshToken
          ? [{ field: 'refreshToken', label: `${auth.type} · refreshToken` }]
          : []),
      ];
    case 'oauth2-password':
      return [
        ...(auth.clientSecret
          ? [{ field: 'clientSecret', label: 'oauth2-password · clientSecret' }]
          : []),
        ...(auth.password ? [{ field: 'password', label: 'oauth2-password · password' }] : []),
        ...(auth.accessToken
          ? [{ field: 'accessToken', label: 'oauth2-password · accessToken' }]
          : []),
        ...(auth.refreshToken
          ? [{ field: 'refreshToken', label: 'oauth2-password · refreshToken' }]
          : []),
      ];
    case 'oauth2-implicit':
      return auth.accessToken
        ? [{ field: 'accessToken', label: 'oauth2-implicit · accessToken' }]
        : [];
    case 'oauth2-device':
      return [
        ...(auth.accessToken
          ? [{ field: 'accessToken', label: 'oauth2-device · accessToken' }]
          : []),
        ...(auth.refreshToken
          ? [{ field: 'refreshToken', label: 'oauth2-device · refreshToken' }]
          : []),
      ];
    default:
      // Exhaustiveness fallback — same shape as `redactAuthForScope`
      // below. Any synthetic value reaching this arm has no known
      // credential fields, so we surface an empty list.
      return [];
  }
}

function buildCredential(
  scope: FolderExportCredential['scope'],
  ownerId: string,
  ownerName: string,
  auth: RequestAuth,
  desc: CredentialFieldDescriptor,
): FolderExportCredential {
  const prefix = scope === 'request' ? 'request' : 'folder';
  return {
    id: `${prefix}:${ownerId}.${auth.type}.${desc.field}`,
    scope,
    authType: auth.type,
    field: desc.field,
    label: desc.label,
    ownerName,
    ownerId,
  };
}

function credentialIdsFor(
  scope: FolderExportCredential['scope'],
  ownerId: string,
  auth: RequestAuth,
): Map<string, string> {
  const ids = new Map<string, string>(); // field -> id
  const prefix = scope === 'request' ? 'request' : 'folder';
  for (const desc of authCredentialFields(auth)) {
    ids.set(desc.field, `${prefix}:${ownerId}.${auth.type}.${desc.field}`);
  }
  return ids;
}

/**
 * Apply redaction to a single auth value. Any credential field whose
 * id is in `includeIds` is preserved verbatim; the rest are blanked.
 * Variants with no credential fields (`none` / `inherit` / `custom-header`
 * + the unknown-variant default) fall through unchanged.
 */
function redactAuthForScope(
  auth: RequestAuth,
  ids: Map<string, string>,
  includeIds: ReadonlySet<string>,
): RequestAuth {
  const shouldBlank = (field: string): boolean => {
    const id = ids.get(field);
    return !!id && !includeIds.has(id);
  };

  // Spread per-variant so TS keeps each branch's exact shape.
  switch (auth.type) {
    case 'none':
    case 'inherit':
    case 'custom-header':
      return auth;
    case 'basic':
      return shouldBlank('password') ? { ...auth, password: '' } : auth;
    case 'bearer':
      return shouldBlank('token') ? { ...auth, token: '' } : auth;
    case 'api-key':
      return shouldBlank('value') ? { ...auth, value: '' } : auth;
    case 'digest':
      return shouldBlank('password') ? { ...auth, password: '' } : auth;
    case 'ntlm':
      return shouldBlank('password') ? { ...auth, password: '' } : auth;
    case 'hawk':
      return shouldBlank('hawkKey') ? { ...auth, hawkKey: '' } : auth;
    case 'jwt-bearer':
      return {
        ...auth,
        secretOrKey: shouldBlank('secretOrKey') ? '' : auth.secretOrKey,
        token: shouldBlank('token') ? '' : auth.token,
      };
    case 'aws-sigv4':
      return {
        ...auth,
        secretAccessKey: shouldBlank('secretAccessKey') ? '' : auth.secretAccessKey,
        sessionToken: shouldBlank('sessionToken') ? '' : auth.sessionToken,
      };
    case 'oauth2-client-credentials':
    case 'oauth2-auth-code':
    case 'oauth2-pkce':
      return {
        ...auth,
        clientSecret: shouldBlank('clientSecret') ? '' : auth.clientSecret,
        accessToken: shouldBlank('accessToken') ? '' : auth.accessToken,
        refreshToken: shouldBlank('refreshToken') ? '' : auth.refreshToken,
      };
    case 'oauth2-password':
      return {
        ...auth,
        clientSecret: shouldBlank('clientSecret') ? '' : auth.clientSecret,
        password: shouldBlank('password') ? '' : auth.password,
        accessToken: shouldBlank('accessToken') ? '' : auth.accessToken,
        refreshToken: shouldBlank('refreshToken') ? '' : auth.refreshToken,
      };
    case 'oauth2-implicit':
      return {
        ...auth,
        accessToken: shouldBlank('accessToken') ? '' : auth.accessToken,
      };
    case 'oauth2-device':
      return {
        ...auth,
        accessToken: shouldBlank('accessToken') ? '' : auth.accessToken,
        refreshToken: shouldBlank('refreshToken') ? '' : auth.refreshToken,
      };
    default:
      // The discriminated union above is exhaustive. An unknown-variant
      // value can only reach this arm via a deliberate cast (e.g. a
      // future auth type added without wiring this switch); we return
      // it unchanged rather than throwing so the export still produces
      // a valid envelope.
      return auth;
  }
}

function scopeRank(scope: FolderExportCredential['scope']): number {
  if (scope === 'root-folder') return 0;
  if (scope === 'subfolder') return 1;
  return 2;
}

function credentialCompare(a: FolderExportCredential, b: FolderExportCredential): number {
  const r = scopeRank(a.scope) - scopeRank(b.scope);
  if (r !== 0) return r;
  // Tiebreak by owner name only — within a single owner we rely on
  // JS's stable Array.prototype.sort to preserve the per-variant field
  // order from `authCredentialFields` (which puts e.g. clientSecret →
  // accessToken → refreshToken in semantic order).
  return a.ownerName.localeCompare(b.ownerName, undefined, { sensitivity: 'base' });
}
