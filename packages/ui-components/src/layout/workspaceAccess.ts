import { createContext, useContext, type ReactNode } from 'react';
import type { WorkspaceRegistryEntry } from '../persistence/db';

// Workspace access policy — how many workspaces this build may keep OPEN.
//
// This is the one place the shell carries a commercial limit, and it is
// deliberately expressed as data rather than a dependency: `ui-components` knows
// nothing about accounts, plans, or entitlements. An edition supplies a number;
// Studio standalone supplies nothing and gets the default.
//
// Unlike the other `App` seams (`brand` / `sections` / `extraPanels`), omitting
// this one is NOT a no-op. The default is a cap of one, because a build with no
// edition attached is the free tier. That asymmetry is intentional and is what
// makes the limit apply to standalone Studio as well as to a bundled edition.

export interface WorkspaceAccess {
  /** Maximum workspaces that stay open. `Infinity` for unlimited. */
  maxWorkspaces: number;
  /**
   * Rendered when the user tries to reach a locked workspace or to create one
   * past the cap. An edition swaps in its own upgrade path; the default explains
   * the lock without pretending there is somewhere to click.
   */
  lockedNotice?: ReactNode;
}

/** Free tier: one workspace. Applied whenever no edition supplies a policy. */
export const DEFAULT_WORKSPACE_ACCESS: WorkspaceAccess = { maxWorkspaces: 1 };

const WorkspaceAccessContext = createContext<WorkspaceAccess>(DEFAULT_WORKSPACE_ACCESS);

export const WorkspaceAccessProvider = WorkspaceAccessContext.Provider;

export function useWorkspaceAccess(): WorkspaceAccess {
  return useContext(WorkspaceAccessContext);
}

/** The minimum a caller needs to decide whether a workspace is unlocked. */
export type AccessibleWorkspace = Pick<WorkspaceRegistryEntry, 'id' | 'createdAt'>;

/**
 * Which workspace ids stay unlocked under `maxWorkspaces`.
 *
 * OLDEST FIRST, by `createdAt`. Three properties follow from that choice, and
 * all three matter:
 *
 * 1. The workspace the user started with is never the one that locks — which is
 *    what makes "your data is still here" true rather than a slogan.
 * 2. The set does not churn. Ordering by `lastOpenedAt` would silently swap
 *    which workspaces are reachable every time the user switched.
 * 3. Deleting an unlocked workspace promotes the next-oldest automatically, so
 *    the cap frees up without any extra bookkeeping.
 *
 * Ties on `createdAt` fall back to `id` so the order is total and stable rather
 * than dependent on however the registry happened to be sorted.
 */
export function unlockedWorkspaceIds(
  workspaces: readonly AccessibleWorkspace[],
  maxWorkspaces: number,
): Set<string> {
  if (!Number.isFinite(maxWorkspaces)) return new Set(workspaces.map((w) => w.id));
  const ordered = [...workspaces].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
  return new Set(ordered.slice(0, Math.max(0, maxWorkspaces)).map((w) => w.id));
}

/** Is there room to create another workspace? */
export function canCreateWorkspace(count: number, maxWorkspaces: number): boolean {
  return count < maxWorkspaces;
}
