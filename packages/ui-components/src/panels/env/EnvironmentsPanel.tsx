import { PanelStub } from '../PanelStub';

export function EnvironmentsPanel() {
  return (
    <PanelStub
      title="Environments"
      phase="Phase 3"
      description="Environment CRUD, priority resolution (context vars > active env > priority list), and encrypted variables backed by the local secret vault."
    />
  );
}
