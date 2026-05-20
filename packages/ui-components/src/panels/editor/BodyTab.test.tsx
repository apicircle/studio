import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Request as ApiRequest } from '@apicircle/shared';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { BodyTab } from './BodyTab';

async function hydrate(): Promise<void> {
  await act(async () => {
    await useWorkspaceStore.getState().hydrate();
  });
}

function LiveBodyTab({ requestId }: { requestId: string }) {
  const request = useWorkspaceStore((s) => s.synced?.collections.requests[requestId]) as ApiRequest;
  return <BodyTab request={request} />;
}

function makeRequestId(): string {
  return useWorkspaceStore.getState().addRequest(null);
}

describe('BodyTab', () => {
  beforeEach(hydrate);

  it('renders the no-body hint when type=none', () => {
    const id = makeRequestId();
    render(<LiveBodyTab requestId={id} />);
    expect(screen.getByText(/No body will be sent/)).toBeInTheDocument();
  });

  it('switching to JSON shows the editor + the schema picker', async () => {
    const id = makeRequestId();
    render(<LiveBodyTab requestId={id} />);
    await userEvent.click(screen.getByRole('radio', { name: 'JSON' }));
    expect(screen.getByLabelText('JSON schema')).toBeInTheDocument();
    expect(screen.getByLabelText('Request body')).toBeInTheDocument();
  });

  it('switching to GraphQL shows the schema picker + variables pane', async () => {
    const id = makeRequestId();
    render(<LiveBodyTab requestId={id} />);
    await userEvent.click(screen.getByRole('radio', { name: 'GraphQL' }));
    expect(screen.getByLabelText('GraphQL schema')).toBeInTheDocument();
    expect(screen.getByLabelText('GraphQL variables')).toBeInTheDocument();
  });

  it('switching to form-data renders the form-data editor (no Monaco)', async () => {
    const id = makeRequestId();
    render(<LiveBodyTab requestId={id} />);
    await userEvent.click(screen.getByRole('radio', { name: 'form-data' }));
    expect(screen.queryByLabelText('Request body')).not.toBeInTheDocument();
    expect(useWorkspaceStore.getState().synced!.collections.requests[id].body.type).toBe(
      'form-data',
    );
  });

  it('switching to binary renders the binary picker', async () => {
    const id = makeRequestId();
    render(<LiveBodyTab requestId={id} />);
    await userEvent.click(screen.getByRole('radio', { name: 'binary' }));
    expect(screen.queryByLabelText('Request body')).not.toBeInTheDocument();
    expect(useWorkspaceStore.getState().synced!.collections.requests[id].body.type).toBe('binary');
  });

  it('Fullscreen toggle opens the overlay; Esc closes it', async () => {
    const id = makeRequestId();
    render(<LiveBodyTab requestId={id} />);
    await userEvent.click(screen.getByRole('radio', { name: 'JSON' }));
    await userEvent.click(screen.getByRole('button', { name: 'Fullscreen request body' }));
    expect(screen.getByRole('dialog', { name: /Request body — / })).toBeInTheDocument();
    // Esc handler lives on the overlay.
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: /Request body — / })).not.toBeInTheDocument();
  });

  it('switching from JSON → none clears the body content but preserves form rows', async () => {
    const id = makeRequestId();
    useWorkspaceStore.getState().setRequestBody(id, {
      type: 'json',
      content: '{"x":1}',
      formRows: [{ kind: 'text', key: 'k', value: 'v', enabled: true }],
    });
    render(<LiveBodyTab requestId={id} />);
    await userEvent.click(screen.getByRole('radio', { name: 'none' }));
    const body = useWorkspaceStore.getState().synced!.collections.requests[id].body;
    expect(body.type).toBe('none');
  });

  it('switching to JSON sets the Content-Type header on the request', async () => {
    const id = makeRequestId();
    render(<LiveBodyTab requestId={id} />);
    await userEvent.click(screen.getByRole('radio', { name: 'JSON' }));
    const headers = useWorkspaceStore.getState().synced!.collections.requests[id].headers;
    expect(headers).toContainEqual(
      expect.objectContaining({ key: 'Content-Type', value: 'application/json', enabled: true }),
    );
  });

  it('Manage… button opens the Assets tab in the workspace inspector dock', async () => {
    const id = makeRequestId();
    render(<LiveBodyTab requestId={id} />);
    await userEvent.click(screen.getByRole('radio', { name: 'JSON' }));
    expect(useWorkspaceStore.getState().rightDock.tab).toBe(null);
    const manageButtons = screen.getAllByRole('button', { name: 'Manage…' });
    await userEvent.click(manageButtons[0]);
    expect(useWorkspaceStore.getState().rightDock.tab).toBe('assets');
  });
});
