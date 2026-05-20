import { useState } from 'react';
import { ChevronDown, ChevronRight, ScrollText } from 'lucide-react';
import type { ReleaseVersion } from '@apicircle/shared';
import { useWorkspaceStore } from '../../store/workspaceStore';

// Renders the release notes for every linked-source version in the range
// `(fromVersion, toVersion]`. Pulls from `synced.releases.perLink` which is
// already populated by the link-refresh flow — no extra fetch needed.
//
// The block is collapsible; default-open when there's only one version,
// default-closed when there are many so the diff list stays the focus of
// the modal.

interface Props {
  linkedWorkspaceId: string;
  fromVersion: string | null;
  toVersion: string;
}

export function LinkedReleaseNotes({ linkedWorkspaceId, fromVersion, toVersion }: Props) {
  const ledger = useWorkspaceStore((s) => s.synced?.releases.perLink[linkedWorkspaceId] ?? null);

  const versions = pickVersions(ledger?.versions ?? [], fromVersion, toVersion);
  const [open, setOpen] = useState(versions.length === 1);

  if (versions.length === 0) return null;

  return (
    <section className="rounded-sm border border-border-subtle bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-text-primary hover:bg-surface"
      >
        {open ? (
          <ChevronDown size={12} aria-hidden="true" />
        ) : (
          <ChevronRight size={12} aria-hidden="true" />
        )}
        <ScrollText size={12} aria-hidden="true" className="text-accent" />
        <span className="font-medium">Release notes</span>
        <span className="text-[0.625rem] text-text-dim">
          {versions.length} version{versions.length === 1 ? '' : 's'} since
          {fromVersion ? ` v${fromVersion}` : ' first link'}
        </span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-border-subtle p-3">
          {versions.map((v) => (
            <ReleaseNoteEntry key={v.version} version={v} />
          ))}
        </div>
      )}
    </section>
  );
}

function ReleaseNoteEntry({ version }: { version: ReleaseVersion }) {
  return (
    <article className="space-y-1.5">
      <header className="flex flex-wrap items-center gap-2 text-[0.6875rem]">
        <span className="font-mono text-sm font-medium text-text-primary">v{version.version}</span>
        <span className="text-text-dim">{formatTimestamp(version.publishedAt)}</span>
        {version.yanked && (
          <span className="rounded-sm border border-danger/40 bg-danger/5 px-1.5 py-0 text-[0.5625rem] uppercase tracking-wider text-danger">
            yanked
          </span>
        )}
        {version.deprecated && !version.yanked && (
          <span className="rounded-sm border border-warning/40 bg-warning/5 px-1.5 py-0 text-[0.5625rem] uppercase tracking-wider text-warning">
            deprecated
          </span>
        )}
      </header>
      {version.notes?.trim() ? (
        <p className="whitespace-pre-wrap rounded-sm border border-border-subtle bg-surface px-2 py-1.5 text-[0.6875rem] leading-relaxed text-text-muted">
          {version.notes}
        </p>
      ) : (
        <p className="text-[0.6875rem] italic text-text-dim">No release notes provided.</p>
      )}
    </article>
  );
}

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

/**
 * Slice the version array to entries newer than `fromVersion` (exclusive)
 * and older-or-equal to `toVersion` (inclusive). Versions are append-only
 * with newest at the end of the array, so we walk from the toVersion
 * backward until we hit fromVersion (or the array start).
 */
function pickVersions(
  all: ReadonlyArray<ReleaseVersion>,
  fromVersion: string | null,
  toVersion: string,
): ReleaseVersion[] {
  const toIdx = all.findIndex((v) => v.version === toVersion);
  if (toIdx === -1) return [];
  const fromIdx = fromVersion ? all.findIndex((v) => v.version === fromVersion) : -1;
  // (fromIdx, toIdx] — newest first when reversed.
  const slice = all.slice(fromIdx + 1, toIdx + 1);
  return slice.slice().reverse();
}
