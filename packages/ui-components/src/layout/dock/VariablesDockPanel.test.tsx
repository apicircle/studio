import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { VariablesDockPanel } from './VariablesDockPanel';

// Values captured by extractors are listed apart from the request's own
// context vars, and one held in memory is masked and tagged "in memory".

const TOKEN = 'login-token-value';

function group(name: string): HTMLElement {
  const heading = screen.getByRole('heading', { name });
  return heading.closest('section') as HTMLElement;
}

describe('VariablesDockPanel — extracted values', () => {
  beforeEach(async () => {
    await act(async () => {
      await useWorkspaceStore.getState().hydrate();
    });
  });

  function seed(): void {
    act(() => {
      const s = useWorkspaceStore.getState();
      const id = s.addRequest(null);
      s.setRequestContextVars(id, [{ key: 'PAGE', value: '2' }]);
      s.setActiveRequestId(id);
      s.setActivePanel('editor');
      const local = useWorkspaceStore.getState().local!;
      useWorkspaceStore.setState({
        local: { ...local, globalContext: { ...local.globalContext, USER_ID: '42', PAGE: '9' } },
        heldContext: { AUTH: { value: TOKEN, reason: 'named like a credential' } },
      });
    });
  }

  it('groups captured values apart from the request’s own, and masks a held one', () => {
    seed();
    render(<VariablesDockPanel />);

    const extracted = group('Extracted from responses');
    expect(within(extracted).getByText('{{USER_ID}}')).toBeInTheDocument();
    expect(within(extracted).getByText('{{AUTH}}')).toBeInTheDocument();
    expect(within(extracted).getAllByText('in memory')).toHaveLength(1);
    expect(within(extracted).getByText('in memory')).toHaveAttribute(
      'title',
      'Held in memory only: named like a credential. Studio forgets it when it closes.',
    );
    expect(
      within(extracted).getByText(
        /Saved on this device, never pushed to Git; credentials are held/,
      ),
    ).toBeInTheDocument();

    // The request's own value wins over a capture of the same name, so it
    // stays with the request's context vars.
    const context = group('Context vars');
    expect(within(context).getByText('{{PAGE}}')).toBeInTheDocument();
    expect(within(extracted).queryByText('{{PAGE}}')).not.toBeInTheDocument();

    expect(screen.queryByText(new RegExp(TOKEN))).not.toBeInTheDocument();

    // The filter keeps the groups apart too.
    fireEvent.change(screen.getByLabelText('Filter variables'), { target: { value: 'user' } });
    expect(within(group('Extracted from responses')).getByText('{{USER_ID}}')).toBeInTheDocument();
    expect(screen.queryByText('{{AUTH}}')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Context vars' })).not.toBeInTheDocument();
  });

  it('lists a capture as extracted outside the editor, and a held one with no workspace open', () => {
    seed();
    act(() => useWorkspaceStore.getState().setActivePanel('history'));
    const { unmount } = render(<VariablesDockPanel />);
    expect(within(group('Extracted from responses')).getByText('{{PAGE}}')).toBeInTheDocument();
    unmount();

    act(() => useWorkspaceStore.setState({ local: null }));
    render(<VariablesDockPanel />);
    const extracted = group('Extracted from responses');
    expect(within(extracted).getByText('{{AUTH}}')).toBeInTheDocument();
    expect(within(extracted).getByText('in memory')).toBeInTheDocument();
  });
});
