import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmDialog } from './ConfirmDialog';

describe('ConfirmDialog', () => {
  it('calls onConfirm when the user clicks confirm in the simple flow', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="Switch version"
        description="From v1 to v2."
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onConfirm).toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  describe('where it opens', () => {
    it('opens on Cancel when it has nothing else to say', async () => {
      render(
        <ConfirmDialog
          open
          title="Disconnect?"
          onConfirm={() => undefined}
          onCancel={() => undefined}
        />,
      );
      await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus());
    });

    it('opens on Cancel even when its description holds a control that comes first', async () => {
      // The modal focuses its first control. An option in the description is that
      // control, and a dialog that opens on it is one Space away from ticking it.
      render(
        <ConfirmDialog
          open
          title="Disconnect?"
          description={
            <label>
              <input type="checkbox" /> Also clear everything
            </label>
          }
          onConfirm={() => undefined}
          onCancel={() => undefined}
        />,
      );
      await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus());
      expect(screen.getByRole('checkbox')).not.toBeChecked();
    });

    it('opens on the field when a typed confirmation is asked for', async () => {
      render(
        <ConfirmDialog
          open
          title="Yank v1.3.0"
          typedConfirm="YANK"
          onConfirm={() => undefined}
          onCancel={() => undefined}
        />,
      );
      await waitFor(() => expect(screen.getByLabelText('Type to confirm')).toHaveFocus());
    });

    it('moves focus nowhere when it closes before it has been drawn', async () => {
      const view = render(
        <ConfirmDialog
          open
          title="Disconnect?"
          onConfirm={() => undefined}
          onCancel={() => undefined}
        />,
      );
      // Closed in the same tick: the focus that was queued finds no Cancel, and does nothing.
      view.rerender(
        <ConfirmDialog
          open={false}
          title="Disconnect?"
          onConfirm={() => undefined}
          onCancel={() => undefined}
        />,
      );
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('uses the supplied confirm/cancel labels', () => {
    render(
      <ConfirmDialog
        open={true}
        title="t"
        confirmLabel="Yank"
        cancelLabel="Keep"
        tone="danger"
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />,
    );
    expect(screen.getByRole('button', { name: 'Yank' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keep' })).toBeInTheDocument();
  });

  it('disables confirm until the user types the typedConfirm string verbatim', async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="Yank v1.3.0"
        typedConfirm="YANK v1.3.0"
        onConfirm={onConfirm}
        onCancel={() => undefined}
      />,
    );
    const button = screen.getByRole('button', { name: 'Confirm' });
    expect(button).toBeDisabled();

    const input = screen.getByLabelText('Type to confirm');
    await userEvent.type(input, 'YANK v1.3.0');
    expect(button).not.toBeDisabled();
    await userEvent.click(button);
    expect(onConfirm).toHaveBeenCalled();
  });

  it('clicking cancel does not invoke onConfirm', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ConfirmDialog open={true} title="t" onConfirm={onConfirm} onCancel={onCancel} />);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
