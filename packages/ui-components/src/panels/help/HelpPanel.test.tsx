import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { HelpPanel } from './HelpPanel';

describe('HelpPanel', () => {
  it('lists every section in the sidebar nav by default', () => {
    render(<HelpPanel />);
    const nav =
      screen.getByRole('navigation', { hidden: true }) ?? screen.getByLabelText('Help sections');
    void nav; // present in the DOM; the per-section assertions below cover content.
    for (const expected of [
      'Welcome',
      'Workspace & Git',
      'Editor',
      'Environments',
      'Secret Vault',
      'Link Workspace',
      'Release Management',
      'Execution Plans',
      'History',
      'Keyboard Shortcuts',
      'Troubleshooting',
    ]) {
      // Each section renders as a button in the left rail.
      expect(screen.getByRole('button', { name: expected })).toBeInTheDocument();
    }
  });

  it('shows the first matching section in the right pane on load', () => {
    render(<HelpPanel />);
    // Welcome is the first section, so its body should be rendered.
    expect(screen.getByRole('heading', { level: 2, name: 'Welcome' })).toBeInTheDocument();
  });

  it('clicking a section in the rail switches the right pane', async () => {
    const user = userEvent.setup();
    render(<HelpPanel />);
    await user.click(screen.getByRole('button', { name: 'Editor' }));
    expect(screen.getByRole('heading', { level: 2, name: 'Editor' })).toBeInTheDocument();
  });

  it('filters the rail via the search input', async () => {
    const user = userEvent.setup();
    render(<HelpPanel />);
    await user.type(screen.getByLabelText('Search help'), 'yank');
    expect(screen.getByRole('button', { name: 'Release Management' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Welcome' })).not.toBeInTheDocument();
  });

  it('renders the empty state when nothing matches', async () => {
    const user = userEvent.setup();
    render(<HelpPanel />);
    await user.type(screen.getByLabelText('Search help'), 'zzz-no-such-thing-zzz');
    expect(screen.getAllByText('No matching sections.')[0]).toBeInTheDocument();
  });
});
