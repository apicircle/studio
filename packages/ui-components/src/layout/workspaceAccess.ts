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
 * THE OPEN WORKSPACE FIRST, when the caller names it (`activeWorkspaceId`, the
 * registry's). However the user came to have more workspaces than the cap — a
 * plan that came down, an edition whose account has not loaded yet, a Studio
 * from before the cap — the workspace on screen keeps working, and the cap
 * locks the others. The cap never locks the user out of what they are editing
 * and never moves them somewhere else; that would be a cap that takes work away
 * mid-session instead of one that limits what else they can open.
 *
 * The remaining slots go OLDEST FIRST, by `createdAt`. Three properties follow
 * from that choice, and all three matter:
 *
 * 1. Locks fall on the newest workspaces. The one the user started with locks
 *    only when the open workspace took the cap's last slot.
 * 2. The set does not churn. Ordering by `lastOpenedAt` would silently swap
 *    which workspaces are reachable every time the user switched. The open
 *    workspace moves the set only while it sits past the oldest ones, and
 *    switching away from it then locks it: the cap doing its job once.
 * 3. Deleting an unlocked workspace promotes the next-oldest automatically, so
 *    the cap frees up without any extra bookkeeping.
 *
 * Ties on `createdAt` fall back to `id` so the order is total and stable rather
 * than dependent on however the registry happened to be sorted.
 */
export function unlockedWorkspaceIds(
  workspaces: readonly AccessibleWorkspace[],
  maxWorkspaces: number,
  activeWorkspaceId?: string | null,
): Set<string> {
  if (!Number.isFinite(maxWorkspaces)) return new Set(workspaces.map((w) => w.id));
  const slots = Math.max(0, maxWorkspaces);
  // The open workspace counts against the cap like any other, so it can only
  // take a slot when there is one to give.
  const active = slots > 0 ? workspaces.find((w) => w.id === activeWorkspaceId) : undefined;
  const rest = workspaces
    .filter((w) => w.id !== active?.id)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
    .slice(0, active ? slots - 1 : slots)
    .map((w) => w.id);
  return new Set(active ? [active.id, ...rest] : rest);
}

/** Is there room to create another workspace? */
export function canCreateWorkspace(count: number, maxWorkspaces: number): boolean {
  return count < maxWorkspaces;
}
