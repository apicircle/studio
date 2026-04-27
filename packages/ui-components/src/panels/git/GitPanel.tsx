import { PanelStub } from '../PanelStub';

export function GitPanel() {
  return (
    <PanelStub
      title="Git"
      phase="Phase 4"
      description="Connect a GitHub token in Settings, link a repo, and the app will auto-create a working branch from main. Edits save to that branch only; create a PR back to main when you're ready."
    />
  );
}
