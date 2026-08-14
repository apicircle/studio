import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SchemaAssertionEditor } from './SchemaAssertionEditor';

// Controlled harness: the component is fully controlled (value/onChange), so a
// wrapper holds state to reflect edits back into the editor.
function Controlled({
  initial = '{}',
  descriptor = 'assertion 1',
  onChangeSpy,
}: {
  initial?: string;
  descriptor?: string;
  onChangeSpy?: (v: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <SchemaAssertionEditor
      value={value}
      onChange={(v) => {
        setValue(v);
        onChangeSpy?.(v);
      }}
      descriptor={descriptor}
      modelPath="inmemory://apicircle/test/schema"
    />
  );
}

describe('SchemaAssertionEditor', () => {
  it('capitalizes the descriptor for the editor label and derives the toolbar labels', async () => {
    render(<Controlled descriptor="override assertion 2" />);
    await screen.findByTestId('monaco-editor-mock');
    expect(screen.getByLabelText('Override assertion 2 schema')).toBeInTheDocument();
    expect(screen.getByLabelText('Format schema for override assertion 2')).toBeInTheDocument();
    expect(screen.getByLabelText('Fullscreen schema for override assertion 2')).toBeInTheDocument();
  });

  it('valid JSON shows the valid pill and enables Format', async () => {
    render(<Controlled initial='{"type":"object"}' />);
    await screen.findByTestId('monaco-editor-mock');
    expect(screen.getByLabelText('Schema is valid JSON')).toBeInTheDocument();
    expect(screen.getByLabelText('Format schema for assertion 1')).toBeEnabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('invalid JSON shows the invalid pill + alert and disables Format', async () => {
    render(<Controlled initial="{ not json" />);
    await screen.findByTestId('monaco-editor-mock');
    expect(screen.getByLabelText('Schema is not valid JSON')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Not valid JSON');
    expect(screen.getByLabelText('Format schema for assertion 1')).toBeDisabled();
  });

  it('empty schema shows the hint, no pill, and a disabled Format', async () => {
    render(<Controlled initial="" />);
    await screen.findByTestId('monaco-editor-mock');
    expect(screen.getByText(/Empty schema matches anything/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Schema is valid JSON')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Schema is not valid JSON')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Format schema for assertion 1')).toBeDisabled();
  });

  it('editing the schema calls onChange with the new text', async () => {
    const spy = vi.fn();
    render(<Controlled initial="{}" onChangeSpy={spy} />);
    const editor = await screen.findByTestId('monaco-editor-mock');
    fireEvent.change(editor, { target: { value: '{"type":"array"}' } });
    expect(spy).toHaveBeenCalledWith('{"type":"array"}');
  });

  it('Format pretty-prints valid JSON through onChange', async () => {
    const spy = vi.fn();
    render(<Controlled initial='{"type":"object","required":["x"]}' onChangeSpy={spy} />);
    await screen.findByTestId('monaco-editor-mock');
    await userEvent.click(screen.getByLabelText('Format schema for assertion 1'));
    expect(spy).toHaveBeenCalledWith(JSON.stringify({ type: 'object', required: ['x'] }, null, 2));
  });

  it('Expand opens a fullscreen overlay; Esc closes it', async () => {
    render(<Controlled initial="{}" />);
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
});
