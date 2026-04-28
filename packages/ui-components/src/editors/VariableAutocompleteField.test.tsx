import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ResolutionScope } from '@apicircle/core';
import { VariableAutocompleteField } from './VariableAutocompleteField';

const scope: ResolutionScope = {
  contextVars: { CTX_VAR: 'one' },
  activeEnv: { BASE_URL: 'https://api.example.com', TOKEN: 'tok' },
  priorityEnvs: [],
  secrets: { SECRET_KEY: 'irrelevant' },
};

function Harness({
  initial = '',
  onChangeSpy,
}: {
  initial?: string;
  onChangeSpy?: (v: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <VariableAutocompleteField
      value={value}
      onChange={(v) => {
        setValue(v);
        onChangeSpy?.(v);
      }}
      scope={scope}
      ariaLabel="URL"
    />
  );
}

describe('VariableAutocompleteField', () => {
  it('shows the listbox after `{{` is typed', async () => {
    render(<Harness />);
    const input = screen.getByLabelText('URL');
    await userEvent.click(input);
    await userEvent.type(input, '{{{{');
    expect(screen.getByRole('listbox', { name: 'URL suggestions' })).toBeInTheDocument();
    const options = screen.getAllByRole('option');
    const labels = options.map((o) => {
      const key = o.querySelector('span:first-child')?.textContent ?? '';
      const source = o.querySelector('span:last-child')?.textContent ?? '';
      return `${key} ${source}`.trim();
    });
    expect(labels).toEqual([
      'BASE_URL active-env',
      'CTX_VAR context',
      'SECRET_KEY secret',
      'TOKEN active-env',
    ]);
  });

  it('Tab inserts the highlighted suggestion', async () => {
    const spy = vi.fn();
    render(<Harness onChangeSpy={spy} />);
    const input = screen.getByLabelText('URL');
    await userEvent.click(input);
    await userEvent.type(input, '{{{{TOK');
    await userEvent.keyboard('{Tab}');
    expect(spy).toHaveBeenLastCalledWith('{{TOKEN}}');
  });

  it('Escape collapses the listbox', async () => {
    render(<Harness />);
    const input = screen.getByLabelText('URL');
    await userEvent.click(input);
    await userEvent.type(input, '{{{{');
    expect(screen.getByRole('listbox', { name: 'URL suggestions' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('clicking a suggestion inserts it', async () => {
    const spy = vi.fn();
    render(<Harness onChangeSpy={spy} />);
    const input = screen.getByLabelText('URL');
    await userEvent.click(input);
    await userEvent.type(input, '{{{{');
    const option = screen.getByRole('option', { name: /CTX_VAR/ });
    await userEvent.click(option);
    expect(spy).toHaveBeenLastCalledWith('{{CTX_VAR}}');
  });
});
