import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TopBar } from './TopBar';
import { renderWithStore } from '../../test/renderWithStore';

describe('TopBar', () => {
  it('renders app brand', async () => {
    await renderWithStore(<TopBar />);
    expect(screen.getByText('API Circle Studio')).toBeInTheDocument();
  });

  it('shows workspace name when set (B.6 — via WorkspaceSwitcher button)', async () => {
    await renderWithStore(<TopBar />);
    // Default name from createEmptyWorkspace, exposed via the
    // WorkspaceSwitcher trigger button.
    expect(screen.getByRole('button', { name: /Switch workspace/ })).toHaveTextContent(
      'My Workspace',
    );
  });

  it('exposes Settings; dock entry points have moved to the right-edge rail', async () => {
    await renderWithStore(<TopBar />);
    expect(screen.getByRole('button', { name: /Open workspace settings/ })).toBeInTheDocument();
    // The Vault / Assets / Variables chips are gone from the top bar.
    expect(
      screen.queryByRole('button', { name: /Toggle Secret Vault in workspace inspector/ }),
    ).toBeNull();
    expect(
      screen.queryByRole('button', { name: /Toggle Global Assets in workspace inspector/ }),
    ).toBeNull();
    expect(
      screen.queryByRole('button', { name: /Toggle Variables in workspace inspector/ }),
    ).toBeNull();
    // Standalone Theme / Font chips are also gone — they're appearance
    // rows inside Settings now.
    expect(screen.queryByRole('button', { name: /Choose theme/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Choose font family/ })).toBeNull();
  });
});
