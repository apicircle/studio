import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SecretInput } from './SecretInput';

describe('SecretInput', () => {
  it('starts as a password input', () => {
    render(<SecretInput value="" onChange={() => undefined} ariaLabel="Token" />);
    expect(screen.getByLabelText('Token')).toHaveAttribute('type', 'password');
  });

  it('toggles to text on the show button', async () => {
    render(<SecretInput value="abc" onChange={() => undefined} ariaLabel="Token" />);
    await userEvent.click(screen.getByRole('button', { name: 'Show Token' }));
    expect(screen.getByLabelText('Token')).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: 'Hide Token' })).toBeInTheDocument();
  });

  it('forwards typed input through onChange', async () => {
    const onChange = vi.fn();
    render(<SecretInput value="" onChange={onChange} ariaLabel="Token" />);
    await userEvent.type(screen.getByLabelText('Token'), 'q');
    expect(onChange).toHaveBeenCalledWith('q');
  });
});
