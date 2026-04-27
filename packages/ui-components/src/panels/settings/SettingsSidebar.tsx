import { useWorkspaceStore } from '../../store/workspaceStore';
import { cn } from '../../primitives/cn';

const SECTIONS = [
  { id: 'workspace', label: 'Workspace' },
  { id: 'theme', label: 'Theme' },
  { id: 'vault', label: 'Secret Vault' },
];

export function SettingsSidebar() {
  const expanded = useWorkspaceStore((s) => s.local?.ui.sidebarExpandedSections ?? []);
  const toggle = useWorkspaceStore((s) => s.toggleSidebarSection);

  return (
    <ul className="flex flex-col gap-1">
      {SECTIONS.map((section) => {
        const isOpen = expanded.includes(`settings.${section.id}`);
        return (
          <li key={section.id}>
            <button
              type="button"
              onClick={() => toggle(`settings.${section.id}`)}
              className={cn(
                'flex w-full items-center justify-between rounded-sm border px-2 py-1.5 text-xs transition-colors',
                isOpen
                  ? 'border-accent/40 bg-accent/10 text-text-primary'
                  : 'border-transparent text-text-muted hover:bg-surface hover:text-text-primary',
              )}
            >
              <span>{section.label}</span>
              <span className="text-text-dim">{isOpen ? '–' : '+'}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
