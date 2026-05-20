// Verifies the linked-release-notes panel renders the cumulative changelog
// for a (fromVersion, toVersion] range, handles unpinned (fromVersion=null),
// shows yanked/deprecated badges, and stays empty when the linked ledger
// has no matching versions.

import { describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import type { ReleaseVersion } from '@apicircle/shared';
import { LinkedReleaseNotes } from './LinkedReleaseNotes';
import { useWorkspaceStore } from '../../store/workspaceStore';

function makeVersion(over: Partial<ReleaseVersion> & { version: string }): ReleaseVersion {
  return {
    publishedAt: over.publishedAt ?? '2026-01-01T00:00:00.000Z',
    notes: over.notes ?? '',
    workspaceSnapshot: over.workspaceSnapshot ?? 'sha',
    deprecated: over.deprecated ?? false,
    yanked: over.yanked ?? false,
    ...over,
  };
}

async function renderWithLinkedReleases(
  versions: ReleaseVersion[],
  args: { from?: string | null; to: string },
): Promise<void> {
  // Hydrate the workspace store first, then inject the linked-release
  // ledger so it's present when the component first mounts. Re-renders
  // triggered by setState aren't always observed by zustand selectors in
  // jsdom, so the safe path is "set state, THEN render".
  await act(async () => {
    await useWorkspaceStore.getState().hydrate();
    const state = useWorkspaceStore.getState();
    if (state.synced) {
      useWorkspaceStore.setState({
        synced: {
          ...state.synced,
          releases: {
            ...state.synced.releases,
            perLink: { 'link-1': { versions, currentVersion: args.to } },
          },
        },
      });
    }
  });
  render(
    <LinkedReleaseNotes
      linkedWorkspaceId="link-1"
      fromVersion={args.from ?? null}
      toVersion={args.to}
    />,
  );
}

describe('LinkedReleaseNotes', () => {
  it('renders nothing when the ledger is empty', async () => {
    await renderWithLinkedReleases([], { to: '1.0.0' });
    expect(screen.queryByText(/Release notes/)).toBeNull();
  });

  it('renders nothing when toVersion is unknown', async () => {
    await renderWithLinkedReleases([makeVersion({ version: '1.0.0', notes: 'first' })], {
      to: '2.0.0',
    });
    expect(screen.queryByText(/Release notes/)).toBeNull();
  });

  it('lists every version in the (from, to] range, newest first', async () => {
    await renderWithLinkedReleases(
      [
        makeVersion({ version: '1.0.0', notes: 'one' }),
        makeVersion({ version: '1.1.0', notes: 'two' }),
        makeVersion({ version: '2.0.0', notes: 'three' }),
      ],
      { from: '1.0.0', to: '2.0.0' },
    );
    // Header expands automatically only when versions.length === 1; we have
    // 2, so click to expand.
    const trigger = screen.getByRole('button', { name: /Release notes/ });
    act(() => {
      trigger.click();
    });
    // Newest first: 2.0.0 should appear before 1.1.0 in the DOM.
    const html = document.body.innerHTML;
    expect(html.indexOf('v2.0.0')).toBeGreaterThan(-1);
    expect(html.indexOf('v1.1.0')).toBeGreaterThan(-1);
    expect(html.indexOf('v2.0.0')).toBeLessThan(html.indexOf('v1.1.0'));
  });

  it('treats fromVersion=null as "all versions up to and including toVersion"', async () => {
    await renderWithLinkedReleases(
      [
        makeVersion({ version: '0.1.0', notes: 'first' }),
        makeVersion({ version: '0.2.0', notes: 'second' }),
      ],
      { from: null, to: '0.2.0' },
    );
    const trigger = screen.getByRole('button', { name: /Release notes/ });
    act(() => {
      trigger.click();
    });
    expect(screen.getByText('first')).toBeInTheDocument();
    expect(screen.getByText('second')).toBeInTheDocument();
  });

  it('renders yanked and deprecated chips', async () => {
    await renderWithLinkedReleases(
      [
        makeVersion({ version: '1.0.0', notes: 'first', deprecated: true }),
        makeVersion({ version: '2.0.0', notes: 'second', yanked: true }),
      ],
      { from: null, to: '2.0.0' },
    );
    const trigger = screen.getByRole('button', { name: /Release notes/ });
    act(() => {
      trigger.click();
    });
    expect(screen.getAllByText(/yanked/i)[0]).toBeInTheDocument();
    expect(screen.getAllByText(/deprecated/i)[0]).toBeInTheDocument();
  });

  it('auto-opens when there is exactly one version in range', async () => {
    await renderWithLinkedReleases(
      [
        makeVersion({ version: '1.0.0', notes: 'old' }),
        makeVersion({ version: '1.1.0', notes: 'new' }),
      ],
      { from: '1.0.0', to: '1.1.0' },
    );
    // Single new version — section should auto-expand and the note text
    // is in the DOM without a click.
    expect(screen.getByText('new')).toBeInTheDocument();
  });
});
