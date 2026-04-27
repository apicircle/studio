import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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
