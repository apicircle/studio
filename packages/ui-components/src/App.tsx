import { useEffect } from 'react';
import { useWorkspaceStore } from './store/workspaceStore';
import { TopBar } from './layout/TopBar';
import { PanelTabs } from './layout/PanelTabs';
import { Sidebar } from './layout/Sidebar';
import { PanelContent } from './layout/PanelContent';
import { SecretVaultModal } from './layout/SecretVaultModal';

export function App() {
  const ready = useWorkspaceStore((s) => s.ready);
  const hydrate = useWorkspaceStore((s) => s.hydrate);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center bg-surface text-sm text-text-muted">
        Loading workspace…
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-surface text-text-primary">
      <TopBar />
      <PanelTabs />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <PanelContent />
      </div>
      <SecretVaultModal />
    </div>
  );
}
