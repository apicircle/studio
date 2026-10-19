// The screen shown when the workspace cannot be loaded: what it says is still
// saved, and the three ways out (Retry, Recover, Reset), each of which shows it
// is running and says what happened when it fails.
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceLocal } from '@apicircle/shared';
import { App } from './App';
import { useWorkspaceStore, type HydrationError } from './store/workspaceStore';
import { LOCAL_STORE, deleteWorkspaceRecords, readRecord, writeRecord } from './persistence/db';
import * as storage from './persistence/workspaceStorage';

vi.mock('./persistence/workspaceStorage', async (importOriginal) => {
  const actual = await importOriginal<typeof storage>();
  return { ...actual, probeWorkspaceRecords: vi.fn(actual.probeWorkspaceRecords) };
});

const FAILURE: HydrationError = {
  message: 'The synced record is unreadable.',
  syncedWorkspaceId: null,
  localWorkspaceId: null,
};

/** Seed real records, then make every load fail with `error`. */
async function failToLoad(error: HydrationError = FAILURE): Promise<{ workspaceId: string }> {
  const { synced } = await storage.loadWorkspace();
  const hydrate = vi.fn(async () => {
    useWorkspaceStore.setState({ ready: false, hydrationError: error });
  });
  useWorkspaceStore.setState({ hydrate, ready: false, hydrationError: error });
  return { workspaceId: synced.workspaceId };
}

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(async () => {
  await storage.loadWorkspace();
});

describe('App — workspace recovery screen', () => {
  it('says what is still saved, with real counts, and offers no recovery when nothing is missing', async () => {
    await failToLoad();
    render(<App />);
    expect(await screen.findByText('Couldn’t load your workspace')).toBeInTheDocument();
    expect(screen.getByText('The synced record is unreadable.')).toBeInTheDocument();
    const saved = await screen.findByText(/^Still saved on this device for/);
    const box = saved.parentElement!;
    // The new-workspace sample request, and no environments — counted, not assumed.
    expect(box).toHaveTextContent(
      'Collections and environments: saved — 1 request, 0 environments',
    );
    expect(box).toHaveTextContent('History, vault and settings: saved');
    expect(box).not.toHaveTextContent('0 requests');
    expect(screen.queryByRole('button', { name: 'Recover existing data' })).toBeNull();
  });

  it('marks a missing half missing and offers to rebuild it', async () => {
    const { workspaceId } = await failToLoad();
    const synced = await readRecord<{ workspaceId: string }>('synced', workspaceId);
    await deleteWorkspaceRecords(workspaceId);
    await writeRecord('synced', synced!);
    render(<App />);
    expect(await screen.findByText('History, vault and settings: missing')).toBeInTheDocument();
    expect(
      screen.getByText(/^Collections and environments: saved — 1 request/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Recover existing data' })).toBeEnabled();
  });

  it('marks the collections missing when only this device’s half is left', async () => {
    const { workspaceId } = await failToLoad();
    const local = await readRecord<WorkspaceLocal>(LOCAL_STORE, workspaceId);
    await deleteWorkspaceRecords(workspaceId);
    await writeRecord(LOCAL_STORE, local!);
    render(<App />);
    expect(await screen.findByText('Collections and environments: missing')).toBeInTheDocument();
    expect(screen.getByText('History, vault and settings: saved')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Recover existing data' })).toBeEnabled();
  });

  it('says nothing is saved, and offers no recovery, when both halves are gone', async () => {
    const { workspaceId } = await failToLoad();
    await deleteWorkspaceRecords(workspaceId);
    render(<App />);
    expect(await screen.findByText('Couldn’t load your workspace')).toBeInTheDocument();
    await act(async () => {});
    expect(screen.queryByText(/^Still saved on this device/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Recover existing data' })).toBeNull();
    expect(screen.getByText(/resetting creates a brand-new workspace/)).toBeInTheDocument();
  });

  it('says only "saved" for a record whose contents cannot be counted', async () => {
    const { workspaceId } = await failToLoad();
    const local = await readRecord<WorkspaceLocal>(LOCAL_STORE, workspaceId);
    await deleteWorkspaceRecords(workspaceId);
    await writeRecord('synced', { workspaceId, collections: 'garbled' });
    await writeRecord(LOCAL_STORE, local!);
    render(<App />);
    expect(await screen.findByText('Collections and environments: saved')).toBeInTheDocument();
  });

  it('hides the "still saved" box when the probe itself fails', async () => {
    vi.mocked(storage.probeWorkspaceRecords).mockRejectedValueOnce(new Error('IDB is gone'));
    await failToLoad();
    render(<App />);
    expect(await screen.findByText('Couldn’t load your workspace')).toBeInTheDocument();
    await act(async () => {});
    expect(screen.queryByText(/^Still saved on this device/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
  });

  it('shows a Retry running, then says when it still did not load', async () => {
    await failToLoad();
    render(<App />);
    await screen.findByText('Couldn’t load your workspace');
    const gate = deferred();
    useWorkspaceStore.setState({
      hydrate: vi.fn(async () => {
        await gate.promise;
        useWorkspaceStore.setState({ hydrationError: { ...FAILURE } });
      }),
    });
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    const retrying = screen.getByRole('button', { name: 'Retrying…' });
    expect(retrying).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('button', { name: 'Reset workspace' })).toBeDisabled();
    await act(async () => gate.resolve());
    expect(await screen.findByText('Tried again — it still didn’t load.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
  });

  it('leaves the screen when a Retry loads the workspace', async () => {
    await failToLoad();
    render(<App />);
    await screen.findByText('Couldn’t load your workspace');
    const realHydrate = useWorkspaceStore.getInitialState().hydrate;
    useWorkspaceStore.setState({ hydrate: realHydrate });
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByText('API Circle Studio')).toBeInTheDocument());
  });

  describe('recovering a mismatched pair', () => {
    const MISMATCH: HydrationError = {
      message: 'The two records belong to different workspaces.',
      syncedWorkspaceId: 'a',
      localWorkspaceId: 'b',
    };

    it('runs Recover, and says so when there turned out to be nothing to recover', async () => {
      await failToLoad(MISMATCH);
      const gate = deferred<'recovered' | 'no-data'>();
      useWorkspaceStore.setState({ recoverPartialWorkspace: vi.fn(() => gate.promise) });
      render(<App />);
      await userEvent.click(await screen.findByRole('button', { name: 'Recover existing data' }));
      expect(screen.getByRole('button', { name: 'Recovering…' })).toHaveAttribute(
        'aria-busy',
        'true',
      );
      expect(screen.getByRole('button', { name: 'Retry' })).toBeDisabled();
      await act(async () => gate.resolve('no-data'));
      const notice = await screen.findByRole('dialog', { name: 'Recovery result' });
      expect(notice).toHaveTextContent('No recoverable data found. Use Reset to start fresh.');
      await userEvent.click(within(notice).getByRole('button', { name: 'OK' }));
      expect(screen.queryByRole('dialog', { name: 'Recovery result' })).toBeNull();
    });

    it('says what went wrong when Recover fails', async () => {
      await failToLoad(MISMATCH);
      useWorkspaceStore.setState({
        recoverPartialWorkspace: vi.fn().mockRejectedValue(new Error('quota exceeded')),
      });
      render(<App />);
      await userEvent.click(await screen.findByRole('button', { name: 'Recover existing data' }));
      expect(await screen.findByRole('dialog', { name: 'Recovery result' })).toHaveTextContent(
        'Couldn’t recover the workspace. quota exceeded',
      );
      expect(screen.getByRole('button', { name: 'Recover existing data' })).toBeEnabled();
    });

    it('leaves the screen when Recover rebuilds the pair', async () => {
      await failToLoad(MISMATCH);
      useWorkspaceStore.setState({
        recoverPartialWorkspace: vi.fn(async () => {
          useWorkspaceStore.setState({ hydrationError: null });
          return 'recovered' as const;
        }),
      });
      render(<App />);
      await userEvent.click(await screen.findByRole('button', { name: 'Recover existing data' }));
      await waitFor(() => expect(screen.queryByText('Couldn’t load your workspace')).toBeNull());
      expect(screen.queryByRole('dialog', { name: 'Recovery result' })).toBeNull();
    });
  });

  describe('resetting', () => {
    async function openReset() {
      render(<App />);
      await userEvent.click(await screen.findByRole('button', { name: 'Reset workspace' }));
      const dialog = await screen.findByRole('dialog', { name: 'Reset workspace?' });
      await userEvent.type(within(dialog).getByLabelText('Type to confirm'), 'RESET');
      return dialog;
    }

    it('keeps the confirm up, busy, while the reset runs', async () => {
      await failToLoad();
      const gate = deferred();
      useWorkspaceStore.setState({ resetWorkspace: vi.fn(() => gate.promise) });
      const dialog = await openReset();
      await userEvent.click(within(dialog).getByRole('button', { name: 'Reset workspace' }));
      const busy = within(dialog).getByRole('button', { name: 'Resetting…' });
      expect(busy).toBeDisabled();
      expect(busy).toHaveAttribute('aria-busy', 'true');
      expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled();
      await act(async () => gate.resolve());
    });

    it('closes the confirm and says why when the reset fails', async () => {
      await failToLoad();
      useWorkspaceStore.setState({ resetWorkspace: vi.fn().mockRejectedValue('disk full') });
      const dialog = await openReset();
      await userEvent.click(within(dialog).getByRole('button', { name: 'Reset workspace' }));
      expect(await screen.findByRole('dialog', { name: 'Recovery result' })).toHaveTextContent(
        'Couldn’t reset the workspace. disk full',
      );
      expect(screen.queryByRole('dialog', { name: 'Reset workspace?' })).toBeNull();
    });

    it('can be cancelled before it starts', async () => {
      await failToLoad();
      const reset = vi.fn();
      useWorkspaceStore.setState({ resetWorkspace: reset });
      const dialog = await openReset();
      await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByRole('dialog', { name: 'Reset workspace?' })).toBeNull();
      expect(reset).not.toHaveBeenCalled();
    });
  });
});

describe('App — boot', () => {
  it('waits on the brand mark while the workspace loads', async () => {
    const { container } = render(<App />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Loading workspace…');
    expect(container.querySelector('svg[data-brand-loader="full"]')).toHaveAttribute('width', '64');
    await waitFor(() => expect(screen.getByText('API Circle Studio')).toBeInTheDocument());
  });
});
