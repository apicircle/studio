import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { HelpPanel } from './HelpPanel';

describe('HelpPanel', () => {
  it('renders every section heading by default', () => {
    render(<HelpPanel />);
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
      expect(screen.getByRole('heading', { level: 2, name: expected })).toBeInTheDocument();
    }
  });

  it('filters sections via the search input', async () => {
    const user = userEvent.setup();
    render(<HelpPanel />);
    await user.type(screen.getByLabelText('Search help'), 'yank');
    expect(
      screen.getByRole('heading', { level: 2, name: 'Release Management' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2, name: 'Welcome' })).not.toBeInTheDocument();
  });

  it('renders the empty state when nothing matches', async () => {
    const user = userEvent.setup();
    render(<HelpPanel />);
    await user.type(screen.getByLabelText('Search help'), 'zzz-no-such-thing-zzz');
    expect(screen.getByText('No matching sections.')).toBeInTheDocument();
  });

  it('clearing the query restores all sections', async () => {
    const user = userEvent.setup();
    render(<HelpPanel />);
    const input = screen.getByLabelText('Search help');
    await user.type(input, 'yank');
    expect(screen.queryByRole('heading', { level: 2, name: 'Welcome' })).not.toBeInTheDocument();
    await user.clear(input);
    expect(screen.getByRole('heading', { level: 2, name: 'Welcome' })).toBeInTheDocument();
  });
});
