import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { ImportModal } from './ImportModal';

const POSTMAN_DOC = JSON.stringify({
  info: {
    name: 'Test API',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  item: [
    {
      name: 'List users',
      request: { method: 'GET', url: 'https://api.example.com/users' },
    },
  ],
});

const INSOMNIA_DOC = JSON.stringify({
  _type: 'export',
  __export_format: 4,
  resources: [
    {
      _type: 'workspace',
      _id: 'wrk_1',
      name: 'Imported Insomnia',
    },
    {
      _type: 'request',
      _id: 'req_1',
      name: 'Get users',
      method: 'GET',
      url: 'https://api.example.com/users',
      parentId: 'wrk_1',
    },
  ],
});

const CURL_INPUT = `curl -X POST https://api.example.test/users -H 'X-Auth: t' --json '{"a":1}'`;

async function hydrate(): Promise<void> {
  await act(async () => {
    await useWorkspaceStore.getState().hydrate();
  });
}

/**
 * `userEvent.type` interprets `{` and `}` as keyboard-shortcut delimiters,
 * which fights tests that paste JSON or cURL strings. This helper drives
 * the textarea via the React-friendly value setter + an input event so the
 * controlled component sees the change.
 */
function pasteInto(textarea: HTMLElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    'value',
  )!.set!;
  setter.call(textarea, value);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('ImportModal — auto-detect', () => {
  beforeEach(hydrate);

  it('detects a Postman collection paste', async () => {
    render(<ImportModal open onClose={() => {}} />);
    pasteInto(screen.getByLabelText('Import source'), POSTMAN_DOC);
    // The detection-summary label sits inside the preview card; the
    // textarea also contains "Test API" via the JSON, so we just assert
    // the label suffix that's unique to detection.
    expect(await screen.findByText(/Postman\)/)).toBeInTheDocument();
  });

  it('detects an Insomnia v4 export', async () => {
    render(<ImportModal open onClose={() => {}} />);
    pasteInto(screen.getByLabelText('Import source'), INSOMNIA_DOC);
    expect(await screen.findByText(/Insomnia\)/)).toBeInTheDocument();
  });

  it('detects a cURL command and shows the parsed shape', async () => {
    render(<ImportModal open onClose={() => {}} />);
    pasteInto(screen.getByLabelText('Import source'), CURL_INPUT);
    expect(await screen.findByText(/cURL\)/)).toBeInTheDocument();
    expect(screen.getByText('POST')).toBeInTheDocument();
  });

  it('surfaces a parse error for non-JSON, non-cURL input', async () => {
    render(<ImportModal open onClose={() => {}} />);
    pasteInto(screen.getByLabelText('Import source'), 'just garbage');
    expect(await screen.findByRole('alert')).toHaveTextContent(/Couldn't parse JSON/i);
  });

  it('forces a format when the dropdown is set, ignoring auto-detect', async () => {
    render(<ImportModal open onClose={() => {}} />);
    const dropdown = screen.getByLabelText(/Source/) as HTMLSelectElement;
    await userEvent.selectOptions(dropdown, 'curl');
    pasteInto(screen.getByLabelText('Import source'), '{}');
    expect(await screen.findByRole('alert')).toHaveTextContent(/cURL/);
  });
});
