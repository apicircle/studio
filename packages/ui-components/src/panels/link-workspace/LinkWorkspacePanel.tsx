import { PanelStub } from '../PanelStub';

export function LinkWorkspacePanel() {
  return (
    <PanelStub
      title="Link Workspace"
      phase="Phase 5"
      description="Link other workspaces (private session-bound or public marketplace). Per-link release pinning with explicit user confirmation on every version change. Required secret keys appear as fields on the connection card and write through to the global Secret Vault."
    />
  );
}
