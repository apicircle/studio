import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PassphrasePromptModal } from './PassphrasePromptModal';

describe('PassphrasePromptModal', () => {
  describe('setup mode', () => {
    it('requires a 12-char minimum and matching confirm before enabling submit', () => {
      const onSubmit = vi.fn().mockResolvedValue({ ok: true });
      const onCancel = vi.fn();
      render(
        <PassphrasePromptModal
          open
          mode="setup"
          workspaceName="My API"
          onSubmit={onSubmit}
          onCancel={onCancel}
        />,
      );

      const passInput = screen.getByLabelText('Workspace passphrase');
      const confirmInput = screen.getByLabelText('Confirm passphrase');
      const submit = screen.getByRole('button', { name: /Set passphrase/ });

      // Too short → submit disabled
      fireEvent.change(passInput, { target: { value: 'short' } });
      fireEvent.change(confirmInput, { target: { value: 'short' } });
      expect(submit).toBeDisabled();
      expect(screen.getByText(/at least 12 characters/i)).toBeInTheDocument();

      // Long enough but mismatched confirm → still disabled
      fireEvent.change(passInput, { target: { value: 'long-enough-passphrase' } });
      fireEvent.change(confirmInput, { target: { value: 'different-value-here' } });
      expect(submit).toBeDisabled();
      expect(screen.getByText(/do not match/i)).toBeInTheDocument();

      // Match → enabled
      fireEvent.change(confirmInput, { target: { value: 'long-enough-passphrase' } });
      expect(submit).not.toBeDisabled();
    });

    it('calls onSubmit with the entered passphrase when Set passphrase clicked', async () => {
      const onSubmit = vi.fn().mockResolvedValue({ ok: true });
      render(
        <PassphrasePromptModal open mode="setup" onSubmit={onSubmit} onCancel={() => undefined} />,
      );
      const passInput = screen.getByLabelText('Workspace passphrase');
      const confirmInput = screen.getByLabelText('Confirm passphrase');
      fireEvent.change(passInput, { target: { value: 'a-strong-passphrase' } });
      fireEvent.change(confirmInput, { target: { value: 'a-strong-passphrase' } });
      const submit = screen.getByRole('button', { name: /Set passphrase/ });
      fireEvent.click(submit);
      // Async submit; resolve the promise queue.
      await Promise.resolve();
      expect(onSubmit).toHaveBeenCalledWith('a-strong-passphrase');
    });
  });

  describe('unlock mode', () => {
    it('does not show the confirm field', () => {
      render(
        <PassphrasePromptModal
          open
          mode="unlock"
          onSubmit={() => Promise.resolve({ ok: true })}
          onCancel={() => undefined}
        />,
      );
      expect(screen.queryByLabelText('Confirm passphrase')).toBeNull();
      expect(screen.getByRole('button', { name: /Unlock/ })).toBeInTheDocument();
    });

    it('surfaces the reason returned by onSubmit when ok=false', async () => {
      const onSubmit = vi.fn().mockResolvedValue({ ok: false, reason: 'Wrong passphrase.' });
      render(
        <PassphrasePromptModal open mode="unlock" onSubmit={onSubmit} onCancel={() => undefined} />,
      );
      const passInput = screen.getByLabelText('Workspace passphrase');
      fireEvent.change(passInput, { target: { value: 'anything' } });
      fireEvent.click(screen.getByRole('button', { name: /Unlock/ }));
      // wait for the promise chain to settle
      await Promise.resolve();
      await Promise.resolve();
      expect(await screen.findByText(/Wrong passphrase/i)).toBeInTheDocument();
    });

    it('hides the Cancel button when cancellable=false', () => {
      render(
        <PassphrasePromptModal
          open
          mode="unlock"
          cancellable={false}
          onSubmit={() => Promise.resolve({ ok: true })}
          onCancel={() => undefined}
        />,
      );
      expect(screen.queryByRole('button', { name: /Cancel/ })).toBeNull();
    });
  });

  it('renders nothing when open=false', () => {
    const { container } = render(
      <PassphrasePromptModal
        open={false}
        mode="setup"
        onSubmit={() => Promise.resolve({ ok: true })}
        onCancel={() => undefined}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
