import * as YAML from 'yaml';
import type { Environment, EnvironmentVariable } from '@apicircle/shared';

// =============================================================================
// Environment YAML projection.
//
// Round-trip between the canonical Environment shape inside workspace.json
// and the human-friendly YAML the user edits in VS Code.
//
// Encryption discipline:
//   - Encrypted variables carry `encrypted: true`, `secretKeyId`, and a
//     ciphertext value (format `enc:v1:<iv>:<ct>`). The YAML projection
//     preserves all three fields verbatim — the extension never decrypts
//     ciphertext to YAML and never re-encrypts on save. Vault unlock /
//     decryption flows shipped in Phase 4 via `VsCodeVaultManager`;
//     `apicircle.openVaultEntry` exposes the reveal action.
//   - Plaintext variables omit `encrypted` (default false) and `secretKeyId`.
// =============================================================================

interface EnvYamlOutput {
  name: string;
  variables: Array<{
    key: string;
    value: string;
    encrypted?: boolean;
    secretKeyId?: string;
  }>;
}

const HEADER_COMMENT = `# APICircle Environment — edit fields below and save to commit.
# Encrypted variables carry 'encrypted: true' + 'secretKeyId' — the ciphertext
# value is shared via Git; decryption happens at request-send time using the
# workspace passphrase via the Phase 4 vault — reveal a value with
# 'APICircle: Open Vault Entry' or click the lock icon in the Environment view.
`;

export function serializeEnvironmentToYaml(env: Environment): string {
  const out: EnvYamlOutput = {
    name: env.name,
    variables: env.variables.map((v) => {
      const row: EnvYamlOutput['variables'][number] = {
        key: v.key,
        value: v.value,
      };
      if (v.encrypted) row.encrypted = true;
      if (v.secretKeyId) row.secretKeyId = v.secretKeyId;
      return row;
    }),
  };
  const doc = new YAML.Document(out);
  doc.commentBefore = HEADER_COMMENT.replace(/^# /gm, ' ').trimEnd();
  return doc.toString({ lineWidth: 0 });
}

export interface ParsedEnvYaml {
  environment: Environment;
  warnings: string[];
}

export function parseEnvironmentFromYaml(text: string): ParsedEnvYaml {
  let parsed: unknown;
  try {
    parsed = YAML.parse(text);
  } catch (e) {
    throw new EnvYamlParseError(`Invalid YAML: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new EnvYamlParseError('Document root must be a mapping with `name` and `variables`.');
  }

  const obj = parsed as Record<string, unknown>;
  const warnings: string[] = [];

  if (typeof obj.name !== 'string' || obj.name.length === 0) {
    throw new EnvYamlParseError('Environment `name` is required and must be a non-empty string.');
  }

  const variables = normalizeVariables(obj.variables, warnings);
  return {
    environment: { name: obj.name, variables },
    warnings,
  };
}

function normalizeVariables(value: unknown, warnings: string[]): EnvironmentVariable[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    warnings.push('`variables` should be a list of {key, value, encrypted?, secretKeyId?} rows');
    return [];
  }
  return value
    .map((row, i): EnvironmentVariable | null => {
      if (typeof row !== 'object' || row === null) {
        warnings.push(`variables[${i}] is not an object`);
        return null;
      }
      const r = row as Record<string, unknown>;
      if (typeof r.key !== 'string') {
        warnings.push(`variables[${i}].key must be a string`);
        return null;
      }
      const variable: EnvironmentVariable = {
        key: r.key,
        value: typeof r.value === 'string' ? r.value : '',
        encrypted: r.encrypted === true,
      };
      if (typeof r.secretKeyId === 'string' && r.secretKeyId.length > 0) {
        variable.secretKeyId = r.secretKeyId;
      }
      return variable;
    })
    .filter((v): v is EnvironmentVariable => v !== null);
}

export class EnvYamlParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvYamlParseError';
  }
}
