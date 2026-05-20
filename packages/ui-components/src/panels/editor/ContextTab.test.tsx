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
});
