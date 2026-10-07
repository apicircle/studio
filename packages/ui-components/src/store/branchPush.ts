import { summarizeUnpushedChanges } from '@apicircle/core';
import type { EntityBucket, UnpushedSummary } from '@apicircle/core';
import type { WorkspaceLocal, WorkspaceSynced } from '@apicircle/shared';

// Pure helpers behind `pushBranchChanges` and the pull-request description: the
// parts of a push of the whole working branch — Studio's workspace plus the
// changes an edition registers as branch change sources — that need no store.

/**
 * Does Studio have anything of its own to push? `pushWorkspace` always writes a
 * commit (the registry entry is stamped with the push time), so a push of the
 * whole branch must not call it when nothing changed: that would add an empty-
 * looking commit to every code-only push. Pending attachment uploads and
 * deletes count — they change the branch even when no entity did.
 */
export function studioHasPendingChanges(local: WorkspaceLocal, synced: WorkspaceSynced): boolean {
  if ((local.pendingAttachmentDeletes ?? []).length > 0) return true;
  if (Object.keys(local.pendingFileUploads ?? {}).length > 0) return true;
  return summarizeUnpushedChanges(local.sync.lastPulledSnapshot, synced).total > 0;
}

const KIND_WORD = { added: 'Added', modified: 'Changed', removed: 'Removed' } as const;

/** What each kind of entity is called in a PR description. */
const BUCKET_NAME: Record<EntityBucket, string> = {
  tree: 'collection order',
  request: 'request',
  folder: 'folder',
  environment: 'environment',
  environmentsActive: 'active environment',
  environmentsPriority: 'environment priority',
  linkedWorkspace: 'linked workspace',
  linkedRequestOverride: 'linked request override',
  linkedEnvOverride: 'linked environment override',
  mockServer: 'mock server',
  executionPlan: 'execution plan',
  globalSchema: 'schema asset',
  globalGraphql: 'GraphQL asset',
  globalFile: 'file asset',
  secretKey: 'secret key',
  secretCrypto: 'secret encryption',
  releaseSelf: 'release',
  releasePerLink: 'linked release',
};

/** A label as a Markdown code span that no backtick inside it can break. */
function codeSpan(label: string): string {
  const longestRun = Math.max(0, ...(label.match(/`+/g) ?? []).map((run) => run.length));
  const fence = '`'.repeat(longestRun + 1);
  const pad = label.startsWith('`') || label.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${label}${pad}${fence}`;
}

/**
 * The Studio part of a pull-request description: what the PR changes in the
 * workspace, one line per entity, under its own heading. `null` when the
 * workspace is unchanged. Long lists stop at `limit` lines and say how many
 * more there are.
 */
export function describeStudioChanges(summary: UnpushedSummary, limit = 40): string | null {
  if (summary.total === 0) return null;
  // A singleton (the collection order, the environment priority…) has no key,
  // and its label only repeats what it is.
  const lines = summary.changes
    .slice(0, limit)
    .map((c) =>
      c.key === ''
        ? `- ${KIND_WORD[c.kind]} ${BUCKET_NAME[c.bucket]}`
        : `- ${KIND_WORD[c.kind]} ${BUCKET_NAME[c.bucket]} ${codeSpan(c.label)}`,
    );
  if (summary.changes.length > limit) lines.push(`- …and ${summary.changes.length - limit} more`);
  return ['## Studio changes', '', ...lines].join('\n');
}
