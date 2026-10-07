import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { Compass, Server } from 'lucide-react';
import { SectionLanding } from './SectionLanding';
import { SectionsProvider, type SectionDef } from './sections';
import { useWorkspaceStore } from '../store/workspaceStore';

const DISMISS_KEY = 'apicircle:section-landing-done-v1';

const studio: SectionDef = {
  id: 'studio',
  label: 'Studio',
  icon: Compass,
  description: 'Full API workspace',
  panelIds: ['editor'],
};
const lens: SectionDef = { id: 'lens', label: 'Lens', icon: Server, panelIds: ['lens.discover'] };

function renderLanding(setActiveSectionId = vi.fn()) {
  render(
    <SectionsProvider
      value={{ sections: [studio, lens], activeSectionId: 'studio', setActiveSectionId }}
    >
      <SectionLanding />
    </SectionsProvider>,
  );
  return { setActiveSectionId };
}

describe('SectionLanding', () => {
  beforeEach(() => localStorage.clear());

  it('renders a card per section (with the optional description)', () => {
    renderLanding();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Studio')).toBeInTheDocument();
    expect(screen.getByText('Full API workspace')).toBeInTheDocument();
    expect(screen.getByText('Lens')).toBeInTheDocument();
  });

  it('choosing a card sets the section and dismisses the landing', async () => {
    const { setActiveSectionId } = renderLanding();
    await userEvent.click(screen.getByText('Lens'));
    expect(setActiveSectionId).toHaveBeenCalledWith('lens');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(localStorage.getItem(DISMISS_KEY)).toBe('true');
  });

  it('choosing a card opens the section at its first panel', async () => {
    // A card is a fresh start: it opens the section's first panel whichever
    // panel the shell restored underneath the landing.
    useWorkspaceStore.getState().setActivePanel('history');
    renderLanding();
    await userEvent.click(screen.getByText('Lens'));
    expect(useWorkspaceStore.getState().activePanel).toBe('lens.discover');
  });

  it('choosing a card for a section with no panels leaves the panel alone', async () => {
    useWorkspaceStore.getState().setActivePanel('history');
    const setActiveSectionId = vi.fn();
    render(
      <SectionsProvider
        value={{
          sections: [studio, { ...lens, panelIds: [] }],
          activeSectionId: 'studio',
          setActiveSectionId,
        }}
      >
        <SectionLanding />
      </SectionsProvider>,
    );
    await userEvent.click(screen.getByText('Lens'));
    expect(setActiveSectionId).toHaveBeenCalledWith('lens');
    expect(useWorkspaceStore.getState().activePanel).toBe('history');
  });

  it('Skip dismisses without choosing a section', async () => {
    const { setActiveSectionId } = renderLanding();
    await userEvent.click(screen.getByRole('button', { name: /Skip/ }));
    expect(setActiveSectionId).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders null when already dismissed', () => {
    localStorage.setItem(DISMISS_KEY, 'true');
    renderLanding();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('is safe when localStorage is unavailable (SSR guard)', async () => {
    vi.stubGlobal('localStorage', undefined);
    renderLanding();
    expect(screen.getByRole('dialog')).toBeInTheDocument(); // not-dismissed default
    await userEvent.click(screen.getByRole('button', { name: /Skip/ })); // markDismissed no-op
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('treats a throwing localStorage as not-dismissed and dismiss as a no-op', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('x');
      },
      setItem: () => {
        throw new Error('x');
      },
    });
    const { setActiveSectionId } = renderLanding();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await userEvent.click(screen.getByText('Lens'));
    expect(setActiveSectionId).toHaveBeenCalledWith('lens');
    vi.unstubAllGlobals();
  });
});
