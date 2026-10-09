import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Compass, Server } from 'lucide-react';
import { TopBar } from './TopBar';
import { renderWithStore } from '../../test/renderWithStore';
import { useWorkspaceStore } from '../store/workspaceStore';
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

  it('renders an edition brand name and drops the tagline when null', async () => {
    await renderWithStore(<TopBar brand={{ name: 'API Circle', tagline: null }} />);
    expect(screen.getByText('API Circle')).toBeInTheDocument();
    expect(screen.queryByText('API Circle Studio')).toBeNull();
    expect(screen.queryByText('Built in India. Open to world')).toBeNull();
  });

  it('renders an edition brand with a custom tagline', async () => {
    await renderWithStore(<TopBar brand={{ name: 'API Circle', tagline: 'Design-first APIs' }} />);
    expect(screen.getByText('API Circle')).toBeInTheDocument();
    expect(screen.getByText('Design-first APIs')).toBeInTheDocument();
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

  it("carries no mode switch — an edition's modes are groups in the tab strip", async () => {
    // The switch used to sit at the right end of this bar. It is navigation, so
    // it lives with the tabs (`PanelTabs`); the bar must not grow a second one.
    const value: SectionsContextValue = {
      sections: [
        { id: 'studio', label: 'Studio', icon: Compass, panelIds: ['editor'] },
        { id: 'lens', label: 'Lens', icon: Server, panelIds: ['lens.discover'] },
      ],
      activeSectionId: 'studio',
      setActiveSectionId: () => {},
    };
    const { container } = await renderWithStore(
      <SectionsProvider value={value}>
        <TopBar />
      </SectionsProvider>,
    );
    expect(container.querySelector('[data-section-toggle]')).toBeNull();
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Lens' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Studio' })).toBeNull();
  });

  it('renders nothing beside the workspace switcher in Studio (no status passed)', async () => {
    await renderWithStore(<TopBar />);
    const switcher = screen.getByRole('button', { name: /Switch workspace/ });
    const settings = screen.getByRole('button', { name: /Open workspace settings/ });
    // The switcher's wrapper is followed directly by the settings picker's.
    expect(switcher.closest('.relative')!.nextElementSibling).toBe(settings.closest('.relative'));
  });

  it('renders an edition workspace status between the switcher and Settings', async () => {
    await renderWithStore(<TopBar workspaceStatus={<span data-testid="status">on main</span>} />);
    const status = screen.getByTestId('status');
    const switcher = screen.getByRole('button', { name: /Switch workspace/ });
    const settings = screen.getByRole('button', { name: /Open workspace settings/ });
    expect(switcher.closest('.relative')!.nextElementSibling).toBe(status);
    expect(status.nextElementSibling).toBe(settings.closest('.relative'));
  });
});

describe('TopBar far end', () => {
  /** What sits at the far end of the bar, left to right. */
  function farEnd(container: HTMLElement): Element[] {
    return [...container.querySelector('[data-top-bar-end]')!.children];
  }

  it('ends with Help, an icon named by its panel, in Studio (nothing passed)', async () => {
    const { container } = await renderWithStore(<TopBar />);
    const help = screen.getByRole('button', { name: 'Help Center' });
    // An icon alone: the name is the label, not text on the button.
    expect(help).toHaveTextContent('');
    expect(help.querySelector('svg')).not.toBeNull();
    // The tour finds a panel's entry by this hook, tab or not.
    expect(help).toHaveAttribute('data-tour', 'nav-help');
    expect(farEnd(container)).toHaveLength(1);
    expect(farEnd(container)[0]).toContainElement(help);
    // It is the last thing in the bar, after the workspace's own controls.
    const settings = screen.getByRole('button', { name: /Open workspace settings/ });
    expect(settings.compareDocumentPosition(help) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('opens the Help Center, and is the current page while it shows', async () => {
    const user = userEvent.setup();
    await renderWithStore(<TopBar />);
    const help = screen.getByRole('button', { name: 'Help Center' });
    expect(help).not.toHaveAttribute('aria-current');
    await user.click(help);
    expect(useWorkspaceStore.getState().activePanel).toBe('help');
    expect(help).toHaveAttribute('aria-current', 'page');
    // Pressing it again stays on help: it is a way in, not a toggle.
    await user.click(help);
    expect(useWorkspaceStore.getState().activePanel).toBe('help');
    act(() => useWorkspaceStore.getState().setActivePanel('editor'));
    expect(help).not.toHaveAttribute('aria-current');
  });

  it('says what the icon opens on hover, without renaming it', async () => {
    const user = userEvent.setup();
    await renderWithStore(<TopBar />);
    const help = screen.getByRole('button', { name: 'Help Center' });
    await user.hover(help);
    expect(screen.getByRole('tooltip', { name: 'Open the Help Center' })).toBeInTheDocument();
    expect(help).toHaveAccessibleName('Help Center');
  });

  it("renders an edition's node after Help, at the very end", async () => {
    const { container } = await renderWithStore(
      <TopBar topBarEnd={<button type="button">Account</button>} />,
    );
    const help = screen.getByRole('button', { name: 'Help Center' });
    const account = screen.getByRole('button', { name: 'Account' });
    const items = farEnd(container);
    expect(items).toHaveLength(2);
    expect(items[0]).toContainElement(help);
    expect(items[1]).toBe(account);
  });
});
