import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Request as ApiRequest } from '@apicircle/shared';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { RequestQuickView } from './RequestQuickView';

describe('RequestQuickView', () => {
  it('labels each group of params, at the 12px floor', async () => {
    await act(async () => {
      await useWorkspaceStore.getState().hydrate();
    });
    let request!: ApiRequest;
    act(() => {
      const id = useWorkspaceStore.getState().addRequest(null, 'List users');
      useWorkspaceStore
        .getState()
        .setRequestQuery(id, [{ key: 'page', value: '2', enabled: true }]);
      request = useWorkspaceStore.getState().synced!.collections.requests[id];
    });
    render(<RequestQuickView request={request} onClose={vi.fn()} />);
    expect(screen.getByText('Query', { selector: 'p' })).toHaveClass('text-xs');
    expect(screen.getByText('page')).toBeInTheDocument();
  });
});
