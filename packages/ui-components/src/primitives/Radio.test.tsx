import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Radio } from './Radio';

describe('Radio', () => {
  it('renders a real radio input', () => {
    render(<Radio aria-label="opt" name="g" value="a" />);
    expect(screen.getByRole('radio', { name: 'opt' })).toBeInTheDocument();
  });

  it('groups by name so only one is selected at a time', async () => {
    const onChange = vi.fn();
    render(
      <>
        <Radio name="db" value="postgres" label="Postgres" onChange={onChange} />
        <Radio name="db" value="mysql" label="MySQL" onChange={onChange} />
      </>,
    );
    const postgres = screen.getByRole('radio', { name: 'Postgres' });
    const mysql = screen.getByRole('radio', { name: 'MySQL' });
    await userEvent.click(postgres);
    expect(postgres).toBeChecked();
    await userEvent.click(mysql);
    expect(mysql).toBeChecked();
    expect(postgres).not.toBeChecked();
  });

  it('toggles by clicking the visible label', async () => {
    const onChange = vi.fn();
    render(<Radio name="g" value="a" label="Choice A" onChange={onChange} />);
    await userEvent.click(screen.getByText('Choice A'));
    expect(onChange).toHaveBeenCalledOnce();
  });

  it('renders a hint line', () => {
    render(<Radio name="g" value="a" label="Main" hint="the detail" />);
    expect(screen.getByText('the detail')).toBeInTheDocument();
  });

  it('renders bare when given neither label nor hint', () => {
    render(<Radio aria-label="bare" name="g" value="a" />);
    expect(screen.getByRole('radio', { name: 'bare' }).closest('label')).toBeNull();
  });

  it('dims the labelled row when disabled', () => {
    render(<Radio name="g" value="a" label="Off" disabled />);
    expect(screen.getByText('Off').closest('label')).toHaveClass('cursor-not-allowed');
  });
});
