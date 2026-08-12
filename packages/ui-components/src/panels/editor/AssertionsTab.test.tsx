import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Request as ApiRequest, RequestRun } from '@apicircle/shared';
import type { ExecutionResult } from '@apicircle/core';
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

/** Minimal `ExecutionResult` for seeding `lastRun` (the JSON-path picker gate reads body/bodyKind). */
function makeExecutionResult(overrides: Partial<ExecutionResult>): ExecutionResult {
  return {
    startedAt: '2026-04-27T12:00:00.000Z',
    durationMs: 1,
    status: 200,
    ok: true,
    statusText: 'OK',
    headers: {},
    body: '',
    bodyKind: 'empty',
    url: 'https://api.example.com/x',
    method: 'GET',
    authWarnings: [],
    ...overrides,
  };
}

/** Minimal `RequestRun` for seeding `local.history.requestRuns` (drives per-row verdict badges). */
function makeRun(overrides: Partial<RequestRun>): RequestRun {
  return {
    id: 'run',
    requestId: 'req',
    startedAt: '2026-04-27T12:00:00.000Z',
    durationMs: 1,
    status: 200,
    statusText: 'OK',
    ok: true,
    url: 'https://api.example.com/x',
    method: 'GET',
    requestHeaders: {},
    requestBodyPreview: null,
    responseHeaders: {},
    responseBodyPreview: '',
    responseBodyKind: 'empty',
    responseTruncated: false,
    assertions: [],
    ...overrides,
  };
}

/** Point `local.history.requestRuns` at the given runs (newest-first). */
function seedRequestRuns(runs: RequestRun[]): void {
  const local = useWorkspaceStore.getState().local!;
  useWorkspaceStore.setState({
    local: { ...local, history: { ...local.history, requestRuns: runs } },
  });
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
    const target = screen.getByLabelText('Assertion 1 target');
    expect(target).toBeInTheDocument();
    // Typing into the target field writes through to the assertion.
    await userEvent.type(target, 'Content-Type');
    expect(useWorkspaceStore.getState().synced!.collections.requests[id].assertions[0].target).toBe(
      'Content-Type',
    );
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
    const opSelect = screen.getByLabelText('Assertion 1 op');
    await userEvent.selectOptions(opSelect, 'lt');
    expect(useWorkspaceStore.getState().synced!.collections.requests[id].assertions[0].op).toBe(
      'lt',
    );
    // The op select participates in the row keyboard nav (no-op on a single row).
    fireEvent.keyDown(opSelect, { key: 'ArrowDown' });
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

  it('switching kind to json-schema sets the matches-schema op, offers only that op, and shows a Monaco schema editor', async () => {
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
    // A full-width JSON editor (Monaco, mocked as a textarea) is shown, seeded
    // with the empty-object schema, under a labelled wrapper.
    expect(screen.getByLabelText('Assertion 1 schema')).toBeInTheDocument();
    const editor = await screen.findByTestId('monaco-editor-mock');
    expect(editor).toHaveValue('{}');
    // The seed `{}` parses, so the validity pill reads valid and Format is enabled.
    expect(screen.getByLabelText('Schema is valid JSON')).toBeInTheDocument();
    expect(screen.getByLabelText('Format schema for assertion 1')).toBeEnabled();
  });

  it('flags an invalid JSON schema, disables Format, and clears the error once valid', async () => {
    const id = makeRequestId();
    useWorkspaceStore
      .getState()
      .setRequestAssertions(id, [
        { id: 'a-1', kind: 'json-schema', op: 'matches-schema', expected: '{}' },
      ]);
    render(<LiveAssertionsTab requestId={id} />);
    const editor = await screen.findByTestId('monaco-editor-mock');
    fireEvent.change(editor, { target: { value: '{ not json' } });
    expect(screen.getByRole('alert')).toHaveTextContent('Not valid JSON');
    expect(screen.getByLabelText('Schema is not valid JSON')).toBeInTheDocument();
    expect(screen.getByLabelText('Format schema for assertion 1')).toBeDisabled();
    fireEvent.change(editor, { target: { value: '{ "type": "object" }' } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Schema is valid JSON')).toBeInTheDocument();
    expect(
      useWorkspaceStore.getState().synced!.collections.requests[id].assertions[0].expected,
    ).toBe('{ "type": "object" }');
  });

  it('Format pretty-prints a valid but compact schema', async () => {
    const id = makeRequestId();
    useWorkspaceStore.getState().setRequestAssertions(id, [
      {
        id: 'a-1',
        kind: 'json-schema',
        op: 'matches-schema',
        expected: '{"type":"object","required":["name"]}',
      },
    ]);
    render(<LiveAssertionsTab requestId={id} />);
    await screen.findByTestId('monaco-editor-mock');
    await userEvent.click(screen.getByLabelText('Format schema for assertion 1'));
    expect(
      useWorkspaceStore.getState().synced!.collections.requests[id].assertions[0].expected,
    ).toBe(JSON.stringify({ type: 'object', required: ['name'] }, null, 2));
  });

  it('shows an empty-schema hint and disables Format when the schema is blank', async () => {
    const id = makeRequestId();
    useWorkspaceStore
      .getState()
      .setRequestAssertions(id, [
        { id: 'a-1', kind: 'json-schema', op: 'matches-schema', expected: '' },
      ]);
    render(<LiveAssertionsTab requestId={id} />);
    await screen.findByTestId('monaco-editor-mock');
    expect(screen.getByText(/Empty schema matches anything/)).toBeInTheDocument();
    expect(screen.getByLabelText('Format schema for assertion 1')).toBeDisabled();
    // No validity pill in the empty state (neither valid nor invalid).
    expect(screen.queryByLabelText('Schema is valid JSON')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Schema is not valid JSON')).not.toBeInTheDocument();
  });

  it('Expand opens a fullscreen schema overlay; Esc closes it', async () => {
    const id = makeRequestId();
    useWorkspaceStore
      .getState()
      .setRequestAssertions(id, [
        { id: 'a-1', kind: 'json-schema', op: 'matches-schema', expected: '{}' },
      ]);
    render(<LiveAssertionsTab requestId={id} />);
    await screen.findByTestId('monaco-editor-mock');
    await userEvent.click(screen.getByLabelText('Fullscreen schema for assertion 1'));
    expect(
      screen.getByRole('dialog', { name: /Expected JSON Schema — assertion 1/ }),
    ).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(
      screen.queryByRole('dialog', { name: /Expected JSON Schema — assertion 1/ }),
    ).not.toBeInTheDocument();
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

  it('renders per-row Pass/Fail verdict badges from the latest run', () => {
    const id = makeRequestId();
    useWorkspaceStore.getState().setRequestAssertions(id, [
      { id: 'a-pass', kind: 'status', op: 'equals', expected: 200 },
      { id: 'a-fail', kind: 'json-path', op: 'equals', target: '$.x', expected: 1 },
    ]);
    seedRequestRuns([
      makeRun({
        requestId: id,
        assertions: [
          {
            assertionId: 'a-pass',
            kind: 'status',
            op: 'equals',
            expected: 200,
            passed: true,
            detail: 'status: 200 equals 200',
          },
          {
            assertionId: 'a-fail',
            kind: 'json-path',
            op: 'equals',
            target: '$.x',
            expected: 1,
            passed: false,
            detail: 'expected 1, got 2',
          },
        ],
      }),
    ]);
    render(<LiveAssertionsTab requestId={id} />);
    expect(screen.getByText('Pass')).toBeInTheDocument();
    expect(screen.getByText('Fail')).toBeInTheDocument();
    expect(screen.getByLabelText('Last run: assertion passed')).toHaveAttribute(
      'title',
      'status: 200 equals 200',
    );
    expect(screen.getByLabelText('Last run: assertion failed')).toBeInTheDocument();
  });

  it('falls back to pass/fail wording in the verdict title when the run carries no detail', () => {
    const id = makeRequestId();
    useWorkspaceStore.getState().setRequestAssertions(id, [
      { id: 'a-pass', kind: 'status', op: 'equals', expected: 200 },
      { id: 'a-fail', kind: 'status', op: 'equals', expected: 200 },
    ]);
    seedRequestRuns([
      makeRun({
        requestId: id,
        assertions: [
          { assertionId: 'a-pass', kind: 'status', op: 'equals', expected: 200, passed: true },
          { assertionId: 'a-fail', kind: 'status', op: 'equals', expected: 200, passed: false },
        ],
      }),
    ]);
    render(<LiveAssertionsTab requestId={id} />);
    expect(screen.getByLabelText('Last run: assertion passed')).toHaveAttribute('title', 'passed');
    expect(screen.getByLabelText('Last run: assertion failed')).toHaveAttribute('title', 'failed');
  });

  it('updates only the targeted row in a multi-assertion list', async () => {
    const id = makeRequestId();
    useWorkspaceStore.getState().setRequestAssertions(id, [
      { id: 'a-1', kind: 'status', op: 'equals', expected: 200 },
      { id: 'a-2', kind: 'status', op: 'equals', expected: 200 },
    ]);
    render(<LiveAssertionsTab requestId={id} />);
    await userEvent.selectOptions(screen.getByLabelText('Assertion 2 op'), 'lt');
    const rows = useWorkspaceStore.getState().synced!.collections.requests[id].assertions;
    expect(rows[0].op).toBe('equals');
    expect(rows[1].op).toBe('lt');
  });

  it('enables the JSON-path picker when the last response is JSON and opens it', async () => {
    const id = makeRequestId();
    useWorkspaceStore
      .getState()
      .setRequestAssertions(id, [
        { id: 'a-1', kind: 'json-path', op: 'equals', target: '$.id', expected: 1 },
      ]);
    useWorkspaceStore.setState({
      lastRun: { [id]: makeExecutionResult({ body: '{"id":1}', bodyKind: 'json' }) },
    });
    render(<LiveAssertionsTab requestId={id} />);
    const picker = screen.getByLabelText('Pick JSON path for assertion 1');
    expect(picker).toBeEnabled();
    expect(picker).toHaveAttribute('title', 'Pick a JSON path from the last response');
    await userEvent.click(picker);
    expect(screen.getByRole('dialog', { name: 'Pick a JSON path' })).toBeInTheDocument();
    // Picking a node writes its path back into the assertion's target and dismisses the picker.
    await userEvent.click(screen.getByTitle('Pick $'));
    expect(useWorkspaceStore.getState().synced!.collections.requests[id].assertions[0].target).toBe(
      '$',
    );
    expect(screen.queryByRole('dialog', { name: 'Pick a JSON path' })).not.toBeInTheDocument();
  });

  it('disables the JSON-path picker with a hint when the last response is not JSON', () => {
    const id = makeRequestId();
    useWorkspaceStore
      .getState()
      .setRequestAssertions(id, [
        { id: 'a-1', kind: 'json-path', op: 'equals', target: '$.id', expected: 1 },
      ]);
    useWorkspaceStore.setState({
      lastRun: { [id]: makeExecutionResult({ body: 'plain text', bodyKind: 'text' }) },
    });
    render(<LiveAssertionsTab requestId={id} />);
    const picker = screen.getByLabelText('Pick JSON path for assertion 1');
    expect(picker).toBeDisabled();
    expect(picker).toHaveAttribute('title', 'Last response is not JSON');
  });

  it('flags an invalid regex for the matches op', () => {
    const id = makeRequestId();
    useWorkspaceStore
      .getState()
      .setRequestAssertions(id, [
        { id: 'a-1', kind: 'json-path', op: 'matches', target: '$.x', expected: '(unclosed' },
      ]);
    render(<LiveAssertionsTab requestId={id} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('requires a number for the lt/gt ops', () => {
    const id = makeRequestId();
    useWorkspaceStore
      .getState()
      .setRequestAssertions(id, [{ id: 'a-1', kind: 'status', op: 'lt', expected: 'abc' }]);
    render(<LiveAssertionsTab requestId={id} />);
    expect(screen.getByRole('alert')).toHaveTextContent('< and > require a number.');
  });

  it('surfaces a JSON-path target syntax error', () => {
    const id = makeRequestId();
    useWorkspaceStore
      .getState()
      .setRequestAssertions(id, [
        { id: 'a-1', kind: 'json-path', op: 'equals', target: '$[', expected: 1 },
      ]);
    render(<LiveAssertionsTab requestId={id} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
