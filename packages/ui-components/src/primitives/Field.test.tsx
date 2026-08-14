import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Field } from './Field';

describe('Field', () => {
  it('wires the label to the control through the render-prop id', () => {
    render(<Field label="Email address">{(f) => <input type="email" {...f} />}</Field>);
    // The association is real: querying by the label finds the input.
    expect(screen.getByLabelText('Email address')).toHaveAttribute('type', 'email');
  });

  it('renders a hint and links it via aria-describedby', () => {
    render(
      <Field label="Token" hint="Stays on this device">
        {(f) => <input {...f} />}
      </Field>,
    );
    const input = screen.getByLabelText('Token');
    const describedby = input.getAttribute('aria-describedby');
    expect(describedby).toBeTruthy();
    expect(document.getElementById(describedby!)).toHaveTextContent('Stays on this device');
    expect(input).not.toHaveAttribute('aria-invalid');
  });

  it('renders an error, sets aria-invalid, and exposes it as an alert', () => {
    render(
      <Field label="Email" error="Enter a valid email address.">
        {(f) => <input {...f} />}
      </Field>,
    );
    const input = screen.getByLabelText('Email');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Enter a valid email address.');
    expect(input.getAttribute('aria-describedby')).toBe(alert.id);
  });

  it('prefers the error over the hint when both are present', () => {
    render(
      <Field label="X" hint="the hint" error="the error">
        {(f) => <input {...f} />}
      </Field>,
    );
    expect(screen.getByText('the error')).toBeInTheDocument();
    expect(screen.queryByText('the hint')).not.toBeInTheDocument();
  });

  it('marks the field required on the label', () => {
    render(
      <Field label="Name" required>
        {(f) => <input {...f} />}
      </Field>,
    );
    expect(screen.getByText('(required)')).toBeInTheDocument();
  });

  it('accepts a plain (non-function) child for composite controls', () => {
    render(
      <Field label="Group">
        <div data-testid="composite">custom</div>
      </Field>,
    );
    expect(screen.getByTestId('composite')).toHaveTextContent('custom');
  });

  it('lays out horizontally when asked', () => {
    const { container } = render(
      <Field label="On" orientation="horizontal">
        {(f) => <input type="checkbox" {...f} />}
      </Field>,
    );
    // horizontal uses an items-center row (flex default), not the vertical stack
    expect(container.firstChild).toHaveClass('items-center');
    expect(container.firstChild).not.toHaveClass('flex-col');
  });
});
