import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { DisabledReason } from './DisabledReason';

describe('DisabledReason', () => {
  it('explains a disabled control on hover', async () => {
    render(
      <DisabledReason reason="Push to save before opening a pull request.">
        <button type="button" disabled>
          Create PR
        </button>
      </DisabledReason>,
    );
    const tip = screen.getByRole('tooltip');
    expect(tip).toHaveTextContent('Push to save before opening a pull request.');
    expect(tip).toHaveClass('opacity-0');
    await userEvent.hover(screen.getByRole('button', { name: 'Create PR' }).parentElement!);
    expect(tip).toHaveClass('opacity-100');
    expect(screen.getByRole('button', { name: 'Create PR' })).toHaveAccessibleDescription(
      'Push to save before opening a pull request.',
    );
  });

  it('shows nothing for an enabled control, whatever reason it is given', () => {
    render(
      <DisabledReason reason="Push to save before opening a pull request.">
        <button type="button">Create PR</button>
      </DisabledReason>,
    );
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(screen.getByRole('button', { name: 'Create PR' })).not.toHaveAttribute(
      'aria-describedby',
    );
  });

  it.each([null, undefined, ''])(
    'shows nothing for a disabled control with no reason (%s)',
    (reason) => {
      render(
        <DisabledReason reason={reason}>
          <button type="button" disabled>
            Create PR
          </button>
        </DisabledReason>,
      );
      expect(screen.queryByRole('tooltip')).toBeNull();
    },
  );

  it('passes its classes to the wrapper, for a control that takes part in a row', () => {
    render(
      <DisabledReason reason="Why" className="flex-1">
        <button type="button" disabled>
          Go
        </button>
      </DisabledReason>,
    );
    expect(screen.getByRole('button', { name: 'Go' }).parentElement).toHaveClass('flex-1');
  });
});
