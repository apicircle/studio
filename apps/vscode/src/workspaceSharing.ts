import { WORKSPACE_SHARING_ENABLED } from '@apicircle/shared';

// The extension's view of the workspace-sharing master switch — the mirror of
// `ui-components/src/layout/workspaceSharing.ts`, reading the same hard-coded
// constant from `@apicircle/shared` so the two shells cannot disagree about
// whether the Link Workspace / release / topics cluster ships.
//
// A function rather than a re-exported const for the same reason as the web
// side: it is the seam a test spies on. The CodeLens providers still have to
// build their lenses correctly the day the switch flips, and that behaviour is
// only testable if the guard can be lifted.
//
// The gate reaches VS Code by two routes, and they cover different things.
// This one short-circuits the CodeLens providers so a restored YAML tab carries
// no actions. The other is `setContext('apicircle.workspaceSharing')` in
// `activate()`, which drives the `when` clauses in package.json — that is what
// removes the tree view, its menus, and every command from the palette.

/** Whether this build ships the workspace-sharing cluster. */
export function isWorkspaceSharingEnabled(): boolean {
  return WORKSPACE_SHARING_ENABLED;
}
