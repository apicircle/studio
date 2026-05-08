import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { HelpPanel } from './HelpPanel';
import { HelpSidebar } from './HelpSidebar';
import { renderWithStore } from '../../../test/renderWithStore';

// After the minor-fixes pass, the search + section list moved into
// `HelpSidebar` (rendered by Sidebar.tsx in the standard resizable shell)
// and `HelpPanel` keeps just the article view. Tests render both so the
// shared workspace-store state (helpQuery, helpSectionId) ties them
// together exactly as it does at runtime.

function HelpFixture() {
  return (
    <>
      <HelpSidebar />
      <HelpPanel />
    </>
  );
}

describe('HelpPanel', () => {
  it('lists every section in the sidebar nav by default', async () => {
    await renderWithStore(<HelpFixture />);
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
      expect(screen.getByRole('button', { name: expected })).toBeInTheDocument();
    }
  });

  it('shows the first matching section in the right pane on load', async () => {
    await renderWithStore(<HelpFixture />);
    expect(screen.getByRole('heading', { level: 2, name: 'Welcome' })).toBeInTheDocument();
  });

  it('clicking a section in the rail switches the right pane', async () => {
    const user = userEvent.setup();
    await renderWithStore(<HelpFixture />);
    await user.click(screen.getByRole('button', { name: 'Editor' }));
    expect(screen.getByRole('heading', { level: 2, name: 'Editor' })).toBeInTheDocument();
  });

  it('filters the rail via the search input', async () => {
    const user = userEvent.setup();
    await renderWithStore(<HelpFixture />);
    await user.type(screen.getByLabelText('Search help'), 'yank');
    expect(screen.getByRole('button', { name: 'Release Management' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Welcome' })).not.toBeInTheDocument();
  });

  it('renders the empty state when nothing matches', async () => {
    const user = userEvent.setup();
    await renderWithStore(<HelpFixture />);
    await user.type(screen.getByLabelText('Search help'), 'zzz-no-such-thing-zzz');
    expect(screen.getAllByText('No matching sections.')[0]).toBeInTheDocument();
  });
});
