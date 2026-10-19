import type { ContextExtraction } from '@apicircle/shared';
import { carriesLiteral, isCredentialName, secretRowReason } from '../git/secretShapes';

// =============================================================================
// Extracted values that look like credentials.
//
// A response extractor captures a value for later requests — most often the
// token a login returns. Captured values are kept in `WorkspaceLocal.
// globalContext`, which is saved to IndexedDB and to the plain-JSON disk mirror
// (`~/.apicircle/workspaces/<id>/workspace.local.json`) that any process of the
// user can read. So a value that looks like a credential is never saved there:
// it is held in memory, used by the requests that follow, and forgotten when
// the app closes. `extractContext` sorts every capture with
// `extractedSecretReason`; the rules are the ones History and the push path
// use (`git/secretShapes`).
// =============================================================================

/** A captured value held in memory, and why it is not saved. */
export interface HeldContextValue {
  value: string;
  /** Why the value looks like a credential, e.g. "named like a credential". */
  reason: string;
}

/** A known secret shorter than this only counts where it is the whole value,
 *  as in `hideRunSecrets`: two characters match far too much text. */
const MIN_SUBSTRING_SECRET_LENGTH = 4;

const SOURCE_NOUN: Record<Exclude<ContextExtraction['source'], 'status'>, string> = {
  body: 'field',
  header: 'header',
  cookie: 'cookie',
};

/** The last key of a body JSON path (`data.access_token` → `access_token`,
 *  `items[0].id` → `id`), read as `readJsonPath` reads the path. */
function pathLeaf(path: string): string {
  const keys = path
    .trim()
    .replace(/^\$\.?/, '')
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter((key) => key.length > 0 && !/^\d+$/.test(key));
  return keys[keys.length - 1] ?? '';
}

function holdsKnownSecret(value: string, knownSecrets: readonly string[]): boolean {
  return knownSecrets.some(
    (secret) =>
      secret.length > 0 &&
      (value === secret ||
        (secret.length >= MIN_SUBSTRING_SECRET_LENGTH && value.includes(secret))),
  );
}

/**
 * Why a captured value must be held in memory rather than saved, or `null`
 * when it may be saved. Held when:
 *
 *   - it contains a secret the request that produced it sent (`knownSecrets`:
 *     the plaintexts that send decrypted, and the values already held);
 *   - the variable is named like a credential, or the value has a
 *     credential's shape (a JWT, a GitHub token, a random-looking key);
 *   - the header, the cookie, or the last key of the JSON path it was read
 *     from is named like a credential, and the value is a real one (not a
 *     number, a boolean or a placeholder).
 *
 * A status code is never held.
 */
export function extractedSecretReason(
  extraction: Pick<ContextExtraction, 'variable' | 'source' | 'path'>,
  value: string,
  knownSecrets: readonly string[] = [],
): string | null {
  if (extraction.source === 'status') return null;
  if (holdsKnownSecret(value, knownSecrets)) return 'holds a secret this request sent';
  const byVariable = secretRowReason(extraction.variable.trim(), value);
  if (byVariable) return byVariable;
  const sourceName =
    extraction.source === 'body' ? pathLeaf(extraction.path) : extraction.path.trim();
  if (sourceName && isCredentialName(sourceName) && carriesLiteral(value)) {
    return `read from a ${SOURCE_NOUN[extraction.source]} named like a credential`;
  }
  return null;
}

/**
 * `globalContext` without the entries that look like credentials, judged by
 * name and value. Applied where a saved `globalContext` is loaded, so a value
 * saved by an older build — or written by another tool — is not kept.
 */
export function savedContextOnly(
  globalContext: Readonly<Record<string, string>>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(globalContext)) {
    if (secretRowReason(key, value) === null) out[key] = value;
  }
  return out;
}
