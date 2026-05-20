// Tiny semver helpers — we only need parse + compare. Pulling in the
// full `semver` package adds 30+ KB for behavior we use in two spots.

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/;

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: string | null;
  build: string | null;
}

export function parseSemver(version: string): ParsedVersion | null {
  const m = SEMVER_RE.exec(version.trim());
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] ?? null,
    build: m[5] ?? null,
  };
}

export function isValidSemver(version: string): boolean {
  return parseSemver(version) !== null;
}

/**
 * Compare two semver strings. Returns negative if `a < b`, positive if
 * `a > b`, 0 if equal. Build metadata is ignored (per semver spec). A
 * prerelease label sorts BEFORE its corresponding release (1.0.0-rc.1 <
 * 1.0.0). Within prereleases, dot-separated identifiers compare numeric
 * vs string per the spec.
 */
export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return a.localeCompare(b);
  if (pa.major !== pb.major) return pa.major - pb.major;
  if (pa.minor !== pb.minor) return pa.minor - pb.minor;
  if (pa.patch !== pb.patch) return pa.patch - pb.patch;
  // Prerelease ordering: a release > a prerelease of the same triple.
  if (pa.prerelease === null && pb.prerelease === null) return 0;
  if (pa.prerelease === null) return 1;
  if (pb.prerelease === null) return -1;
  return comparePrereleaseIdentifiers(pa.prerelease, pb.prerelease);
}

function comparePrereleaseIdentifiers(a: string, b: string): number {
  const aIds = a.split('.');
  const bIds = b.split('.');
  const len = Math.max(aIds.length, bIds.length);
  for (let i = 0; i < len; i++) {
    const ai = aIds[i];
    const bi = bIds[i];
    if (ai === undefined) return -1;
    if (bi === undefined) return 1;
    const aNum = /^\d+$/.test(ai) ? Number(ai) : null;
    const bNum = /^\d+$/.test(bi) ? Number(bi) : null;
    if (aNum !== null && bNum !== null) {
      if (aNum !== bNum) return aNum - bNum;
    } else if (aNum !== null) {
      return -1; // numeric sorts before alpha
    } else if (bNum !== null) {
      return 1;
    } else if (ai !== bi) {
      return ai.localeCompare(bi);
    }
  }
  return 0;
}

/** Sort an array of semver strings — newest first (descending). */
export function sortVersionsDesc(versions: readonly string[]): string[] {
  return [...versions].sort((a, b) => compareSemver(b, a));
}
