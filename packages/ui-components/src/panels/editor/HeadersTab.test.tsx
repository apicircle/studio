import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Request as ApiRequest } from '@apicircle-v2/shared';
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

  it('renders KeyValueRows + a datalist of header suggestions', () => {
    const id = makeRequestId();
    render(<LiveHeadersTab requestId={id} />);
    expect(screen.getByText(/No entries yet/)).toBeInTheDocument();
    const list = document.getElementById('Headers-keys');
    expect(list).not.toBeNull();
    expect(list!.querySelectorAll('option').length).toBeGreaterThan(0);
  });

  it('Add row + edit values writes through to setRequestHeaders', async () => {
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
});
