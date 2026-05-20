import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Request as ApiRequest } from '@apicircle/shared';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { HeadersTab } from './HeadersTab';

async function hydrate(): Promise<void> {
  await act(async () => {
    await useWorkspaceStore.getState().hydrate();
  });
}

function makeRequestId(): string {
  return useWorkspaceStore.getState().addRequest(null);
}

// Live wrapper that re-subscribes to the store so typing into a
// controlled input re-renders with the new value rather than freezing
// on the original prop snapshot.
function LiveHeadersTab({ requestId }: { requestId: string }) {
  const request = useWorkspaceStore((s) => s.synced?.collections.requests[requestId]) as ApiRequest;
  return <HeadersTab request={request} />;
}

describe('HeadersTab', () => {
  beforeEach(hydrate);

  it('shows the empty-state and the auto-fed API Circle headers aside', () => {
    const id = makeRequestId();
    render(<LiveHeadersTab requestId={id} />);
    expect(screen.getByText(/No headers yet/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Auto-fed headers')).toBeInTheDocument();
    expect(screen.getByText(/X-Client-Name/)).toBeInTheDocument();
    expect(screen.getByText(/X-Client-Platform/)).toBeInTheDocument();
    expect(screen.getByText(/X-Client-Version/)).toBeInTheDocument();
    expect(screen.getByText(/X-Trace-Span-Id/)).toBeInTheDocument();
    expect(screen.getByText(/traceparent/)).toBeInTheDocument();
  });

  it('Add row + edit key writes through to setRequestHeaders', async () => {
    const id = makeRequestId();
    const user = userEvent.setup();
    render(<LiveHeadersTab requestId={id} />);
    await user.click(screen.getByRole('button', { name: /Add row/ }));
    expect(useWorkspaceStore.getState().synced!.collections.requests[id].headers).toHaveLength(1);
    await user.type(screen.getByLabelText('Headers key 1'), 'Authorization');
    expect(useWorkspaceStore.getState().synced!.collections.requests[id].headers[0].key).toBe(
      'Authorization',
    );
  });

  it('typing a header prefix opens the rich suggestion listbox', async () => {
    const id = makeRequestId();
    const user = userEvent.setup();
    render(<LiveHeadersTab requestId={id} />);
    await user.click(screen.getByRole('button', { name: /Add row/ }));
    await user.type(screen.getByLabelText('Headers key 1'), 'Cont');
    const listbox = await screen.findByRole('listbox', { name: 'Header suggestions' });
    const options = listbox.querySelectorAll('[role="option"]');
    expect(options.length).toBeGreaterThan(0);
    // At least one match should mention Content-Type.
    expect(listbox.textContent).toMatch(/Content-Type/);
  });
});
