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

  describe('size scale', () => {
    it.each([
      ['xs', /h-6/],
      ['sm', /h-7/],
      ['md', /h-8/],
      ['lg', /h-9/],
    ] as const)('renders %s at the expected height', (size, expected) => {
      render(<Input size={size} aria-label={size} />);
      expect(screen.getByLabelText(size).className).toMatch(expected);
    });

    it('defaults to the sm height so it lines up with a default Button', () => {
      render(<Input aria-label="d" />);
      expect(screen.getByLabelText('d').className).toMatch(/h-7/);
    });
  });

  describe('invalid state', () => {
    it('sets aria-invalid and the danger border when invalid', () => {
      render(<Input invalid aria-label="bad" />);
      const el = screen.getByLabelText('bad');
      expect(el).toHaveAttribute('aria-invalid', 'true');
      expect(el.className).toMatch(/border-danger/);
    });

    it('omits aria-invalid when valid', () => {
      render(<Input aria-label="good" />);
      const el = screen.getByLabelText('good');
      expect(el).not.toHaveAttribute('aria-invalid');
      expect(el.className).toMatch(/border-border/);
    });
  });

  it("turns its edge and ring to the tone's readable colour on focus, accent or danger", () => {
    // Measured on every theme by apps/web's theme-contrast test (`FIELD_PARTS`):
    // the old 30% / 40% rings were under 3:1 on all 60 themes.
    render(
      <>
        <Input aria-label="good" />
        <Input invalid aria-label="bad" />
      </>,
    );
    const good = screen.getByLabelText('good');
    expect(good).toHaveClass('focus:ring-1', 'focus:border-accent-fg', 'focus:ring-accent-fg');
    expect(good).not.toHaveClass('focus:border-accent', 'focus:ring-accent/30');
    const bad = screen.getByLabelText('bad');
    expect(bad).toHaveClass('focus:border-danger-fg', 'focus:ring-danger-fg');
    expect(bad).not.toHaveClass('focus:border-danger', 'focus:ring-danger/40');
  });

  it('lets a call-site className override the base height', () => {
    render(<Input size="lg" className="h-7" aria-label="o" />);
    const el = screen.getByLabelText('o');
    expect(el.className).toMatch(/h-7/);
    expect(el.className).not.toMatch(/h-9/);
  });
});
