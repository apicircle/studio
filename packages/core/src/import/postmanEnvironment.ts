// Postman environment import. The Postman environment JSON shape is:
//   { id, name, values: [{ key, value, enabled?, type? }], _postman_variable_scope: 'environment' }
// We map this onto our Environment type — values become variables, with the
// `enabled` flag respected (disabled rows are skipped). Postman's `type` field
// (`secret` etc.) is dropped here — bring values in plaintext; the user can
// bind to a Vault key after import via the existing Encrypt button.

import type { EnvironmentVariable } from '@apicircle/shared';

export interface ParsedPostmanEnvironment {
  /** Suggested env name; the user can change at import time. */
  name: string;
  variables: EnvironmentVariable[];
  warnings: string[];
}

interface PostmanEnvDoc {
  name?: string;
  values?: Array<{ key?: string; value?: string; enabled?: boolean; type?: string }>;
  _postman_variable_scope?: string;
}

export function isPostmanEnvironment(doc: unknown): boolean {
  if (!doc || typeof doc !== 'object') return false;
  const d = doc as PostmanEnvDoc;
  // The scope field is the cleanest signal. Some exports omit it but include
  // a `name` + `values` array — accept those too as long as `values` looks
  // like an env variable list.
  if (d._postman_variable_scope === 'environment') return true;
  return typeof d.name === 'string' && Array.isArray(d.values);
}

export function parsePostmanEnvironment(input: string): ParsedPostmanEnvironment {
  const warnings: string[] = [];
  let parsed: PostmanEnvDoc;
  try {
    parsed = JSON.parse(input) as PostmanEnvDoc;
  } catch (err) {
    throw new Error(`Couldn't parse JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!isPostmanEnvironment(parsed)) {
    throw new Error(
      'Unsupported format. Expected a Postman environment JSON. Use Postman → Environments → Export.',
    );
  }
  const name = (parsed.name ?? 'Imported environment').trim() || 'Imported environment';
  const variables: EnvironmentVariable[] = [];
  for (const row of parsed.values ?? []) {
    const key = (row.key ?? '').trim();
    if (!key) continue;
    if (row.enabled === false) continue;
    if (row.type === 'secret') {
      warnings.push(
        `"${key}" was a Postman secret — imported as plaintext. Bind it to a Vault key in the Environments page if you want to keep it secret.`,
      );
    }
    variables.push({
      key,
      value: row.value ?? '',
      encrypted: false,
    });
  }
  return { name, variables, warnings };
}
