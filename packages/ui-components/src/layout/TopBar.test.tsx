import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Compass, Server } from 'lucide-react';
import { TopBar } from './TopBar';
import { renderWithStore } from '../../test/renderWithStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { SectionsProvider, type SectionsContextValue } from './sections';

describe('TopBar', () => {
  it('renders the product name, "API Circle", when no brand is passed', async () => {
    await renderWithStore(<TopBar />);
    expect(screen.getByText('API Circle')).toBeInTheDocument();
    // The retired name is nowhere in the bar.
    expect(screen.queryByText(/API Circle Studio/)).toBeNull();
  });

  it('renders the brand tagline', async () => {
    await renderWithStore(<TopBar />);
    expect(screen.getByText('Built in India. Open to world')).toBeInTheDocument();
  });

  it('renders an edition brand name and drops the tagline when null', async () => {
    await renderWithStore(<TopBar brand={{ name: 'Acme APIs', tagline: null }} />);
    expect(screen.getByText('Acme APIs')).toBeInTheDocument();
    expect(screen.queryByText('API Circle')).toBeNull();
    expect(screen.queryByText('Built in India. Open to world')).toBeNull();
  });

  it("renders the Lens editions' brand — the name alone", async () => {
    await renderWithStore(<TopBar brand={{ name: 'API Circle', tagline: null }} />);
    expect(screen.getByText('API Circle')).toBeInTheDocument();
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

  it("hands an edition's settingsCommunity={false} to Settings, which then has no Community section", async () => {
    const user = userEvent.setup();
    await renderWithStore(<TopBar settingsCommunity={false} />);
    await user.click(screen.getByRole('button', { name: /Open workspace settings/ }));
    expect(screen.getByRole('dialog', { name: 'Workspace settings' })).toBeInTheDocument();
    expect(screen.getByText('Behavior')).toBeInTheDocument();
    expect(screen.queryByText('Community')).toBeNull();
    expect(screen.queryByRole('link', { name: /Star on GitHub/ })).toBeNull();
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

  it('has no Lens link unless one is asked for — an edition that is Lens renders as before', async () => {
    const { container } = await renderWithStore(<TopBar />);
    expect(screen.queryByRole('link', { name: /Lens/ })).toBeNull();
    expect(container.querySelector('[data-lens-link]')).toBeNull();
    expect(farEnd(container)).toHaveLength(1);
  });

  it('with lensLink, starts with a "Lens" link to the website\'s Lens page, in a new tab', async () => {
    const { container } = await renderWithStore(<TopBar lensLink />);
    const lens = screen.getByRole('link', { name: 'Lens (opens in a new tab)' });
    expect(lens).toHaveAttribute('href', 'https://apicircle.dev/lens');
    // A new tab on the web; the desktop shell hands a new-window link to the
    // system browser. Either way the opened page gets no handle on this one.
    expect(lens).toHaveAttribute('target', '_blank');
    expect(lens).toHaveAttribute('rel', 'noopener noreferrer');
    // The word on it is "Lens"; the rest of its name is for screen readers.
    expect(lens.textContent).toBe('Lens (opens in a new tab)');
    expect(lens.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    // First in the far end, before Help.
    const help = screen.getByRole('button', { name: 'Help Center' });
    const items = farEnd(container);
    expect(items).toHaveLength(2);
    expect(items[0]).toContainElement(lens);
    expect(items[1]).toContainElement(help);
  });

  it('says where the Lens link goes on hover, without renaming it', async () => {
    const user = userEvent.setup();
    await renderWithStore(<TopBar lensLink />);
    const lens = screen.getByRole('link', { name: 'Lens (opens in a new tab)' });
    await user.hover(lens);
    expect(
      screen.getByRole('tooltip', { name: 'What Lens adds, on apicircle.dev' }),
    ).toBeInTheDocument();
    expect(lens).toHaveAccessibleName('Lens (opens in a new tab)');
    expect(lens).toHaveAccessibleDescription('What Lens adds, on apicircle.dev');
  });

  it('draws the Lens link only in the colours measured to read on every theme', async () => {
    // apps/web's theme-contrast.test.ts measures exactly these tokens on all of
    // the app's themes (`LENS_LINK` there); this holds the link to them.
    await renderWithStore(<TopBar lensLink />);
    const classes = screen
      .getByRole('link', { name: 'Lens (opens in a new tab)' })
      .className.split(/\s+/);
    expect(classes).toEqual(
      expect.arrayContaining([
        'text-text-primary',
        'bg-surface',
        'border-border',
        'hover:text-accent-fg',
        'hover:bg-accent/10',
        'hover:border-accent/40',
        'focus-visible:ring-accent-fg',
      ]),
    );
    // What it replaced: a label too faint on Tokyo Night Day, an edge that
    // vanished on Rose Pine, the bare accent as hover text (under 2:1 on Ayu
    // Light) and a ring at 70% of it (under 3:1 on 23 themes).
    const colours = classes.filter((c) => /(^|:)(text|bg|border|ring)-/.test(c));
    for (const replaced of [
      'text-text-muted',
      'border-border-subtle',
      'hover:text-accent',
      'focus-visible:ring-accent/70',
    ]) {
      expect(colours).not.toContain(replaced);
    }
    expect(colours.filter((c) => !c.includes(':')).sort()).toEqual([
      'bg-surface',
      'border-border',
      'text-text-primary',
      'text-xs',
    ]);
  });

  it("draws the Help button's focus ring and open icon in the accent's readable colour", async () => {
    // Measured on every theme by apps/web's theme-contrast test (`headerParts`):
    // a ring at 70% of the accent is under 3:1 against the bar on 23 themes, and
    // the bare accent on its tint under 3:1 on five.
    await renderWithStore(<TopBar />);
    const help = screen.getByRole('button', { name: 'Help Center' });
    expect(help).toHaveClass('focus-visible:ring-accent-fg');
    expect(help).not.toHaveClass('focus-visible:ring-accent/70');
    act(() => useWorkspaceStore.getState().setActivePanel('help'));
    expect(help).toHaveAttribute('aria-current', 'page');
    expect(help).toHaveClass('bg-accent/10', 'text-accent-fg');
    expect(help).not.toHaveClass('text-accent');
  });

  it("puts an edition's node after Help even with the Lens link", async () => {
    const { container } = await renderWithStore(
      <TopBar lensLink topBarEnd={<button type="button">Account</button>} />,
    );
    const items = farEnd(container);
    expect(items).toHaveLength(3);
    expect(items[0]).toContainElement(screen.getByRole('link', { name: /^Lens/ }));
    expect(items[1]).toContainElement(screen.getByRole('button', { name: 'Help Center' }));
    expect(items[2]).toBe(screen.getByRole('button', { name: 'Account' }));
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
