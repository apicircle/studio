import type { WorkspaceRegistry } from '../../persistence/db';
import type { BranchWorkspaceSummary } from '../../store/workspaceStore';

/**
 * Picker labels for the workspaces a branch registry lists, keyed by id.
 *
 * A label is this device's own name for that workspace when it has one — what
 * the user already calls it — else the name it was last pushed with, else the
 * full workspace id, so an unnamed workspace is still identifiable. Labels that
 * collide case-insensitively get ` #` plus the first four id characters, the
 * same disambiguation the workspace switcher uses; unique labels stay clean.
 *
 * A module of its own so `WorkspacePanel.tsx` exports only components (React
 * Fast Refresh), and so it is tested as the pure function it is.
 */
export function importWorkspaceLabels(
  list: readonly BranchWorkspaceSummary[],
  localRegistry: WorkspaceRegistry | null,
): Map<string, string> {
  const localNames = new Map<string, string>();
  for (const entry of localRegistry?.workspaces ?? []) {
    // `setWorkspaceName` keeps a name that is mid-edit in memory unvalidated,
    // so a blank one falls through to the pushed name.
    const name = entry.name.trim();
    if (name) localNames.set(entry.id, name);
  }
  const labels = list.map((w) => ({ id: w.id, label: localNames.get(w.id) ?? w.name ?? w.id }));
  const counts = new Map<string, number>();
  for (const { label } of labels) {
    const key = label.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return new Map(
    labels.map(({ id, label }) => [
      id,
      counts.get(label.toLowerCase()) === 1 ? label : `${label} #${id.slice(0, 4)}`,
    ]),
  );
}
