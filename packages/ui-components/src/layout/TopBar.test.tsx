import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Compass, Server } from 'lucide-react';
import { TopBar } from './TopBar';
import { renderWithStore } from '../../test/renderWithStore';
import { SectionsProvider, type SectionsContextValue } from './sections';

describe('TopBar', () => {
  it('renders app brand', async () => {
    await renderWithStore(<TopBar />);
    expect(screen.getByText('API Circle Studio')).toBeInTheDocument();
  });

  it('renders the brand tagline', async () => {
    await renderWithStore(<TopBar />);
    expect(screen.getByText('Built in India. Open to world')).toBeInTheDocument();
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

  it('renders no mode toggle in Studio (no sections — byte-identical top bar)', async () => {
    await renderWithStore(<TopBar />);
    expect(screen.queryByRole('tablist', { name: /Mode/ })).toBeNull();
  });

  it('renders a segmented toggle and switches section when >1 section', async () => {
    const setActiveSectionId = vi.fn();
    const value: SectionsContextValue = {
      sections: [
        { id: 'studio', label: 'Studio', icon: Compass, panelIds: ['editor'] },
        { id: 'lens', label: 'Lens', icon: Server, panelIds: ['lens.discover'] },
      ],
      activeSectionId: 'studio',
      setActiveSectionId,
    };
    await renderWithStore(
      <SectionsProvider value={value}>
        <TopBar />
      </SectionsProvider>,
    );
    expect(screen.getByRole('tablist', { name: /Mode/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Studio/ })).toHaveAttribute('aria-selected', 'true');
    await userEvent.click(screen.getByRole('tab', { name: /Lens/ }));
    expect(setActiveSectionId).toHaveBeenCalledWith('lens');
  });
});
