import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { SettingsPicker } from './SettingsPicker';
import { useWorkspaceStore } from '../store/workspaceStore';
import { renderWithStore } from '../../test/renderWithStore';

async function openSettings() {
  await renderWithStore(<SettingsPicker />);
  fireEvent.click(screen.getByRole('button', { name: /Open workspace settings/ }));
}

// Settings → Community mounts a component that fetches GitHub stats on
// open. Stub fetch with a benign empty response so the section renders
// its happy path without hitting the network in unrelated tests below.
function installCommunityFetchStub() {
  const empty = new Response(JSON.stringify({ stargazers_count: 0, open_issues_count: 0 }), {
    status: 200,
  });
  const release = new Response('{"message":"Not Found"}', { status: 404 });
  const search = new Response(JSON.stringify({ total_count: 0 }), { status: 200 });
  const contributors = new Response('[]', { status: 200 });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('/releases/latest')) return release.clone();
      if (url.includes('/contributors')) return contributors.clone();
      if (url.includes('/search/issues')) return search.clone();
      return empty.clone();
    }),
  );
}

describe('SettingsPicker — Community section', () => {
  beforeEach(() => {
    installCommunityFetchStub();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('mounts the Community section under Settings → Behavior', async () => {
    await openSettings();
    expect(screen.getByText('Community')).toBeInTheDocument();
    expect(screen.getByText(/Studio helping you ship/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Star on GitHub/ })).toHaveAttribute(
      'href',
      'https://github.com/apicircle/studio/stargazers',
    );
    expect(screen.getByRole('button', { name: /Refresh community stats/ })).toBeInTheDocument();
  });
});

describe('SettingsPicker — text size row', () => {
  beforeEach(() => {
    installCommunityFetchStub();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  it('renders the row with the current percentage', async () => {
    await openSettings();
    // Live region shows e.g. "100%" — anchor on the aria-live element via its
    // accessible label so the assertion isn't tripped up by the buttons.
    const live = screen.getByLabelText(/Current text size 100 percent/);
    expect(live).toHaveTextContent('100%');
  });

  it('Increase text size button bumps the workspace value by one step', async () => {
    await openSettings();
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /Increase text size/ }));
    });
    expect(useWorkspaceStore.getState().local!.ui.fontSizePercent).toBe(110);
  });

  it('Decrease text size button drops the workspace value by one step', async () => {
    await openSettings();
    act(() => {
      useWorkspaceStore.getState().setFontSizePercent(120);
    });
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /Decrease text size/ }));
    });
    expect(useWorkspaceStore.getState().local!.ui.fontSizePercent).toBe(110);
  });

  it('disables Decrease at the minimum and Increase at the maximum', async () => {
    await openSettings();
    act(() => {
      useWorkspaceStore.getState().setFontSizePercent(80);
    });
    expect(screen.getByRole('button', { name: /Decrease text size/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Increase text size/ })).not.toBeDisabled();

    act(() => {
      useWorkspaceStore.getState().setFontSizePercent(150);
    });
    expect(screen.getByRole('button', { name: /Increase text size/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Decrease text size/ })).not.toBeDisabled();
  });

  it('Reset is hidden at 100% and resets back to 100% when scaled', async () => {
    await openSettings();
    expect(screen.queryByRole('button', { name: /Reset text size/ })).toBeNull();

    act(() => {
      useWorkspaceStore.getState().setFontSizePercent(130);
    });
    const reset = screen.getByRole('button', { name: /Reset text size/ });
    act(() => {
      fireEvent.click(reset);
    });
    expect(useWorkspaceStore.getState().local!.ui.fontSizePercent).toBe(100);
  });
});
