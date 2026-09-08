import { WORKSPACE_SHARING_ENABLED } from '@apicircle/shared';

// Workspace sharing — the one switch that decides whether the "publish a
// workspace and consume someone else's" cluster exists in this build: the Link
// Workspace panel + marketplace search, linked collections / environments /
// execution / overrides, linked release notes, the Releases card, and Tag
// release + repo Topics.
//
// The value is hard-coded in `@apicircle/shared` (see
// `WORKSPACE_SHARING_ENABLED` for what is and isn't in scope, and why the code
// stays in the repo). This module deliberately does NOT re-export it as a bare
// const, and deliberately is NOT an `App` seam the way `layout/workspaceAccess`
// is — that seam exists so a downstream edition can opt in, and nothing may opt
// in to this one.
//
// Two things live here instead:
//
//   `isWorkspaceSharingEnabled()` — a function rather than a const, because a
//   function is the seam a test can `vi.mock`. With no prop and no context
//   there is otherwise no way to exercise the enabled path, and the cluster's
//   ~17 existing test files would be stranded. Mocking this three-line module
//   is far cheaper than mocking all of `@apicircle/shared`.
//
//   `visibleUnderSharing()` — the single filter behind every "hide these
//   entries" list in the app: the panel registry, the Help Center's articles,
//   and the onboarding tour's steps. Three lists means three chances to drift,
//   and one shared predicate is what makes "the tour never navigates to a panel
//   the tab strip doesn't show" a property rather than a coincidence.

/** Whether this build ships the workspace-sharing cluster. */
export function isWorkspaceSharingEnabled(): boolean {
  return WORKSPACE_SHARING_ENABLED;
}

/** A registry entry that belongs to the sharing cluster tags itself. */
export interface SharingTagged {
  requiresWorkspaceSharing?: boolean;
}

/**
 * `items` minus the sharing-only entries, when sharing is off.
 *
 * Callers memoize the result at MODULE scope (`Object.freeze(...)`) rather than
 * filtering per render. `KeyboardShortcuts` feeds the panel list into a
 * `useEffect` dependency array, and a fresh array identity on every render
 * would re-subscribe the global keydown listener every render. Same
 * frozen-identity discipline as `NO_EXTRA_PANELS` / `NO_SECTIONS`.
 */
export function visibleUnderSharing<T extends SharingTagged>(
  items: readonly T[],
  sharingEnabled: boolean = isWorkspaceSharingEnabled(),
): readonly T[] {
  return sharingEnabled ? items : items.filter((item) => !item.requiresWorkspaceSharing);
}
