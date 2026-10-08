import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Modal } from './Modal';

describe('Modal', () => {
  it('renders nothing when closed', () => {
    render(
      <Modal open={false} onClose={() => {}}>
        Body
      </Modal>,
    );
    expect(screen.queryByText('Body')).not.toBeInTheDocument();
  });

  it('renders title and body when open', () => {
    render(
      <Modal open onClose={() => {}} title="Hi">
        Body
      </Modal>,
    );
    expect(screen.getByRole('dialog', { name: 'Hi' })).toBeInTheDocument();
    expect(screen.getByText('Body')).toBeInTheDocument();
  });

  it('calls onClose when backdrop is clicked', async () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose}>
        Body
      </Modal>,
    );
    // Click the backdrop (the parent div behind the dialog).
    const backdrop = screen.getByRole('presentation');
    await userEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('does not close when content is clicked', async () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose}>
        Body
      </Modal>,
    );
    await userEvent.click(screen.getByText('Body'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on Escape key', async () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose}>
        Body
      </Modal>,
    );
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
  });

  // A caller that holds a field's value re-renders on every keystroke, handing
  // the dialog a new inline `onClose` each time.
  describe('while its caller re-renders', () => {
    function Form({ onClosed }: { onClosed: (reason: string) => void }) {
      const [value, setValue] = useState('');
      return (
        <>
          <button type="button">Launcher</button>
          <Modal open onClose={() => onClosed(value)} title="Form">
            <button type="button">First control</button>
            <input aria-label="Message" value={value} onChange={(e) => setValue(e.target.value)} />
          </Modal>
        </>
      );
    }

    it('leaves focus in the field being typed in', async () => {
      render(<Form onClosed={() => {}} />);
      const field = screen.getByRole('textbox', { name: 'Message' });
      await userEvent.click(field);
      await userEvent.type(field, 'feat: users');
      // Every character landed: focus never left for the first control or the launcher.
      expect(field).toHaveValue('feat: users');
      expect(field).toHaveFocus();
    });

    it('closes through the latest onClose, not the one it opened with', async () => {
      const onClosed = vi.fn();
      render(<Form onClosed={onClosed} />);
      await userEvent.type(screen.getByRole('textbox', { name: 'Message' }), 'abc');
      await userEvent.keyboard('{Escape}');
      expect(onClosed).toHaveBeenCalledOnce();
      expect(onClosed).toHaveBeenCalledWith('abc');
    });
  });
});
