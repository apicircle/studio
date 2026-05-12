/**
 * Pure validators shared between core and UI. Each returns a discriminated
 * union so callers can branch cleanly: `.ok ? proceed : showError(reason)`.
 *
 * No throws — failures are explicit values. Validators never mutate input.
 *
 * Used by:
 *  - Inline UI feedback (`role="alert"` under inputs, disabled submit)
 *  - PreSendPanel + Send-time guards
 *  - Test fixtures that want to check shape without fabricating asserts
 */

export type ValidationResult = { ok: true } | { ok: false; reason: string };

const OK: ValidationResult = { ok: true };
const fail = (reason: string): ValidationResult => ({ ok: false, reason });

/**
 * Accepts any URL the browser can fetch + the variable-template form
 * `{{NAME}}/path`. Empty + whitespace-only fail. Schemes other than
 * http/https/file/{{...}} fail (mailto:/tel: aren't fetchable from
 * Studio's executor).
 */
export function validateUrl(value: string): ValidationResult {
  const trimmed = value.trim();
  if (!trimmed) return fail('URL is required.');
  // A bare {{var}} expression is a valid URL once the variable resolves;
  // we can't validate the resolved form here so accept it with a hint.
  if (/^\s*\{\{\s*[^{}]+\s*\}\}/.test(trimmed)) return OK;
  // Substitute placeholders so URL.canParse accepts the template form.
  const probe = trimmed.replace(/\{\{[^{}]+\}\}/g, 'placeholder');
  try {
    const u = new URL(probe);
    if (!/^https?:|^file:$/i.test(u.protocol)) {
      return fail(`Unsupported scheme "${u.protocol}". Use http(s):// or file://.`);
    }
    if (u.protocol !== 'file:' && !u.host) return fail('URL is missing a host.');
    return OK;
  } catch {
    return fail('Not a valid URL. Expected http(s)://host/path.');
  }
}

/**
 * AWS region: 2-3 letter geo + dash + a known direction/zone word + (optional
 * extra word for partitions like GovCloud) + dash + digit. Vocabulary is a
 * closed set so typos like `us-eastt-1` reject — the original audit gap.
 *
 * Adding a new direction word is a one-line edit when AWS announces one.
 */
const AWS_DIRECTIONS = new Set([
  'east',
  'west',
  'north',
  'south',
  'central',
  'northeast',
  'northwest',
  'southeast',
  'southwest',
]);

export function validateAwsRegion(value: string): ValidationResult {
  const v = value.trim().toLowerCase();
  if (!v) return fail('Region is required (e.g. us-east-1).');
  // Match: <geo>-[<partition>-]<direction>-<digit>
  // Examples:
  //   us-east-1
  //   eu-west-3
  //   us-gov-west-1   (partition='gov')
  //   cn-northwest-1
  const m = /^([a-z]{2,3})-(?:([a-z]+)-)?([a-z]+)-(\d+)$/.exec(v);
  if (!m) return fail('Region must look like "us-east-1" or "us-gov-west-1".');
  const direction = m[3];
  if (!AWS_DIRECTIONS.has(direction)) {
    return fail(`Unknown direction "${direction}". Expected east/west/north/south/central/etc.`);
  }
  return OK;
}

/**
 * Mock endpoint path pattern: must start with `/`, no whitespace, no
 * query string (`?` is an error — query matching is a separate concern).
 * Permits Express-style `:param` segments and `*` wildcards.
 */
export function validateMockPath(value: string): ValidationResult {
  const v = value.trim();
  if (!v) return fail('Path is required.');
  if (!v.startsWith('/')) return fail('Path must start with "/".');
  if (/\s/.test(v)) return fail('Path must not contain whitespace.');
  if (v.includes('?')) return fail('Path must not include a query string.');
  if (v.includes('#')) return fail('Path must not include a fragment.');
  return OK;
}

/**
 * Environment-variable key — the bit between `{{ }}` at resolve time.
 * Allowed: ASCII letters, digits, underscore, hyphen. First character
 * must be a letter or underscore (matches POSIX env-var naming).
 */
export function validateEnvVarName(value: string): ValidationResult {
  const v = value.trim();
  if (!v) return fail('Variable name is required.');
  if (/[\s{}]/.test(v)) return fail('Variable name cannot contain spaces or braces.');
  if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(v)) {
    return fail('Use letters, digits, underscores, hyphens. Must start with a letter or _.');
  }
  return OK;
}

/**
 * Plan name — same characters allowed as env-var names plus spaces, but
 * must be non-empty after trim. Caller is responsible for uniqueness.
 */
export function validatePlanName(value: string): ValidationResult {
  const v = value.trim();
  if (!v) return fail('Plan name is required.');
  if (v.length > 80) return fail('Plan name must be 80 characters or fewer.');
  return OK;
}

/**
 * GitHub PR title — non-empty after trim, ≤256 chars (GitHub's hard cap).
 */
export function validatePRTitle(value: string): ValidationResult {
  const v = value.trim();
  if (!v) return fail('Title is required.');
  if (v.length > 256) return fail('Title must be 256 characters or fewer.');
  return OK;
}

/**
 * JSON validity — accepts only object/array roots (string/number/bool/null
 * are technically valid JSON but rarely what users mean for headers/body
 * payloads; we surface a clearer message).
 */
export function validateJsonString(
  value: string,
  opts: { allowEmpty?: boolean; allowRoots?: 'object' | 'array' | 'any' } = {},
): ValidationResult {
  const v = value.trim();
  if (!v) {
    if (opts.allowEmpty) return OK;
    return fail('JSON cannot be empty.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(v);
  } catch (e) {
    return fail(`Invalid JSON: ${e instanceof Error ? e.message : 'parse failed'}.`);
  }
  const allow = opts.allowRoots ?? 'any';
  if (
    allow === 'object' &&
    (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
  ) {
    return fail('JSON root must be an object.');
  }
  if (allow === 'array' && !Array.isArray(parsed)) {
    return fail('JSON root must be an array.');
  }
  return OK;
}

// Note: `validateBranchName` lives in @apicircle/core (returns `string | null`).
// Keep the existing one — we don't need a second flavour.
