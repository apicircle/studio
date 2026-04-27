import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Request as ApiRequest } from '@apicircle-v2/shared';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { AssertionsTab } from './AssertionsTab';

async function hydrate(): Promise<void> {
  await act(async () => {
    await useWorkspaceStore.getState().hydrate();
  });
}

// Live wrapper that re-subscribes so the assertion list re-renders
// after each setRequestAssertions call. Without this, controlled
// inputs lose state between keystrokes.
function LiveAssertionsTab({ requestId }: { requestId: string }) {
  const request = useWorkspaceStore((s) => s.synced?.collections.requests[requestId]) as ApiRequest;
  return <AssertionsTab request={request} />;
}

function makeRequestId(): string {
  return useWorkspaceStore.getState().addRequest(null);
}

describe('AssertionsTab', () => {
  beforeEach(hydrate);

  it('renders the empty hint with no assertions', () => {
    const id = makeRequestId();
    render(<LiveAssertionsTab requestId={id} />);
    expect(screen.getByText(/No assertions yet/)).toBeInTheDocument();
  });

  it('Add assertion appends a default status=200 row', async () => {
    const id = makeRequestId();
    render(<LiveAssertionsTab requestId={id} />);
    await userEvent.click(screen.getByRole('button', { name: /Add assertion/ }));
    const updated = useWorkspaceStore.getState().synced!.collections.requests[id];
    expect(updated.assertions).toHaveLength(1);
    expect(updated.assertions[0]).toMatchObject({ kind: 'status', op: 'equals', expected: 200 });
  });

  it('changing kind to header reveals the target input', async () => {
    const id = makeRequestId();
    useWorkspaceStore
      .getState()
      .setRequestAssertions(id, [{ id: 'a-1', kind: 'status', op: 'equals', expected: 200 }]);
    render(<LiveAssertionsTab requestId={id} />);
    await userEvent.selectOptions(screen.getByLabelText('Assertion 1 kind'), 'header');
    expect(screen.getByLabelText('Assertion 1 target')).toBeInTheDocument();
  });

  it('coerces numeric input to a number; keeps non-numeric as a string', async () => {
    const id = makeRequestId();
    useWorkspaceStore
      .getState()
      .setRequestAssertions(id, [{ id: 'a-1', kind: 'status', op: 'equals', expected: 0 }]);
    const user = userEvent.setup();
    render(<LiveAssertionsTab requestId={id} />);
    const input = screen.getByLabelText('Assertion 1 expected');
    await user.tripleClick(input);
    await user.keyboard('404');
    expect(
      useWorkspaceStore.getState().synced!.collections.requests[id].assertions[0].expected,
    ).toBe(404);

    await user.tripleClick(input);
    await user.keyboard('not-a-number');
    const last =
      useWorkspaceStore.getState().synced!.collections.requests[id].assertions[0].expected;
    expect(typeof last).toBe('string');
    expect(last).toBe('not-a-number');
  });

  it('Remove assertion deletes the row', async () => {
    const id = makeRequestId();
    useWorkspaceStore
      .getState()
      .setRequestAssertions(id, [{ id: 'a-1', kind: 'status', op: 'equals', expected: 200 }]);
    render(<LiveAssertionsTab requestId={id} />);
    await userEvent.click(screen.getByLabelText('Remove assertion 1'));
    expect(useWorkspaceStore.getState().synced!.collections.requests[id].assertions).toEqual([]);
  });

  it('changing op via the operator select persists', async () => {
    const id = makeRequestId();
    useWorkspaceStore
      .getState()
      .setRequestAssertions(id, [{ id: 'a-1', kind: 'status', op: 'equals', expected: 200 }]);
    render(<LiveAssertionsTab requestId={id} />);
    await userEvent.selectOptions(screen.getByLabelText('Assertion 1 op'), 'lt');
    expect(useWorkspaceStore.getState().synced!.collections.requests[id].assertions[0].op).toBe(
      'lt',
    );
  });
});
