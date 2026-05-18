import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PanelStub, SidebarStub } from './PanelStub';

describe('PanelStub', () => {
  it('renders title, phase, and description', () => {
    render(<PanelStub title="Editor" phase="Phase 2" description="Coming soon" />);
    expect(screen.getByRole('heading', { name: 'Editor' })).toBeInTheDocument();
    expect(screen.getByText('Phase 2')).toBeInTheDocument();
    expect(screen.getByText('Coming soon')).toBeInTheDocument();
  });

  it('renders optional children', () => {
    render(
      <PanelStub title="x" phase="P" description="y">
        <div>child</div>
      </PanelStub>,
    );
    expect(screen.getByText('child')).toBeInTheDocument();
  });
});

describe('SidebarStub', () => {
  it('renders the message', () => {
    render(<SidebarStub message="placeholder" />);
    expect(screen.getByText('placeholder')).toBeInTheDocument();
  });
});
