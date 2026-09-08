import { WORKSPACE_SHARING_ENABLED } from '@apicircle/shared';

// The engine's view of the workspace-sharing master switch — the third mirror
// of `WORKSPACE_SHARING_ENABLED`, alongside
// `ui-components/src/layout/workspaceSharing.ts` and
// `apps/vscode/src/workspaceSharing.ts`.
//
// This one matters most, and is the reason the guard cannot live only in the
// UI: `runPlan` here is the shared execution engine. The web/desktop store has
// its own copy of `lookupPlanStepRequest`, but the VS Code extension
// (`commands/planActions.ts`) and every headless consumer run plans through
// THIS module. Gating each surface separately is how a linked step ends up
// still executing on one of them — which is exactly what happened before this
// existed.
//
// A function rather than a re-exported const because it is the seam tests spy
// on: the linked-step execution logic still has to work the day the switch
// flips, and that is only testable if the guard can be lifted.

/** Whether this build ships the workspace-sharing cluster. */
export function isWorkspaceSharingEnabled(): boolean {
  return WORKSPACE_SHARING_ENABLED;
}
