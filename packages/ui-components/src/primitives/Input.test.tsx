import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Input } from './Input';

function ControlledHarness({ onValue }: { onValue: (v: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <Input
      aria-label="name"
      value={value}
      onChange={(e) => {
        setValue(e.target.value);
        onValue(e.target.value);
      }}
    />
  );
}

describe('Input', () => {
  it('forwards typed value via onChange', async () => {
    const onValue = vi.fn();
    render(<ControlledHarness onValue={onValue} />);
    await userEvent.type(screen.getByLabelText('name'), 'hi');
    expect(onValue).toHaveBeenLastCalledWith('hi');
  });

  it('respects the disabled prop', () => {
    render(<Input disabled aria-label="x" />);
    expect(screen.getByLabelText('x')).toBeDisabled();
  });
});
