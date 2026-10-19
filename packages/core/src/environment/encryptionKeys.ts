import type { Environment } from '@apicircle/shared';

// =============================================================================
// Encryption-key slots.
//
// A Secret Vault slot has two uses. Its label can be written as `{{LABEL}}` in
// a request, and its value can encrypt environment variables (a variable with
// `encrypted: true` and `secretKeyId` set to the slot). A slot used the second
// way is an encryption key: every variable bound to it is ciphertext derived
// from its value, and that ciphertext travels through Git. Sending the value
// to a server would expose all of them, so such a slot is never a variable.
//
// `findEncryptionKeys` names those slots for `ResolutionScope.encryptionKeys`;
// the resolver then leaves `{{LABEL}}` as typed, pre-send validation blocks
// the request, and each send path refuses it with `encryptionKeyRefusal`.
// =============================================================================

/**
 * Labels of the slots that encrypt at least one environment variable, each
 * mapped to the variables it encrypts (unique, sorted).
 *
 * `slotLabels` maps a slot id to the label a request would write it as;
 * `environments` lists every set of environments whose encrypted variables may
 * name a slot (the workspace's own, and each linked workspace's after the
 * consumer's overrides). A variable whose slot has no label in `slotLabels`
 * cannot be referenced by label, so it contributes nothing.
 */
export function findEncryptionKeys(args: {
  slotLabels: Readonly<Record<string, string>>;
  environments: ReadonlyArray<Readonly<Record<string, Environment>>>;
}): Record<string, string[]> {
  const byLabel = new Map<string, Set<string>>();
  for (const items of args.environments) {
    for (const env of Object.values(items)) {
      for (const v of env.variables) {
        if (!v.encrypted || !v.secretKeyId || !v.key) continue;
        if (!Object.prototype.hasOwnProperty.call(args.slotLabels, v.secretKeyId)) continue;
        const label = args.slotLabels[v.secretKeyId];
        if (!label) continue;
        const vars = byLabel.get(label) ?? new Set<string>();
        vars.add(v.key);
        byLabel.set(label, vars);
      }
    }
  }
  const out: Record<string, string[]> = {};
  for (const [label, vars] of byLabel) out[label] = [...vars].sort();
  return out;
}

function joinNames(names: readonly string[], conjunction: 'and' | 'or'): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} ${conjunction} ${names[names.length - 1]}`;
}

/**
 * Says that `{{label}}` is an encryption key, not a variable, and what to write
 * instead. The one wording every surface uses.
 */
export function describeEncryptionKeyReference(
  label: string,
  variables: readonly string[],
): string {
  if (variables.length === 0) {
    return `{{${label}}} is an encryption key, not a variable, so its value is never sent.`;
  }
  const refs = variables.map((v) => `{{${v}}}`);
  const target = variables.length === 1 ? 'the variable' : 'one of the variables';
  return (
    `{{${label}}} is the encryption key of ${joinNames(variables, 'and')}, not a variable, ` +
    `so its value is never sent. Write ${joinNames(refs, 'or')} to send ${target}.`
  );
}

/** How a refusal's message starts, so a response view can tell it apart. */
export const NOT_SENT_PREFIX = 'Not sent. ';

/**
 * The error a send path reports when it refuses a request that references
 * encryption keys: `Not sent.` followed by one description per key.
 */
export function encryptionKeyRefusal(
  labels: readonly string[],
  encryptionKeys: Readonly<Record<string, readonly string[]>>,
): string {
  const reasons = labels.map((label) =>
    describeEncryptionKeyReference(label, encryptionKeys[label] ?? []),
  );
  return `${NOT_SENT_PREFIX}${reasons.join(' ')}`;
}
