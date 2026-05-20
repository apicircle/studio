import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MonacoBodyEditor } from './MonacoBodyEditor';

describe('MonacoBodyEditor', () => {
  it('renders the mocked Monaco textarea with the body value', async () => {
    render(
      <MonacoBodyEditor
        value='{"hello":"world"}'
        bodyType="json"
        onChange={() => undefined}
        ariaLabel="Request body"
      />,
    );
    const textarea = await screen.findByTestId('monaco-editor-mock');
    expect(textarea).toHaveValue('{"hello":"world"}');
  });

  it('forwards typed input through onChange', async () => {
    const onChange = vi.fn();
    render(
      <MonacoBodyEditor value="" bodyType="json" onChange={onChange} ariaLabel="Request body" />,
    );
    const textarea = await screen.findByTestId('monaco-editor-mock');
    await userEvent.type(textarea, 'a');
    expect(onChange).toHaveBeenCalledWith('a');
  });

  it('respects readOnly', async () => {
    render(<MonacoBodyEditor value="hello" bodyType="text" readOnly ariaLabel="Request body" />);
    expect(await screen.findByTestId('monaco-editor-mock')).toHaveAttribute('readonly');
  });
});
