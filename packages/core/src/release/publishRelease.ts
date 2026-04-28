import type { ReleaseHistory, ReleaseVersion, WorkspaceSynced } from '@apicircle/shared';
import { serializeWorkspaceForGit } from '../git/serializeWorkspace';
import { isValidSemver } from './semver';

// Workspace-self release publishing. The synced doc is the source of
// truth; releases.self carries the ledger; the published version's
// `workspaceSnapshot` is the SHA-256 of the canonical pre-publish
// workspace.json so consumers can verify integrity.

export interface PublishReleaseArgs {
  version: string;
  notes: string;
  /** Optional bookkeeping — the git commit SHA the release points at. */
  sha?: string;
  /** Optional bookkeeping — git tag name (the source of truth is the ledger). */
  tagName?: string;
  publishedAt?: string;
}

/**
 * Append a new release to `synced.releases.self.versions` and bump
 * `currentVersion`. Pure — does not touch IDB or Git.
 *
 * Throws on invalid semver, duplicate version, or invalid notes shape.
 */
export async function publishRelease(
  synced: WorkspaceSynced,
  args: PublishReleaseArgs,
): Promise<WorkspaceSynced> {
  const version = args.version.trim();
  if (!isValidSemver(version)) {
    throw new Error(`Invalid semver: ${args.version}`);
  }
  const ledger = synced.releases.self ?? emptyLedger();
  if (ledger.versions.some((v) => v.version === version)) {
    throw new Error(`Version ${version} already exists in this workspace's release ledger`);
  }

  // The snapshot represents the doc *as of the moment of publishing*: we
  // stamp the SHA before writing the new version entry so it's a stable
  // fingerprint of the workspace data the release is built on.
  const snapshotSource = serializeWorkspaceForGit(synced);
  const workspaceSnapshot = await sha256Hex(snapshotSource);

  const entry: ReleaseVersion = {
    version,
    publishedAt: args.publishedAt ?? new Date().toISOString(),
    notes: args.notes,
    workspaceSnapshot,
    deprecated: false,
    yanked: false,
    ...(args.sha ? { sha: args.sha } : {}),
    ...(args.tagName ? { tagName: args.tagName } : {}),
  };

  const next: ReleaseHistory = {
    versions: [...ledger.versions, entry],
    currentVersion: version,
  };
  return {
    ...synced,
    releases: { ...synced.releases, self: next },
    meta: { ...synced.meta, updatedAt: entry.publishedAt },
  };
}

/** Flip the `deprecated` flag on a version. Soft signal — version is still installable. */
export function deprecateRelease(synced: WorkspaceSynced, version: string): WorkspaceSynced {
  return mapReleaseVersion(synced, version, (v) => ({ ...v, deprecated: true }));
}

/**
 * Flip the `yanked` flag on a version. Hard signal — consumers should
 * be told this version is broken / unsafe and offered a different one.
 */
export function yankRelease(synced: WorkspaceSynced, version: string): WorkspaceSynced {
  return mapReleaseVersion(synced, version, (v) => ({ ...v, yanked: true }));
}

function mapReleaseVersion(
  synced: WorkspaceSynced,
  version: string,
  fn: (v: ReleaseVersion) => ReleaseVersion,
): WorkspaceSynced {
  const ledger = synced.releases.self;
  if (!ledger) throw new Error('No releases to modify');
  const idx = ledger.versions.findIndex((v) => v.version === version);
  if (idx === -1) throw new Error(`Version ${version} not found`);
  const versions = [...ledger.versions];
  versions[idx] = fn(versions[idx]);
  return {
    ...synced,
    releases: { ...synced.releases, self: { ...ledger, versions } },
    meta: { ...synced.meta, updatedAt: new Date().toISOString() },
  };
}

function emptyLedger(): ReleaseHistory {
  return { versions: [], currentVersion: null };
}

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
