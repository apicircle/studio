import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Request as ApiRequest } from '@apicircle/shared';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { AssertionsTab } from './AssertionsTab';

async function hydrate(): Promise<void> {
  await act(async () => {
    await useWorkspaceStore.getState().hydrate();
  });
}

// Live wrapper that re-subscribes so the assertion list re-renders
// after each setRequestAssertions call. Without this, controlled
// inputs lose state between keystrokes.
function LiveAssertionsTab({ requestId }: { requestId: string }) {
  const request = useWorkspaceStore((s) => s.synced?.collections.requests[requestId]) as ApiRequest;
  return <AssertionsTab request={request} />;
}

function makeRequestId(): string {
  return useWorkspaceStore.getState().addRequest(null);
}

describe('AssertionsTab', () => {
  beforeEach(hydrate);

  it('renders the empty hint with no assertions', () => {
    const id = makeRequestId();
    render(<LiveAssertionsTab requestId={id} />);
    expect(screen.getByText(/No assertions yet/)).toBeInTheDocument();
  });

  it('Add assertion appends a default status=200 row', async () => {
    const id = makeRequestId();
    render(<LiveAssertionsTab requestId={id} />);
    await userEvent.click(screen.getByRole('button', { name: /Add assertion/ }));
    const updated = useWorkspaceStore.getState().synced!.collections.requests[id];
    expect(updated.assertions).toHaveLength(1);
    expect(updated.assertions[0]).toMatchObject({ kind: 'status', op: 'equals', expected: 200 });
  });

  it('changing kind to header reveals the target input', async () => {
    const id = makeRequestId();
    useWorkspaceStore
      .getState()
      .setRequestAssertions(id, [{ id: 'a-1', kind: 'status', op: 'equals', expected: 200 }]);
    render(<LiveAssertionsTab requestId={id} />);
    await userEvent.selectOptions(screen.getByLabelText('Assertion 1 kind'), 'header');
    expect(screen.getByLabelText('Assertion 1 target')).toBeInTheDocument();
  });

  it('coerces numeric input to a number; keeps non-numeric as a string', async () => {
    const id = makeRequestId();
    useWorkspaceStore
      .getState()
      .setRequestAssertions(id, [{ id: 'a-1', kind: 'status', op: 'equals', expected: 0 }]);
    const user = userEvent.setup();
    render(<LiveAssertionsTab requestId={id} />);
    const input = screen.getByLabelText('Assertion 1 expected');
    await user.tripleClick(input);
    await user.keyboard('404');
    expect(
      useWorkspaceStore.getState().synced!.collections.requests[id].assertions[0].expected,
    ).toBe(404);

    await user.tripleClick(input);
    await user.keyboard('not-a-number');
    const last =
      useWorkspaceStore.getState().synced!.collections.requests[id].assertions[0].expected;
    expect(typeof last).toBe('string');
    expect(last).toBe('not-a-number');
  });

  it('Remove assertion deletes the row', async () => {
    const id = makeRequestId();
    useWorkspaceStore
      .getState()
      .setRequestAssertions(id, [{ id: 'a-1', kind: 'status', op: 'equals', expected: 200 }]);
    render(<LiveAssertionsTab requestId={id} />);
    await userEvent.click(screen.getByLabelText('Remove assertion 1'));
    expect(useWorkspaceStore.getState().synced!.collections.requests[id].assertions).toEqual([]);
  });

  it('changing op via the operator select persists', async () => {
    const id = makeRequestId();
    useWorkspaceStore
      .getState()
      .setRequestAssertions(id, [{ id: 'a-1', kind: 'status', op: 'equals', expected: 200 }]);
    render(<LiveAssertionsTab requestId={id} />);
    await userEvent.selectOptions(screen.getByLabelText('Assertion 1 op'), 'lt');
    expect(useWorkspaceStore.getState().synced!.collections.requests[id].assertions[0].op).toBe(
      'lt',
    );
  });

  it('switching op to exists clears the value and swaps the input for a hint', async () => {
    const id = makeRequestId();
    useWorkspaceStore
      .getState()
      .setRequestAssertions(id, [
        { id: 'a-1', kind: 'json-path', op: 'equals', target: '$.id', expected: 5 },
      ]);
    render(<LiveAssertionsTab requestId={id} />);
    await userEvent.selectOptions(screen.getByLabelText('Assertion 1 op'), 'exists');
    const a0 = useWorkspaceStore.getState().synced!.collections.requests[id].assertions[0];
    expect(a0.op).toBe('exists');
    expect(a0.expected).toBe('');
    const expected = screen.getByLabelText('Assertion 1 expected');
    expect(expected.tagName).not.toBe('INPUT');
    expect(expected).toHaveTextContent('no value needed');
  });

  it('switching op to type seeds a JSON-type dropdown and persists a pick', async () => {
    const id = makeRequestId();
    useWorkspaceStore
      .getState()
      .setRequestAssertions(id, [
        { id: 'a-1', kind: 'json-path', op: 'equals', target: '$.id', expected: 5 },
      ]);
    render(<LiveAssertionsTab requestId={id} />);
    await userEvent.selectOptions(screen.getByLabelText('Assertion 1 op'), 'type');
    expect(
      useWorkspaceStore.getState().synced!.collections.requests[id].assertions[0].expected,
    ).toBe('string');
    await userEvent.selectOptions(screen.getByLabelText('Assertion 1 expected'), 'array');
    expect(
      useWorkspaceStore.getState().synced!.collections.requests[id].assertions[0].expected,
    ).toBe('array');
  });

  it('switching op to type keeps an already-valid type value', async () => {
    const id = makeRequestId();
    useWorkspaceStore
      .getState()
      .setRequestAssertions(id, [
        { id: 'a-1', kind: 'json-path', op: 'equals', target: '$.x', expected: 'number' },
      ]);
    render(<LiveAssertionsTab requestId={id} />);
    await userEvent.selectOptions(screen.getByLabelText('Assertion 1 op'), 'type');
    expect(
      useWorkspaceStore.getState().synced!.collections.requests[id].assertions[0].expected,
    ).toBe('number');
  });

  it('Backspace: isRowEmpty keeps structural rows, classifies shapes, and removes a blank one', () => {
    const id = makeRequestId();
    useWorkspaceStore.getState().setRequestAssertions(id, [
      { id: 'r-type', kind: 'json-path', op: 'type', target: '$.t', expected: 'string' }, // op type → keep
      { id: 'r-exists', kind: 'json-path', op: 'exists', target: '$.e', expected: '' }, // op exists → keep
      { id: 'r-status0', kind: 'status', op: 'equals', expected: 0 }, // target undefined, expected 0
      { id: 'r-status5', kind: 'status', op: 'equals', expected: 5 }, // expected non-empty, non-zero
      { id: 'r-path', kind: 'json-path', op: 'equals', target: '$.x', expected: 'v' }, // target non-empty
      { id: 'r-empty', kind: 'json-path', op: 'equals', target: '', expected: '' }, // blank → removable
    ]);
    render(<LiveAssertionsTab requestId={id} />);
    // Backspace each row's kind <select> — its value is never empty, so isRowEmpty runs
    // for every row shape without removing anything.
    for (let i = 1; i <= 6; i++) {
      fireEvent.keyDown(screen.getByLabelText(`Assertion ${i} kind`), { key: 'Backspace' });
    }
    expect(useWorkspaceStore.getState().synced!.collections.requests[id].assertions).toHaveLength(
      6,
    );
    // Backspacing the blank comparison row's empty target input DOES remove it.
    fireEvent.keyDown(screen.getByLabelText('Assertion 6 target'), { key: 'Backspace' });
    const rows = useWorkspaceStore.getState().synced!.collections.requests[id].assertions;
    expect(rows).toHaveLength(5);
    expect(rows.some((r) => r.id === 'r-empty')).toBe(false);
  });

  it('switching kind to json-schema sets the matches-schema op, offers only that op, and shows a schema editor', async () => {
    const id = makeRequestId();
    useWorkspaceStore
      .getState()
      .setRequestAssertions(id, [{ id: 'a-1', kind: 'status', op: 'equals', expected: 200 }]);
    render(<LiveAssertionsTab requestId={id} />);
    await userEvent.selectOptions(screen.getByLabelText('Assertion 1 kind'), 'json-schema');
    const row = useWorkspaceStore.getState().synced!.collections.requests[id].assertions[0];
    expect(row).toMatchObject({ kind: 'json-schema', op: 'matches-schema', expected: '{}' });
    // The op dropdown offers exactly one option for this kind.
    const opSelect = screen.getByLabelText('Assertion 1 op') as HTMLSelectElement;
    expect([...opSelect.options].map((o) => o.value)).toEqual(['matches-schema']);
    // A schema editor (textarea) is shown, seeded with the empty-object schema.
    const editor = screen.getByLabelText('Assertion 1 schema') as HTMLTextAreaElement;
    expect(editor.tagName).toBe('TEXTAREA');
    expect(editor.value).toBe('{}');
  });

  it('flags an invalid JSON schema and clears the error once valid', async () => {
    const id = makeRequestId();
    useWorkspaceStore
      .getState()
      .setRequestAssertions(id, [
        { id: 'a-1', kind: 'json-schema', op: 'matches-schema', expected: '{}' },
      ]);
    render(<LiveAssertionsTab requestId={id} />);
    const editor = screen.getByLabelText('Assertion 1 schema');
    fireEvent.change(editor, { target: { value: '{ not json' } });
    expect(screen.getByRole('alert')).toHaveTextContent('Schema is not valid JSON.');
    fireEvent.change(editor, { target: { value: '{ "type": "object" }' } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(
      useWorkspaceStore.getState().synced!.collections.requests[id].assertions[0].expected,
    ).toBe('{ "type": "object" }');
  });

  it('leaving json-schema resets the op to a plain equals comparison', async () => {
    const id = makeRequestId();
    useWorkspaceStore
      .getState()
      .setRequestAssertions(id, [
        { id: 'a-1', kind: 'json-schema', op: 'matches-schema', expected: '{"type":"object"}' },
      ]);
    render(<LiveAssertionsTab requestId={id} />);
    await userEvent.selectOptions(screen.getByLabelText('Assertion 1 kind'), 'status');
    expect(
      useWorkspaceStore.getState().synced!.collections.requests[id].assertions[0],
    ).toMatchObject({
      kind: 'status',
      op: 'equals',
      expected: '',
    });
  });
});
