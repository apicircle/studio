import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Request as ApiRequest } from '@apicircle/shared';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { ContextTab } from './ContextTab';

async function hydrate(): Promise<void> {
  await act(async () => {
    await useWorkspaceStore.getState().hydrate();
  });
}

function LiveContextTab({ requestId }: { requestId: string }) {
  const request = useWorkspaceStore((s) => s.synced?.collections.requests[requestId]) as ApiRequest;
  return <ContextTab request={request} />;
}

function makeRequestId(): string {
  return useWorkspaceStore.getState().addRequest(null);
}

describe('ContextTab', () => {
  beforeEach(hydrate);

  it('Add manual variable appends a row', async () => {
    const id = makeRequestId();
    render(<LiveContextTab requestId={id} />);
    await userEvent.click(screen.getByRole('button', { name: /Add manual variable/ }));
    expect(screen.getByLabelText('Context var 1 name')).toBeInTheDocument();
    const stored = useWorkspaceStore.getState().synced!.collections.requests[id].contextVars;
    expect(stored).toHaveLength(1);
  });

  it('typing into a manual variable persists into the synced doc', async () => {
    const id = makeRequestId();
    useWorkspaceStore.getState().setRequestContextVars(id, [{ key: '', value: '' }]);
    render(<LiveContextTab requestId={id} />);
    await userEvent.type(screen.getByLabelText('Context var 1 name'), 'BASE');
    const stored = useWorkspaceStore.getState().synced!.collections.requests[id].contextVars;
    expect(stored[0]?.key).toBe('BASE');
  });

  it('Add extractor appends a body-source row', async () => {
    const id = makeRequestId();
    render(<LiveContextTab requestId={id} />);
    await userEvent.click(screen.getByRole('button', { name: /Add extractor/ }));
    expect(screen.getByLabelText('Extraction 1 variable')).toBeInTheDocument();
    expect(screen.getByLabelText('Extraction 1 source')).toHaveValue('body');
  });

  it('changing extractor source to status disables the path input', async () => {
    const id = makeRequestId();
    useWorkspaceStore
      .getState()
      .setRequestExtractions(id, [
        { id: 'e1', variable: 'V', source: 'body', path: 'x', enabled: true },
      ]);
    render(<LiveContextTab requestId={id} />);
    await userEvent.selectOptions(screen.getByLabelText('Extraction 1 source'), 'status');
    expect(screen.getByLabelText('Extraction 1 path')).toBeDisabled();
  });

  describe('where a captured value lives', () => {
    function seed(): string {
      const id = makeRequestId();
      useWorkspaceStore.getState().setRequestExtractions(id, [
        { id: 'e1', variable: 'AUTH', source: 'body', path: 'data.token', enabled: true },
        { id: 'e2', variable: ' USER_ID ', source: 'body', path: 'data.id', enabled: true },
        { id: 'e3', variable: 'NEVER_RUN', source: 'body', path: 'x', enabled: true },
        { id: 'e4', variable: '', source: 'body', path: 'y', enabled: true },
      ]);
      const local = useWorkspaceStore.getState().local!;
      useWorkspaceStore.setState({
        local: { ...local, globalContext: { USER_ID: '42' } },
        heldContext: { AUTH: { value: 'tok-123', reason: 'named like a credential' } },
      });
      return id;
    }

    it('says a held value is in memory only, and why, and a saved one is on this device', () => {
      render(<LiveContextTab requestId={seed()} />);
      expect(
        screen.getByText(
          'In memory only: named like a credential. Not saved — Studio forgets it when it closes, so send this request again to capture it.',
        ),
      ).toBeInTheDocument();
      expect(screen.getAllByText('Saved on this device. Never pushed to Git.')).toHaveLength(1);
      // The value itself is never shown.
      expect(screen.queryByText(/tok-123/)).not.toBeInTheDocument();
    });

    it('says nothing for a variable with no captured value yet', () => {
      const id = seed();
      useWorkspaceStore.setState({ heldContext: {} });
      act(() => {
        useWorkspaceStore.setState({ local: null });
      });
      render(<LiveContextTab requestId={id} />);
      expect(screen.queryByText(/In memory only/)).not.toBeInTheDocument();
      expect(screen.queryByText(/Saved on this device/)).not.toBeInTheDocument();
    });
  });
});
