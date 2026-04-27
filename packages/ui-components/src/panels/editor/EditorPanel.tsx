import { Boxes } from 'lucide-react';
import { PanelStub } from '../PanelStub';

export function EditorPanel() {
  return (
    <PanelStub
      title="Editor"
      phase="Phase 2"
      description="Request CRUD, body editor, headers with autocomplete, send + response viewer, context variables, and assertions."
    >
      <div className="rounded-sm border border-border bg-card p-4 text-sm text-text-muted">
        <div className="mb-2 flex items-center gap-2 text-text-primary">
          <Boxes size={14} className="text-accent" />
          Foundation ready
        </div>
        Two-document workspace schema is wired to IndexedDB. Top nav + sidebar shell render, theme switching works. Next phase ports the request editor and execution runtime.
      </div>
    </PanelStub>
  );
}
