import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { KeyValueRows, type KeyValueRow } from './KeyValueRows';

const baseRows: KeyValueRow[] = [
  { key: 'X-Trace', value: 'abc', enabled: true },
  { key: 'X-Disabled', value: 'no', enabled: false },
];

describe('KeyValueRows', () => {
  it('renders the empty hint when rows is empty', () => {
    const onChange = vi.fn();
    render(<KeyValueRows rows={[]} onChange={onChange} ariaLabel="Test" />);
    expect(screen.getByText(/No entries yet/)).toBeInTheDocument();
  });

  it('Add row appends a blank enabled entry', async () => {
    const onChange = vi.fn();
    render(<KeyValueRows rows={[]} onChange={onChange} ariaLabel="Test" />);
    await userEvent.click(screen.getByRole('button', { name: /Add row/ }));
    expect(onChange).toHaveBeenCalledWith([{ key: '', value: '', enabled: true }]);
  });

  it('toggling the enabled checkbox writes through onChange', async () => {
    const onChange = vi.fn();
    render(<KeyValueRows rows={baseRows} onChange={onChange} ariaLabel="Test" />);
    await userEvent.click(screen.getByLabelText('Enable row 1'));
    expect(onChange).toHaveBeenCalledWith([
      { key: 'X-Trace', value: 'abc', enabled: false },
      baseRows[1],
    ]);
  });

  it('typing in key + value emits the patched rows', async () => {
    const onChange = vi.fn();
    render(<KeyValueRows rows={baseRows} onChange={onChange} ariaLabel="Test" />);
    const keyInput = screen.getByLabelText('Test key 1');
    await userEvent.type(keyInput, '!');
    // userEvent.type fires multiple change events; just check the last one
    // landed in the right shape.
    expect(onChange).toHaveBeenCalled();
    const lastCall = onChange.mock.calls.at(-1)?.[0] as KeyValueRow[];
    expect(lastCall[0].key).toContain('!');
  });

  it('Delete row removes the entry by index', async () => {
    const onChange = vi.fn();
    render(<KeyValueRows rows={baseRows} onChange={onChange} ariaLabel="Test" />);
    await userEvent.click(screen.getByLabelText('Delete Test row 2'));
    expect(onChange).toHaveBeenCalledWith([baseRows[0]]);
  });

  it('renders the optional rightSlot for each row', () => {
    const onChange = vi.fn();
    const rightSlot = (row: KeyValueRow, idx: number) => (
      <span data-testid={`slot-${idx}`}>{row.key}</span>
    );
    render(
      <KeyValueRows rows={baseRows} onChange={onChange} ariaLabel="Test" rightSlot={rightSlot} />,
    );
    expect(screen.getByTestId('slot-0')).toHaveTextContent('X-Trace');
    expect(screen.getByTestId('slot-1')).toHaveTextContent('X-Disabled');
  });

  it('renders a datalist with key suggestions when keySuggestions is provided', () => {
    const onChange = vi.fn();
    const suggestions = (prefix: string) => [
      { name: `Suggested-${prefix}-A`, description: 'desc A' },
      { name: 'Suggested-B', description: 'desc B' },
    ];
    render(
      <KeyValueRows rows={[]} onChange={onChange} ariaLabel="Test" keySuggestions={suggestions} />,
    );
    const list = document.getElementById('Test-keys');
    expect(list).not.toBeNull();
    const options = list!.querySelectorAll('option');
    expect(options).toHaveLength(2);
    expect(options[0].getAttribute('value')).toMatch(/^Suggested-/);
  });
});
