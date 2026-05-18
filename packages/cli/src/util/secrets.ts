import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import type { WorkspaceState } from '@apicircle/core';

// =============================================================================
// CLI secret provisioning
//
// Secret values aren't synced to Git. Workspaces synced from a teammate carry
// only `secretKeyId` references and a synced labels map (`secretKeys`). The
// CLI must source the actual values from the runtime environment.
//
// Resolution order (later sources override earlier ones):
//   1. `--secrets <file>.json`        — `{ "<id>": "<value>" }`
//   2. `APICIRCLE_SECRET_<id>=value`  — env vars (prefix configurable)
//
// Resolved values feed `buildScope` as the `secrets` layer so `{{NAME}}`
// references in environment variables (with `secretKeyId`) get expanded
// at send time. Missing required ids surface as a single-block error before
// any HTTP request goes out.
// =============================================================================

export interface SecretRequirement {
  /** secretKeyId referenced by an env-variable in the workspace. */
  id: string;
  /** Best-known label (from `synced.secretKeys[id].label`) for display. */
  label: string;
  /** Where in the workspace the id is referenced (env name + var key). */
  references: Array<{ envName: string; varKey: string }>;
}

const DEFAULT_PREFIX = 'APICIRCLE_SECRET_';

export interface BuildSecretsOptions {
  secretsFile?: string;
  envPrefix?: string;
  env?: NodeJS.ProcessEnv;
}

export interface BuildSecretsResult {
  /** id → plaintext value, ready for buildScope. */
  byId: Record<string, string>;
}

export async function buildSecretsFromCli(
  options: BuildSecretsOptions = {},
): Promise<BuildSecretsResult> {
  const env = options.env ?? process.env;
  const prefix = options.envPrefix ?? DEFAULT_PREFIX;
  const byId: Record<string, string> = {};

  if (options.secretsFile) {
    const resolved = path.resolve(options.secretsFile);
    const raw = await fs.readFile(resolved, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(
        `--secrets ${options.secretsFile}: expected an object mapping secretKeyId → value`,
      );
    }
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value !== 'string') {
        throw new Error(`--secrets ${options.secretsFile}: value for "${id}" must be a string`);
      }
      byId[id] = value;
    }
  }

  for (const [name, value] of Object.entries(env)) {
    if (!name.startsWith(prefix) || typeof value !== 'string') continue;
    const id = name.slice(prefix.length);
    if (id) byId[id] = value;
  }

  return { byId };
}

/**
 * Walk a workspace and collect every `secretKeyId` referenced by an env
 * variable. Used to validate that the CLI received values for every
 * required id before executing a request.
 */
export function collectSecretRequirements(workspace: WorkspaceState): SecretRequirement[] {
  const labels = workspace.synced.secretKeys ?? {};
  const refs = new Map<string, SecretRequirement>();
  for (const [envName, env] of Object.entries(workspace.synced.environments.items)) {
    for (const v of env.variables) {
      if (!v.encrypted || !v.secretKeyId) continue;
      const id = v.secretKeyId;
      const requirement = refs.get(id) ?? {
        id,
        label: labels[id]?.label ?? `(unlabelled ${id.slice(0, 6)}…)`,
        references: [],
      };
      requirement.references.push({ envName, varKey: v.key });
      refs.set(id, requirement);
    }
  }
  return [...refs.values()];
}

/**
 * Format a missing-secrets error for the CLI. Returns a multi-line string
 * suitable for stderr; callers exit with code 2.
 */
export function formatMissingSecretsError(missing: SecretRequirement[]): string {
  const lines = ['Missing secret values for the following keys:'];
  for (const req of missing) {
    const refs = req.references.map((r) => `env "${r.envName}" var "${r.varKey}"`).join('; ');
    lines.push(`  - id "${req.id}" (label "${req.label}") — referenced by ${refs}`);
  }
  lines.push('');
  lines.push(
    'Provide values via APICIRCLE_SECRET_<id>=<value> environment variables or --secrets <file>.json.',
  );
  return lines.join('\n');
}

/**
 * Convenience: assert every required secret has a value. Throws a CLI-formatted
 * error when anything is missing, otherwise returns the resolved id→value map.
 */
export async function resolveSecretsForWorkspace(
  workspace: WorkspaceState,
  options: BuildSecretsOptions = {},
): Promise<Record<string, string>> {
  const { byId } = await buildSecretsFromCli(options);
  const missing = collectSecretRequirements(workspace).filter((r) => !(r.id in byId));
  if (missing.length > 0) {
    const err = new Error(formatMissingSecretsError(missing));
    (err as Error & { code?: string }).code = 'APICIRCLE_MISSING_SECRETS';
    throw err;
  }
  return byId;
}
