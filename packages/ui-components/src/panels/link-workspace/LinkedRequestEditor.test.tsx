import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import type { LinkedSnapshot, Request as ApiRequest } from '@apicircle/shared';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { LinkedRequestEditor } from './LinkedRequestEditor';

async function setup(): Promise<void> {
  await act(async () => {
    await useWorkspaceStore.getState().hydrate();
  });
  const synced = useWorkspaceStore.getState().synced!;
  const local = useWorkspaceStore.getState().local!;

  const sourceReq: ApiRequest = {
    id: 'src',
    name: 'Source request',
    folderId: null,
    method: 'GET',
    url: 'https://api.example.test/users/1',
    headers: [{ key: 'Accept', value: 'application/json', enabled: true }],
    query: [],
    body: { type: 'none', content: '' },
    auth: { type: 'none' },
    contextVars: [],
    extractions: [],
    assertions: [],
    createdAt: 't',
    updatedAt: 't',
  };
  const snapshot: LinkedSnapshot = {
    pulledAt: 't',
    ref: 'main',
    collections: {
      tree: { id: 'r', type: 'root', children: [{ kind: 'request', id: 'src' }] },
      requests: { src: sourceReq },
      folders: {},
    },
    environments: { items: {}, activeName: null, priorityOrder: [] },
  };

  useWorkspaceStore.setState({
    synced: {
      ...synced,
      linkedWorkspaces: {
        'link-1': {
          id: 'link-1',
          kind: 'private',
          name: 'Source workspace',
          sourceWorkspaceId: 'src-ws-link1',
          source: {
            provider: 'github',
            repoFullName: 'a/b',
            branch: 'main',
            sessionMode: 'workspace' as const,
          },
          scope: ['collections'],
          pinnedVersion: null,
          updatePolicy: 'manual',
          linkedAt: 't',
          requiredSecretKeyIds: [],
        },
      },
    },
    local: { ...local, linkedCollections: { 'link-1': snapshot } },
  });
}

describe('LinkedRequestEditor', () => {
  beforeEach(setup);

  it('renders nothing when no active linked request is set', () => {
    render(<LinkedRequestEditor />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders the source values pre-filled into editable fields when opened', async () => {
    useWorkspaceStore.getState().setActiveLinkedRequest({
      linkedWorkspaceId: 'link-1',
      itemId: 'src',
    });
    render(<LinkedRequestEditor />);
    expect(screen.getByRole('dialog', { name: /Linked request override/ })).toBeInTheDocument();
    // Method dropdown defaults to source's method.
    expect(screen.getByLabelText('Override method')).toHaveValue('GET');
    // URL input defaults to source's URL.
    expect(screen.getByLabelText('Override URL')).toHaveValue('https://api.example.test/users/1');
    // Name input defaults to source's name.
    expect(screen.getByLabelText('Override name')).toHaveValue('Source request');
  });

  it('typing in the URL field writes a url override; per-field reset clears it', async () => {
    useWorkspaceStore.getState().setActiveLinkedRequest({
      linkedWorkspaceId: 'link-1',
      itemId: 'src',
    });
    render(<LinkedRequestEditor />);
    const urlInput = screen.getByLabelText('Override URL');
    await userEvent.clear(urlInput);
    await userEvent.type(urlInput, 'https://staging.example.test/users/1');
    let stored = useWorkspaceStore.getState().synced!.linkedOverrides.requests['link-1:src'];
    expect(stored.patch.url).toBe('https://staging.example.test/users/1');
    // Per-field reset removes only the URL override, leaving other fields intact.
    await userEvent.click(screen.getByRole('button', { name: /Reset this field to source/ }));
    stored = useWorkspaceStore.getState().synced!.linkedOverrides.requests['link-1:src'];
    expect(stored?.patch.url).toBeUndefined();
  });

  it('changing the method writes a method override', async () => {
    useWorkspaceStore.getState().setActiveLinkedRequest({
      linkedWorkspaceId: 'link-1',
      itemId: 'src',
    });
    render(<LinkedRequestEditor />);
    await userEvent.selectOptions(screen.getByLabelText('Override method'), 'POST');
    const stored = useWorkspaceStore.getState().synced!.linkedOverrides.requests['link-1:src'];
    expect(stored.patch.method).toBe('POST');
  });

  it('typing into the override Headers section persists into the override patch', async () => {
    useWorkspaceStore.getState().setActiveLinkedRequest({
      linkedWorkspaceId: 'link-1',
      itemId: 'src',
    });
    render(<LinkedRequestEditor />);
    // The KeyValueRows component pre-populates with the source headers.
    // Replace the value of the first row.
    const valueInput = screen.getByLabelText('Override header value 1');
    await userEvent.clear(valueInput);
    await userEvent.type(valueInput, 'override-value');
    const stored = useWorkspaceStore.getState().synced!.linkedOverrides.requests['link-1:src'];
    expect(stored).toBeDefined();
    expect((stored.patch as { headers: Array<{ value: string }> }).headers[0]?.value).toBe(
      'override-value',
    );
  });

  it('Reset to source button clears the override after confirmation', async () => {
    useWorkspaceStore.getState().setLinkedRequestOverride('link-1', 'src', {
      headers: [{ key: 'X', value: '1', enabled: true }],
    });
    useWorkspaceStore.getState().setActiveLinkedRequest({
      linkedWorkspaceId: 'link-1',
      itemId: 'src',
    });
    render(<LinkedRequestEditor />);
    await userEvent.click(screen.getByRole('button', { name: 'Reset to source' }));
    await userEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(
      useWorkspaceStore.getState().synced!.linkedOverrides.requests['link-1:src'],
    ).toBeUndefined();
  });

  it('shows a fallback message when the snapshot is missing', () => {
    useWorkspaceStore.getState().setActiveLinkedRequest({
      linkedWorkspaceId: 'unknown',
      itemId: 'gone',
    });
    render(<LinkedRequestEditor />);
    expect(screen.getByText(/no longer available/)).toBeInTheDocument();
  });

  it('Add manual variable in the Override Context vars section persists', async () => {
    useWorkspaceStore.getState().setActiveLinkedRequest({
      linkedWorkspaceId: 'link-1',
      itemId: 'src',
    });
    render(<LinkedRequestEditor />);
    // Scope the "Add row" click to the "Override context vars" section so
    // we don't add a header row by mistake.
    const ctxSection = screen.getByLabelText('Override context vars');
    const addRowBtn = ctxSection.querySelector('button:last-child') as HTMLButtonElement;
    await userEvent.click(addRowBtn);
    await userEvent.type(screen.getByLabelText('Override context var 1 key'), 'X');
    await userEvent.type(screen.getByLabelText('Override context var 1 value'), '1');
    const patch = useWorkspaceStore.getState().synced!.linkedOverrides.requests['link-1:src']
      ?.patch as {
      contextVars?: Array<{ key: string; value: string }>;
    };
    expect(patch.contextVars).toEqual([{ key: 'X', value: '1' }]);
  });

  it('Add extractor in the Override extractor section persists', async () => {
    useWorkspaceStore.getState().setActiveLinkedRequest({
      linkedWorkspaceId: 'link-1',
      itemId: 'src',
    });
    render(<LinkedRequestEditor />);
    await userEvent.click(screen.getByRole('button', { name: /^Add extractor$/ }));
    await userEvent.type(screen.getByLabelText('Override extraction 1 variable'), 'TOKEN');
    await userEvent.type(screen.getByLabelText('Override extraction 1 path'), 'data.token');
    const patch = useWorkspaceStore.getState().synced!.linkedOverrides.requests['link-1:src']
      ?.patch as {
      extractions?: Array<{ variable: string; path: string }>;
    };
    expect(patch.extractions?.[0]).toMatchObject({ variable: 'TOKEN', path: 'data.token' });
  });

  it('changing override extraction source to status disables the path input', async () => {
    useWorkspaceStore.getState().setActiveLinkedRequest({
      linkedWorkspaceId: 'link-1',
      itemId: 'src',
    });
    render(<LinkedRequestEditor />);
    await userEvent.click(screen.getByRole('button', { name: /^Add extractor$/ }));
    await userEvent.selectOptions(screen.getByLabelText('Override extraction 1 source'), 'status');
    expect(screen.getByLabelText('Override extraction 1 path')).toBeDisabled();
  });

  it('Add assertion in the Override assertions section persists', async () => {
    useWorkspaceStore.getState().setActiveLinkedRequest({
      linkedWorkspaceId: 'link-1',
      itemId: 'src',
    });
    render(<LinkedRequestEditor />);
    await userEvent.click(screen.getByRole('button', { name: /^Add assertion$/ }));
    const patch = useWorkspaceStore.getState().synced!.linkedOverrides.requests['link-1:src']
      ?.patch as {
      assertions?: Array<{ kind: string; expected: number | string }>;
    };
    expect(patch.assertions?.[0]).toMatchObject({ kind: 'status', expected: 200 });
  });

  it('changing override assertion kind to header reveals the target input', async () => {
    useWorkspaceStore.getState().setActiveLinkedRequest({
      linkedWorkspaceId: 'link-1',
      itemId: 'src',
    });
    render(<LinkedRequestEditor />);
    await userEvent.click(screen.getByRole('button', { name: /^Add assertion$/ }));
    await userEvent.selectOptions(screen.getByLabelText('Override assertion 1 kind'), 'header');
    expect(screen.getByLabelText('Override assertion 1 target')).toBeInTheDocument();
  });

  it('changing override assertion kind to json-schema shows the schema editor + single op, and resets on switch-back', async () => {
    useWorkspaceStore
      .getState()
      .setActiveLinkedRequest({ linkedWorkspaceId: 'link-1', itemId: 'src' });
    render(<LinkedRequestEditor />);
    await userEvent.click(screen.getByRole('button', { name: /^Add assertion$/ }));
    await userEvent.selectOptions(
      screen.getByLabelText('Override assertion 1 kind'),
      'json-schema',
    );
    const op = screen.getByLabelText('Override assertion 1 op') as HTMLSelectElement;
    expect([...op.options].map((o) => o.value)).toEqual(['matches-schema']);
    // The schema editor (Monaco, mocked as a textarea) is shown, seeded with `{}`.
    expect(screen.getByLabelText('Override assertion 1 schema')).toBeInTheDocument();
    const editor = await screen.findByTestId('monaco-editor-mock');
    expect(editor).toHaveValue('{}');
    expect(screen.getByLabelText('Schema is valid JSON')).toBeInTheDocument();
    const patch = useWorkspaceStore.getState().synced!.linkedOverrides.requests['link-1:src']
      ?.patch as {
      assertions?: Array<{ kind: string; op: string; expected: string }>;
    };
    expect(patch.assertions?.[0]).toMatchObject({
      kind: 'json-schema',
      op: 'matches-schema',
      expected: '{}',
    });
    // Switching back to a scalar kind restores the scalar ops (no schema editor).
    await userEvent.selectOptions(screen.getByLabelText('Override assertion 1 kind'), 'status');
    expect(screen.queryByLabelText('Override assertion 1 schema')).toBeNull();
  });

  it('editing the json-schema override persists the schema text into the patch', async () => {
    useWorkspaceStore
      .getState()
      .setActiveLinkedRequest({ linkedWorkspaceId: 'link-1', itemId: 'src' });
    render(<LinkedRequestEditor />);
    await userEvent.click(screen.getByRole('button', { name: /^Add assertion$/ }));
    await userEvent.selectOptions(
      screen.getByLabelText('Override assertion 1 kind'),
      'json-schema',
    );
    const editor = await screen.findByTestId('monaco-editor-mock');
    fireEvent.change(editor, { target: { value: '{"type":"object"}' } });
    const patch = useWorkspaceStore.getState().synced!.linkedOverrides.requests['link-1:src']
      ?.patch as { assertions?: Array<{ expected: string }> };
    expect(patch.assertions?.[0]?.expected).toBe('{"type":"object"}');
  });

  it('numeric expected values are coerced to numbers; non-numeric stays string', async () => {
    useWorkspaceStore.getState().setActiveLinkedRequest({
      linkedWorkspaceId: 'link-1',
      itemId: 'src',
    });
    render(<LinkedRequestEditor />);
    await userEvent.click(screen.getByRole('button', { name: /^Add assertion$/ }));
    const expected = screen.getByLabelText('Override assertion 1 expected');
    await userEvent.tripleClick(expected);
    await userEvent.keyboard('404');
    let patch = useWorkspaceStore.getState().synced!.linkedOverrides.requests['link-1:src']
      ?.patch as {
      assertions?: Array<{ expected: number | string }>;
    };
    expect(patch.assertions?.[0]?.expected).toBe(404);

    await userEvent.tripleClick(expected);
    await userEvent.keyboard('not-a-number');
    patch = useWorkspaceStore.getState().synced!.linkedOverrides.requests['link-1:src']?.patch;
    expect(patch.assertions?.[0]?.expected).toBe('not-a-number');
  });

  it('override op exists hides the value; type offers a JSON-type dropdown', async () => {
    useWorkspaceStore
      .getState()
      .setActiveLinkedRequest({ linkedWorkspaceId: 'link-1', itemId: 'src' });
    render(<LinkedRequestEditor />);
    await userEvent.click(screen.getByRole('button', { name: /^Add assertion$/ }));
    await userEvent.selectOptions(screen.getByLabelText('Override assertion 1 op'), 'exists');
    expect(screen.getByLabelText('Override assertion 1 expected').tagName).toBe('SPAN');
    const read = () =>
      useWorkspaceStore.getState().synced!.linkedOverrides.requests['link-1:src']?.patch as {
        assertions?: Array<{ op: string; expected: string | number }>;
      };
    expect(read().assertions?.[0]).toMatchObject({ op: 'exists', expected: '' });

    await userEvent.selectOptions(screen.getByLabelText('Override assertion 1 op'), 'type');
    const typeSel = screen.getByLabelText('Override assertion 1 expected');
    expect(typeSel.tagName).toBe('SELECT');
    await userEvent.selectOptions(typeSel, 'array');
    expect(read().assertions?.[0]).toMatchObject({ op: 'type', expected: 'array' });
  });

  it('removing an extraction row drops it from the patch', async () => {
    useWorkspaceStore.getState().setLinkedRequestOverride('link-1', 'src', {
      extractions: [{ id: 'e1', variable: 'V', source: 'body', path: 'p', enabled: true }],
    });
    useWorkspaceStore.getState().setActiveLinkedRequest({
      linkedWorkspaceId: 'link-1',
      itemId: 'src',
    });
    render(<LinkedRequestEditor />);
    await userEvent.click(screen.getByRole('button', { name: 'Remove override extraction 1' }));
    const patch = useWorkspaceStore.getState().synced!.linkedOverrides.requests['link-1:src']
      ?.patch as {
      extractions?: Array<unknown>;
    };
    expect(patch.extractions).toEqual([]);
  });
});
