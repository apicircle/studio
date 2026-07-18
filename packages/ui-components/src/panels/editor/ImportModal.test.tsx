import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

  it('detects an OpenAPI spec and imports it into a collection', async () => {
    render(<ImportModal open onClose={() => {}} />);
    const spec = JSON.stringify({
      openapi: '3.0.0',
      info: { title: 'Petstore', version: '1.0' },
      paths: { '/pets': { get: { responses: { '200': { description: 'ok' } } } } },
    });
    pasteInto(screen.getByLabelText('Import source'), spec);
    expect(await screen.findByText(/OpenAPI 3\)/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));
    await waitFor(() => {
      const reqs = Object.values(useWorkspaceStore.getState().synced!.collections.requests);
      expect(reqs.some((r) => r.url === '/pets' && r.operationId === 'GET /pets')).toBe(true);
    });
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

  it('auto-detects an API Circle folder export and renders the dependency preview', async () => {
    const envelope = {
      format: 'apicircle.folder/v1',
      exportedAt: '2026-06-02T00:00:00.000Z',
      appVersion: '1',
      source: { workspaceId: 'ws', folderId: 'f-root', folderName: 'Auth' },
      folder: {
        name: 'Auth',
        subfolders: [],
        requests: [
          {
            id: 'r-1',
            name: 'POST /login',
            folderId: 'f-root',
            method: 'POST',
            url: 'https://api.example.com/login',
            headers: [],
            query: [],
            body: { type: 'json', content: '{}' },
            auth: { type: 'none' },
            contextVars: [],
            extractions: [],
            assertions: [],
            createdAt: '2026-06-02T00:00:00.000Z',
            updatedAt: '2026-06-02T00:00:00.000Z',
          },
        ],
      },
      dependencies: {
        schemas: [
          {
            id: 's-1',
            name: 'LoginPayload',
            schema: '{}',
            createdAt: '2026-06-02T00:00:00.000Z',
            updatedAt: '2026-06-02T00:00:00.000Z',
          },
        ],
        graphql: [],
        files: [],
      },
    };
    render(<ImportModal open onClose={() => {}} />);
    pasteInto(screen.getByLabelText('Import source'), JSON.stringify(envelope));
    expect(await screen.findByText(/API Circle\)/)).toBeInTheDocument();
    expect(screen.getByText(/JSON schema/i)).toBeInTheDocument();
  });

  it('auto-detects an API Circle environment export and renders its preview', async () => {
    const envelope = {
      apicircleEnvironment: 1,
      name: 'staging',
      variables: [
        { key: 'API_BASE', value: 'https://api.staging.example.com', encrypted: false },
        { key: 'TOKEN', encrypted: true, secretKeyId: 'sec_abc' },
      ],
    };
    render(<ImportModal open onClose={() => {}} />);
    pasteInto(screen.getByLabelText('Import source'), JSON.stringify(envelope));
    expect(await screen.findByText(/API Circle environment\)/)).toBeInTheDocument();
    expect(screen.getByText('API_BASE')).toBeInTheDocument();
    expect(screen.getByText(/secret-bound/)).toBeInTheDocument();
  });

  it('imports an API Circle environment envelope into the workspace', async () => {
    const envelope = {
      apicircleEnvironment: 1,
      name: 'env-from-export',
      variables: [
        { key: 'API_BASE', value: 'https://api.example.test', encrypted: false },
        { key: 'TIMEOUT', value: '5000', encrypted: false },
      ],
    };
    const onClose = vi.fn();
    render(<ImportModal open onClose={onClose} />);
    pasteInto(screen.getByLabelText('Import source'), JSON.stringify(envelope));
    expect(await screen.findByText(/API Circle environment\)/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    const synced = useWorkspaceStore.getState().synced!;
    expect(synced.environments.items['env-from-export']).toBeDefined();
    expect(synced.environments.items['env-from-export']?.variables).toEqual([
      { key: 'API_BASE', value: 'https://api.example.test', encrypted: false },
      { key: 'TIMEOUT', value: '5000', encrypted: false },
    ]);
  });

  it('pushes a re-attach toast when an imported envelope includes file assets', async () => {
    const envelope = {
      format: 'apicircle.folder/v1',
      exportedAt: '2026-06-02T00:00:00.000Z',
      appVersion: '1',
      source: { workspaceId: 'ws', folderId: 'f-root', folderName: 'Files folder' },
      folder: {
        name: 'Files folder',
        subfolders: [],
        requests: [],
      },
      dependencies: {
        schemas: [],
        graphql: [],
        files: [
          {
            id: 'file-1',
            name: 'avatar',
            slotId: 'slot-x',
            filename: 'avatar.png',
            size: 1,
            mimeType: 'image/png',
            createdAt: '2026-06-02T00:00:00.000Z',
            updatedAt: '2026-06-02T00:00:00.000Z',
          },
        ],
      },
    };
    const onClose = vi.fn();
    render(<ImportModal open onClose={onClose} />);
    pasteInto(screen.getByLabelText('Import source'), JSON.stringify(envelope));
    expect(await screen.findByText(/API Circle\)/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));
    const toasts = useWorkspaceStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatchObject({
      tone: 'info',
      title: expect.stringContaining('Files folder'),
    });
    expect(toasts[0].detail).toMatch(/re-attach/i);
  });

  it('does not push a re-attach toast when no file assets are embedded', async () => {
    const envelope = {
      format: 'apicircle.folder/v1',
      exportedAt: '2026-06-02T00:00:00.000Z',
      appVersion: '1',
      source: { workspaceId: 'ws', folderId: 'f-root', folderName: 'Plain' },
      folder: { name: 'Plain', subfolders: [], requests: [] },
      dependencies: { schemas: [], graphql: [], files: [] },
    };
    const onClose = vi.fn();
    render(<ImportModal open onClose={onClose} />);
    pasteInto(screen.getByLabelText('Import source'), JSON.stringify(envelope));
    expect(await screen.findByText(/API Circle\)/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(useWorkspaceStore.getState().toasts).toHaveLength(0);
  });

  it('routes the "API Circle exchange" source to the env parser when the doc is an env export', async () => {
    const envelope = {
      apicircleEnvironment: 1,
      name: 'forced',
      variables: [{ key: 'K', value: 'v', encrypted: false }],
    };
    render(<ImportModal open onClose={() => {}} />);
    const dropdown = screen.getByLabelText(/Source/) as HTMLSelectElement;
    await userEvent.selectOptions(dropdown, 'apicircle');
    pasteInto(screen.getByLabelText('Import source'), JSON.stringify(envelope));
    expect(await screen.findByText(/API Circle environment\)/)).toBeInTheDocument();
  });

  it('switches to the bind step when an env import has unresolved encrypted bindings', async () => {
    const envelope = {
      apicircleEnvironment: 1,
      name: 'with-secrets',
      variables: [
        { key: 'API_BASE', value: 'https://api.example.com', encrypted: false },
        {
          key: 'TOKEN',
          encrypted: true,
          secretKeyId: 'sec_origin',
          secret: { label: 'PROD_TOKEN' },
        },
      ],
    };
    const onClose = vi.fn();
    render(<ImportModal open onClose={onClose} />);
    pasteInto(screen.getByLabelText('Import source'), JSON.stringify(envelope));
    expect(await screen.findByText(/API Circle environment\)/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));
    // The modal should NOT close yet — bind step takes over.
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText(/1 secret binding for/i)).toBeInTheDocument();
    expect(screen.getByText('PROD_TOKEN')).toBeInTheDocument();
    // Env is already persisted with the source's binding id preserved.
    const env = useWorkspaceStore.getState().synced!.environments.items['with-secrets']!;
    expect(env.variables[0]).toEqual({
      key: 'API_BASE',
      value: 'https://api.example.com',
      encrypted: false,
    });
    expect(env.variables[1]).toMatchObject({
      key: 'TOKEN',
      encrypted: true,
      secretKeyId: 'sec_origin',
    });
  });

  it('closes via Skip & finish without binding anything', async () => {
    const envelope = {
      apicircleEnvironment: 1,
      name: 'skip-env',
      variables: [
        {
          key: 'TOKEN',
          encrypted: true,
          secretKeyId: 'sec_origin',
          secret: { label: 'PROD_TOKEN' },
        },
      ],
    };
    const onClose = vi.fn();
    render(<ImportModal open onClose={onClose} />);
    pasteInto(screen.getByLabelText('Import source'), JSON.stringify(envelope));
    expect(await screen.findByText(/API Circle environment\)/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));
    await userEvent.click(screen.getByRole('button', { name: /Skip & finish/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
    // Env survives the skip — bindings stay unresolved until the user
    // fixes them under Environments.
    expect(useWorkspaceStore.getState().synced!.environments.items['skip-env']).toBeDefined();
    // An info toast was emitted so the skip isn't silent.
    expect(
      useWorkspaceStore
        .getState()
        .toasts.some((t) => t.tone === 'info' && /skipped/i.test(t.title ?? '')),
    ).toBe(true);
  });

  it('skips the bind step entirely when no encrypted rows are present', async () => {
    const envelope = {
      apicircleEnvironment: 1,
      name: 'no-secrets',
      variables: [{ key: 'PLAIN', value: 'ok', encrypted: false }],
    };
    const onClose = vi.fn();
    render(<ImportModal open onClose={onClose} />);
    pasteInto(screen.getByLabelText('Import source'), JSON.stringify(envelope));
    expect(await screen.findByText(/API Circle environment\)/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/secret binding/i)).not.toBeInTheDocument();
  });

  it('reuses an existing destination slot when the label matches (no bind step)', async () => {
    // Pre-seed a slot with label PROD_TOKEN on the destination — the
    // importer should re-point the row's secretKeyId to this slot and
    // skip the bind step.
    const synced = useWorkspaceStore.getState().synced!;
    useWorkspaceStore.setState({
      synced: {
        ...synced,
        secretKeys: {
          ...(synced.secretKeys ?? {}),
          sec_dest: {
            id: 'sec_dest',
            label: 'PROD_TOKEN',
            salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
            createdAt: '2026-06-02T00:00:00.000Z',
          },
        },
      },
    });
    const envelope = {
      apicircleEnvironment: 1,
      name: 'label-match',
      variables: [
        {
          key: 'TOKEN',
          encrypted: true,
          secretKeyId: 'sec_origin',
          secret: { label: 'PROD_TOKEN' },
        },
      ],
    };
    const onClose = vi.fn();
    render(<ImportModal open onClose={onClose} />);
    pasteInto(screen.getByLabelText('Import source'), JSON.stringify(envelope));
    expect(await screen.findByText(/API Circle environment\)/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/secret binding/i)).not.toBeInTheDocument();
    const env = useWorkspaceStore.getState().synced!.environments.items['label-match']!;
    expect(env.variables[0]).toMatchObject({
      key: 'TOKEN',
      encrypted: true,
      secretKeyId: 'sec_dest',
    });
  });

  it('imports an API Circle folder envelope into the workspace', async () => {
    const envelope = {
      format: 'apicircle.folder/v1',
      exportedAt: '2026-06-02T00:00:00.000Z',
      appVersion: '1',
      source: { workspaceId: 'ws', folderId: 'f-root', folderName: 'Auth' },
      folder: {
        name: 'Imported Auth',
        subfolders: [],
        requests: [
          {
            id: 'r-1',
            name: 'POST /login',
            folderId: 'f-root',
            method: 'POST',
            url: 'https://api.example.com/login',
            headers: [],
            query: [],
            body: { type: 'none', content: '' },
            auth: { type: 'none' },
            contextVars: [],
            extractions: [],
            assertions: [],
            createdAt: '2026-06-02T00:00:00.000Z',
            updatedAt: '2026-06-02T00:00:00.000Z',
          },
        ],
      },
      dependencies: { schemas: [], graphql: [], files: [] },
    };
    const onClose = vi.fn();
    render(<ImportModal open onClose={onClose} />);
    pasteInto(screen.getByLabelText('Import source'), JSON.stringify(envelope));
    expect(await screen.findByText(/API Circle\)/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    const synced = useWorkspaceStore.getState().synced!;
    const folder = Object.values(synced.collections.folders).find(
      (f) => f.name === 'Imported Auth',
    );
    expect(folder).toBeDefined();
    const requests = Object.values(synced.collections.requests).filter(
      (r) => r.folderId === folder?.id,
    );
    expect(requests.map((r) => r.name)).toEqual(['POST /login']);
  });
});
