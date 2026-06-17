import * as YAML from 'yaml';
import type { ReleaseHistory, ReleaseVersion } from '@apicircle/shared';
import { sortVersionsDesc } from '@apicircle/core';

// =============================================================================
// Release-ledger YAML projection (read-only).
//
// Renders `synced.releases.self` — this workspace's published versions, the
// ones linked consumers pin to — as a human-readable document. Unlike the
// request / mock / env projections this is NOT a round-trip editing surface:
// publishing needs an async SHA-256 snapshot and deprecate / withdraw are
// per-version state transitions, so every mutation flows through the
// ▶ Publish / ⚠ Deprecate / ⛔ Withdraw CodeLens actions, never through a save.
//
// The shape is anchored for the CodeLens provider:
//   • `currentVersion:` is the anchor for the ▶ Publish release… action.
//   • each `  - version: <semver>` line is the anchor for that version's
//     ⚠ Deprecate / ⛔ Withdraw actions; the sibling `status:` line tells the
//     provider which actions still apply.
// =============================================================================

export type ReleaseStatus = 'published' | 'deprecated' | 'withdrawn' | 'deprecated+withdrawn';

export function releaseStatus(entry: Pick<ReleaseVersion, 'deprecated' | 'yanked'>): ReleaseStatus {
  if (entry.deprecated && entry.yanked) return 'deprecated+withdrawn';
  if (entry.yanked) return 'withdrawn';
  if (entry.deprecated) return 'deprecated';
  return 'published';
}

const HEADER_COMMENT = `# API Circle — Release history (this workspace)
#
# These are the published versions linked consumers pin to. Each entry is
# fingerprinted with a SHA-256 of the workspace contents at publish time.
#
# This view is read-only — edits here are not saved. Manage releases with the
# CodeLens actions:
#   • ▶ Publish release…  (on the 'currentVersion' line) — cut a new version
#   • ⚠ Deprecate         (on a version line) — soft signal; stays installable
#   • ⛔ Withdraw          (on a version line) — hard signal; tells consumers
#                           to move off this version
#
# To create a Git tag or GitHub Release for a published version, merge your
# working branch first, then use the Desktop app's 'Release & topics' surface.
`;

interface ReleaseYamlEntry {
  version: string;
  status: ReleaseStatus;
  publishedAt: string;
  snapshot: string;
  notes?: string;
}

interface ReleasesYamlOutput {
  currentVersion: string | null;
  versions: ReleaseYamlEntry[];
}

export function serializeReleasesToYaml(ledger: ReleaseHistory | null): string {
  const versions = ledger?.versions ?? [];
  // Newest-first so the most recent release is at the top of the document.
  const order = sortVersionsDesc(versions.map((v) => v.version));
  const byVersion = new Map(versions.map((v) => [v.version, v]));

  const out: ReleasesYamlOutput = {
    currentVersion: ledger?.currentVersion ?? null,
    versions: order
      .map((v) => byVersion.get(v))
      .filter((v): v is ReleaseVersion => v !== undefined)
      .map((v) => {
        const entry: ReleaseYamlEntry = {
          version: v.version,
          status: releaseStatus(v),
          publishedAt: v.publishedAt,
          // Short fingerprint — the full 64-char hash lives in workspace.json.
          snapshot: `${v.workspaceSnapshot.slice(0, 12)}…`,
        };
        if (v.notes) entry.notes = v.notes;
        return entry;
      }),
  };

  const doc = new YAML.Document(out);
  doc.commentBefore = HEADER_COMMENT.replace(/^# ?/gm, ' ').replace(/^\s$/gm, '').trimEnd();
  return doc.toString({ lineWidth: 0 });
}
