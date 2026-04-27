// Branch-name generator for the auto-create-from-main flow.
//
// Format: `apicircle/<slug>-<6char-id>`, where:
//   - <slug> is the workspace name normalised to lowercase ASCII alphanumerics
//     joined by hyphens. Empty slugs fall back to `workspace`.
//   - <6char-id> is a short random suffix that keeps subsequent branches from
//     colliding when a user creates more than one working branch from the
//     same workspace.
//
// The generator is pure and deterministic given an `idGen` function — tests
// inject a fixed id so assertions are stable.

const SLUG_FALLBACK = 'workspace';
const SUFFIX_LEN = 6;

/**
 * Validate a branch name against GitHub's ref rules. Returns null when the
 * name is acceptable, otherwise a short reason. We enforce a stricter
 * subset (no spaces, ASCII only, length ≤ 100) so the auto-generated names
 * always pass.
 */
export function validateBranchName(name: string): string | null {
  if (!name) return 'Branch name is required';
  if (name.length > 100) return 'Branch name is too long (max 100 chars)';
  if (/\s/.test(name)) return 'Branch name cannot contain whitespace';
  // Control chars + Git-disallowed punctuation are intentional in this class.
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f~^:?*\\[\]]/.test(name)) return 'Branch name has illegal characters';
  if (name.startsWith('-') || name.startsWith('/')) return 'Branch name cannot start with - or /';
  if (name.endsWith('.') || name.endsWith('/') || name.endsWith('.lock'))
    return 'Branch name cannot end with . or / or .lock';
  if (name.includes('..') || name.includes('//') || name.includes('@{'))
    return 'Branch name has invalid sequence';
  return null;
}

/** Lowercase ASCII slug, hyphenated, no leading/trailing/double hyphens. */
export function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining marks (accents)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || SLUG_FALLBACK;
}

export interface BranchNameOptions {
  workspaceName: string;
  /** Inject a fixed id in tests; defaults to 6 random hex chars. */
  idGen?: () => string;
}

export function generateWorkingBranchName(opts: BranchNameOptions): string {
  const slug = slugify(opts.workspaceName);
  const id = (opts.idGen ?? randomHex)();
  return `apicircle/${slug}-${id}`;
}

function randomHex(): string {
  const bytes = new Uint8Array(Math.ceil(SUFFIX_LEN / 2));
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, SUFFIX_LEN);
}
