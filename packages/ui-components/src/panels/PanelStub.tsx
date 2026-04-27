import type { ReactNode } from 'react';

interface PanelStubProps {
  title: string;
  phase: string;
  description: string;
  children?: ReactNode;
}

export function PanelStub({ title, phase, description, children }: PanelStubProps) {
  return (
    <div className="flex h-full flex-col p-6">
      <div className="mb-6 flex items-baseline gap-3">
        <h1 className="text-lg font-medium text-text-primary">{title}</h1>
        <span className="rounded-sm border border-border bg-card px-2 py-0.5 text-[10px] uppercase tracking-wider text-text-muted">
          {phase}
        </span>
      </div>
      <p className="max-w-2xl text-sm text-text-muted">{description}</p>
      {children && <div className="mt-6 max-w-2xl">{children}</div>}
    </div>
  );
}

interface SidebarStubProps {
  message: string;
}

export function SidebarStub({ message }: SidebarStubProps) {
  return (
    <div className="rounded-sm border border-dashed border-border-subtle p-3 text-xs text-text-dim">
      {message}
    </div>
  );
}
