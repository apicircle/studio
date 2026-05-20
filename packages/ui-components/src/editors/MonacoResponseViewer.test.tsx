import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MonacoResponseViewer } from './MonacoResponseViewer';

describe('MonacoResponseViewer', () => {
  it('pretty-prints JSON for readability', async () => {
    render(
      <MonacoResponseViewer
        value='{"a":1,"b":2}'
        contentType="application/json"
        ariaLabel="Response body"
      />,
    );
    expect(await screen.findByTestId('monaco-editor-mock')).toHaveValue(
      '{\n  "a": 1,\n  "b": 2\n}',
    );
  });

  it('passes through non-JSON values as-is', async () => {
    render(
      <MonacoResponseViewer
        value="<root><a>1</a></root>"
        contentType="application/xml"
        ariaLabel="Response body"
      />,
    );
    expect(await screen.findByTestId('monaco-editor-mock')).toHaveValue('<root><a>1</a></root>');
  });

  it('falls back to the raw text when JSON is malformed', async () => {
    render(
      <MonacoResponseViewer
        value='{"a": 1,'
        contentType="application/json"
        ariaLabel="Response body"
      />,
    );
    expect(await screen.findByTestId('monaco-editor-mock')).toHaveValue('{"a": 1,');
  });

  it('marks the editor read-only', async () => {
    render(<MonacoResponseViewer value="hello" ariaLabel="Response body" />);
    expect(await screen.findByTestId('monaco-editor-mock')).toHaveAttribute('readonly');
  });
});
