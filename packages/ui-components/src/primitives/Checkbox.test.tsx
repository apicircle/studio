import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Checkbox } from './Checkbox';

describe('Checkbox', () => {
  it('renders a real checkbox input', () => {
    render(<Checkbox aria-label="enable" />);
    expect(screen.getByRole('checkbox', { name: 'enable' })).toBeInTheDocument();
  });

  it('toggles and fires onChange', async () => {
    const onChange = vi.fn();
    render(<Checkbox label="Include tests" onChange={onChange} />);
    const box = screen.getByRole('checkbox', { name: 'Include tests' });
    expect(box).not.toBeChecked();
    await userEvent.click(box);
    expect(onChange).toHaveBeenCalledOnce();
  });

  it('associates the visible label with the input (clicking the text toggles it)', async () => {
    const onChange = vi.fn();
    render(<Checkbox label="Verify after apply" onChange={onChange} />);
    await userEvent.click(screen.getByText('Verify after apply'));
    expect(onChange).toHaveBeenCalledOnce();
  });

  it('renders a hint line', () => {
    render(<Checkbox label="Main" hint="the detail" />);
    expect(screen.getByText('the detail')).toBeInTheDocument();
  });

  it('does not fire when disabled', async () => {
    const onChange = vi.fn();
    render(<Checkbox label="Nope" disabled onChange={onChange} />);
    await userEvent.click(screen.getByText('Nope'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("draws the tick, its edge and the focus ring in the accent's readable colour", () => {
    // Measured on every theme by apps/web's theme-contrast test (`FIELD_PARTS`):
    // the bare accent's tick is under 3:1 on 10 themes, a 50% ring on 51.
    render(<Checkbox aria-label="tick" />);
    const input = screen.getByRole('checkbox', { name: 'tick' });
    const face = input.nextElementSibling;
    expect(face).toHaveClass(
      'peer-checked:border-accent-fg',
      'peer-checked:bg-accent/20',
      'peer-focus-visible:ring-accent-fg',
    );
    expect(face).not.toHaveClass('peer-checked:border-accent', 'peer-focus-visible:ring-accent/50');
    const tick = face?.nextElementSibling;
    expect(tick).toHaveClass('text-accent-fg', 'peer-checked:opacity-100');
    expect(tick).not.toHaveClass('text-accent');
  });

  it('renders bare (no label wrapper) when given neither label nor hint', () => {
    render(<Checkbox aria-label="bare" />);
    // The accessible name comes from aria-label, and there is no <label> wrapper.
    const box = screen.getByRole('checkbox', { name: 'bare' });
    expect(box.closest('label')).toBeNull();
  });
});
