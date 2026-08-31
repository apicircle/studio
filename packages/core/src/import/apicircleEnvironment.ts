// Importer for the `apicircleEnvironment: 1 | 2` JSON envelope produced by
// `exportEnvironment` in `../../../ui-components/src/store/envActions.ts`
// (and by Lens-owned MCP/CLI export flows). Sister parser to
// `./apicircleFolder.ts` — same surface, different document.
//
// Shape (v2 — current, matches Git push/pull) — encrypted rows carry their
// ciphertext + the per-slot salt so the destination can attempt the same
// decrypt the request-execute path would (derive a key from the LOCAL slot
// plaintext + the SOURCE salt, then AES-GCM unwrap):
//
//   {
//     "apicircleEnvironment": 2,
//     "name": "dev",
//     "variables": [
//       { "key": "API_BASE", "value": "https://api.example.com", "encrypted": false },
//       {
//         "key": "TOKEN",
//         "encrypted": true,
//         "value": "enc:v1:<iv>:<ciphertext>",
//         "secretKeyId": "sec_abc",
//         "secret": { "label": "PROD_TOKEN", "salt": "base64salt==" }
//       }
//     ]
//   }
//
// Shape (v1 — legacy, surface-only) — encrypted rows carry slot METADATA
// but not the ciphertext or salt, so the destination must prompt the user
// for a plaintext value during import. Still supported so existing exports
// continue to import without surprise:
//
//   {
//     "apicircleEnvironment": 1,
//     "name": "dev",
//     "variables": [
//       { "key": "TOKEN", "encrypted": true, "secretKeyId": "sec_abc", "secret": { "label": "PROD_TOKEN" } }
//     ]
//   }
//
// Plain rows round-trip in full in both versions. Encrypted rows surface an
// `encryptedBindingHint` so the caller can match against the destination's
// vault. v2 hints additionally carry `ciphertext` + `salt` so the importer
// can land the encrypted row directly; v1 hints fall back to the prompt-the-
// user-for-value path.

import type { EnvironmentVariable } from '@apicircle/shared';

export interface ParsedApicircleEnvironment {
  name: string;
  /**
   * The variables that should land in the destination env, in the same
   * order as the source. Encrypted rows arrive with the SOURCE'S
   * `secretKeyId`; the caller is responsible for re-pointing the binding
   * to a destination-local slot id (or leaving it dangling until the user
   * fixes it).
   *
   * In v2, encrypted rows arrive with their ciphertext intact in `value`;
   * the importer can choose to land it as-is so the request-execute path
   * decrypts naturally when the user provides the matching slot value.
   * In v1, encrypted rows arrive with `value: ''` and the importer must
   * surface a pendingBinding for the user to type a fresh plaintext.
   */
  variables: EnvironmentVariable[];
  /**
   * Per encrypted row, the slot metadata the export carried. The store
   * action uses this to (a) reuse an existing destination slot by label
   * match, (b) reuse by `originSecretKeyId` for same-workspace re-imports,
   * or (c) surface a pendingBinding so the UI can prompt the user.
   * Indices line up with `variables` for the corresponding row only —
   * plain rows do not appear here.
   */
  encryptedBindingHints: EncryptedBindingHint[];
  /**
   * The envelope version the export advertised — `1` (label-only, prompt
   * user for value) or `2` (ciphertext + salt carry, attempt decrypt with
   * local slot value). Importers fork on this to decide whether to land
   * the ciphertext or surface a pendingBinding.
   */
  payloadVersion: 1 | 2;
  /**
   * Soft notes the parser surfaced about the import — dropped rows,
   * demoted encrypted rows, etc. Importers forward these to the UI as
   * warnings.
   */
  warnings: string[];
}

export interface EncryptedBindingHint {
  /** The var the hint belongs to (matches the row's `key`). */
  varKey: string;
  /**
   * The slot's display label from the source workspace. Older exports
   * (before `secret.label` shipped) didn't carry this; the parser falls
   * back to `varKey` so the UI always has SOMETHING to render.
   */
  label: string;
  /**
   * The slot id the source workspace bound to. Useful for round-tripping
   * inside the same workspace (the destination's slot id matches), but
   * meaningless on a different machine. Optional — newer exports may
   * stop carrying it once enough time passes.
   */
  originSecretKeyId?: string;
  /** `true` when the export carried no `secret.label` and the label was synthesized. */
  labelFromFallback: boolean;
  /**
   * v2 only: the source's ciphertext (`enc:v1:<iv>:<base64>`) so the
   * destination can land an encrypted row whose value the user can
   * decrypt by providing the matching slot plaintext. `null` on v1 — the
   * caller must instead prompt the user for a plaintext value and
   * re-encrypt locally.
   */
  ciphertext: string | null;
  /**
   * v2 only: the source slot's salt (base64). Required to derive the same
   * AES-GCM key the source used. `null` on v1.
   */
  salt: string | null;
}

interface ApicircleEnvDoc {
  apicircleEnvironment?: unknown;
  name?: unknown;
  variables?: unknown;
}

interface RawVarRow {
  key?: unknown;
  value?: unknown;
  encrypted?: unknown;
  secretKeyId?: unknown;
  secret?: unknown;
}

/** Lightweight discriminator — `true` when `doc.apicircleEnvironment` is 1 or 2. */
export function isApicircleEnvironment(doc: unknown): doc is {
  apicircleEnvironment: 1 | 2;
  name: string;
  variables: unknown[];
} {
  if (!doc || typeof doc !== 'object') return false;
  const d = doc as ApicircleEnvDoc;
  return (
    (d.apicircleEnvironment === 1 || d.apicircleEnvironment === 2) &&
    typeof d.name === 'string' &&
    Array.isArray(d.variables)
  );
}

/**
 * Parse + validate a raw JSON string. Throws with a single, user-readable
 * message when the input is malformed; otherwise returns a parsed shape
 * ready for the store to graft in.
 */
export function parseApicircleEnvironment(input: string): ParsedApicircleEnvironment {
  let doc: unknown;
  try {
    doc = JSON.parse(input);
  } catch (err) {
    throw new Error(`Couldn't parse JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  return parseApicircleEnvironmentDoc(doc);
}

/**
 * Same as `parseApicircleEnvironment` but skips the JSON.parse step —
 * used by callers that already deserialized the document.
 */
export function parseApicircleEnvironmentDoc(doc: unknown): ParsedApicircleEnvironment {
  if (!isApicircleEnvironment(doc)) {
    throw new Error(
      'Unsupported format. Expected an API Circle environment export ("apicircleEnvironment": 1 or 2).',
    );
  }

  const name = doc.name.trim();
  if (!name) {
    throw new Error('API Circle environment export must have a non-empty "name".');
  }

  const payloadVersion: 1 | 2 = doc.apicircleEnvironment;
  const warnings: string[] = [];
  const variables: EnvironmentVariable[] = [];
  const encryptedBindingHints: EncryptedBindingHint[] = [];

  for (let i = 0; i < doc.variables.length; i += 1) {
    const raw = doc.variables[i] as RawVarRow;
    if (!raw || typeof raw !== 'object') {
      warnings.push(`Row #${i + 1} was not an object — dropped.`);
      continue;
    }
    const key = typeof raw.key === 'string' ? raw.key.trim() : '';
    if (!key) {
      warnings.push(`Row #${i + 1} had no key — dropped.`);
      continue;
    }
    if (raw.encrypted === true) {
      const secretKeyId = typeof raw.secretKeyId === 'string' ? raw.secretKeyId : '';
      const labelFromSecret = readLabelFromSecretField(raw.secret);
      // v2 ciphertext + salt are optional even on a v2 doc — defensive
      // for documents authored by tools that flip to v2 without filling
      // them in. When either is missing we degrade to v1-style handling
      // for that row.
      const ciphertext =
        payloadVersion === 2 && typeof raw.value === 'string' && raw.value.startsWith('enc:')
          ? raw.value
          : null;
      const salt = payloadVersion === 2 ? readSaltFromSecretField(raw.secret) : null;
      if (!secretKeyId && !labelFromSecret) {
        // Truly dangling — no id and no label means there's nothing to
        // prompt the user with and nothing to bind. Demote to a plain
        // empty row so the env still loads with the var declared.
        warnings.push(
          `"${key}" was marked encrypted but carried no secretKeyId and no secret label — imported as an empty plain variable. Re-bind it under Environments after import.`,
        );
        variables.push({ key, value: '', encrypted: false });
        continue;
      }
      // Encrypted row: keep the source's secretKeyId on the var so
      // same-workspace re-imports stay bound. The store action resolves
      // hints against the destination's vault and re-points the id
      // (or surfaces the row as a pending binding) before persisting.
      //
      // v2: carry the ciphertext through to `value` so the importer can
      // land it directly (and the request-execute decrypt path takes
      // over once the user provides the slot value). v1: empty string —
      // importer must prompt for a plaintext value.
      variables.push({
        key,
        value: ciphertext ?? '',
        encrypted: true,
        secretKeyId: secretKeyId || undefined,
      });
      const labelFromFallback = !labelFromSecret;
      encryptedBindingHints.push({
        varKey: key,
        label: labelFromSecret ?? key,
        originSecretKeyId: secretKeyId || undefined,
        labelFromFallback,
        ciphertext,
        salt,
      });
      continue;
    }
    // Plain row.
    variables.push({
      key,
      value: typeof raw.value === 'string' ? raw.value : '',
      encrypted: false,
    });
  }

  return { name, variables, encryptedBindingHints, payloadVersion, warnings };
}

function readLabelFromSecretField(field: unknown): string | null {
  if (!field || typeof field !== 'object') return null;
  const f = field as { label?: unknown };
  if (typeof f.label !== 'string') return null;
  const trimmed = f.label.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readSaltFromSecretField(field: unknown): string | null {
  if (!field || typeof field !== 'object') return null;
  const f = field as { salt?: unknown };
  if (typeof f.salt !== 'string') return null;
  const trimmed = f.salt.trim();
  return trimmed.length > 0 ? trimmed : null;
}
