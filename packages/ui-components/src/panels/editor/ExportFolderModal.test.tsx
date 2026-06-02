import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ExportFolderModal } from './ExportFolderModal';
import { renderWithStore } from '../../../test/renderWithStore';
import { useWorkspaceStore } from '../../store/workspaceStore';

async function hydrateEmpty(): Promise<void> {
  // renderWithStore hydrates the store + clears collections — we render
  // an empty placeholder once so each test starts from a known state.
  await renderWithStore(<div data-testid="bootstrap" />);
}

async function seedFolder(name: string): Promise<string> {
  let id = '';
  await act(async () => {
    id = useWorkspaceStore.getState().addFolder(null, name);
  });
  return id;
}

describe('ExportFolderModal', () => {
  it('renders nothing when folderId is null', async () => {
    await hydrateEmpty();
    render(<ExportFolderModal folderId={null} onClose={() => undefined} />);
    expect(screen.queryByRole('dialog', { name: 'Export folder as JSON' })).toBeNull();
  });

  it('shows an error state when the folder no longer exists', async () => {
    await hydrateEmpty();
    render(<ExportFolderModal folderId="ghost" onClose={() => undefined} download={() => true} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/Couldn't read the folder/i);
  });

  it('renders the summary card with folder name, counts, and format', async () => {
    await hydrateEmpty();
    const folderId = await seedFolder('Auth');
    render(
      <ExportFolderModal folderId={folderId} onClose={() => undefined} download={() => true} />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Export folder as JSON' });
    expect(within(dialog).getByText('Auth')).toBeInTheDocument();
    expect(within(dialog).getByText('apicircle.folder/v1')).toBeInTheDocument();
  });

  it('shows the "no dependencies" empty state when nothing is referenced', async () => {
    await hydrateEmpty();
    const folderId = await seedFolder('Auth');
    render(
      <ExportFolderModal folderId={folderId} onClose={() => undefined} download={() => true} />,
    );
    expect(
      screen.getByText(/No global JSON Schemas, GraphQL definitions, or file assets/i),
    ).toBeInTheDocument();
  });

  it('renders embedded JSON-schema dependencies with reuse hint', async () => {
    await hydrateEmpty();
    const folderId = await seedFolder('Auth');
    await act(async () => {
      const state = useWorkspaceStore.getState();
      const schemaId = state.addGlobalSchema({ name: 'User', schema: '{"type":"object"}' });
      const requestId = state.addRequest(folderId, 'POST /users');
      state.setRequestBodySchemaId(requestId, schemaId);
    });
    render(
      <ExportFolderModal folderId={folderId} onClose={() => undefined} download={() => true} />,
    );
    const section = screen.getByTestId('export-dependencies');
    expect(section).toHaveTextContent('JSON Schemas (1)');
    expect(section).toHaveTextContent('User');
    expect(section).toHaveTextContent('adds these to Global Assets');
  });

  it('renders embedded GraphQL dependencies with reuse hint', async () => {
    await hydrateEmpty();
    const folderId = await seedFolder('Catalog');
    await act(async () => {
      const state = useWorkspaceStore.getState();
      const gqlId = state.addGlobalGraphQL({ name: 'CatalogSchema' });
      const requestId = state.addRequest(folderId, 'POST /graphql');
      state.setRequestGraphqlSchemaId(requestId, gqlId);
    });
    render(
      <ExportFolderModal folderId={folderId} onClose={() => undefined} download={() => true} />,
    );
    const section = screen.getByTestId('export-dependencies');
    expect(section).toHaveTextContent('GraphQL definitions (1)');
    expect(section).toHaveTextContent('CatalogSchema');
    expect(section).toHaveTextContent('sdl');
  });

  it('renders file dependencies with a re-attach warning', async () => {
    await hydrateEmpty();
    const folderId = await seedFolder('Uploads');
    await act(async () => {
      const fileId = 'file-abc';
      const requestId = useWorkspaceStore.getState().addRequest(folderId, 'POST /upload');
      // Re-read AFTER addRequest so the spread keeps the freshly-added
      // request — capturing earlier and overwriting would drop it.
      const synced = useWorkspaceStore.getState().synced!;
      useWorkspaceStore.setState({
        synced: {
          ...synced,
          globalAssets: {
            ...synced.globalAssets,
            files: {
              ...synced.globalAssets.files,
              [fileId]: {
                id: fileId,
                name: 'avatar',
                slotId: 'slot-x',
                filename: 'avatar.png',
                size: 2048,
                mimeType: 'image/png',
                createdAt: synced.meta.createdAt,
                updatedAt: synced.meta.createdAt,
              },
            },
          },
        },
      });
      useWorkspaceStore.getState().setRequestBody(requestId, {
        type: 'binary',
        content: '',
        attachment: { slotId: 'slot-x', globalFileAssetId: fileId },
      });
    });
    render(
      <ExportFolderModal folderId={folderId} onClose={() => undefined} download={() => true} />,
    );
    const section = screen.getByTestId('export-dependencies');
    expect(section).toHaveTextContent('Global files (1)');
    expect(section).toHaveTextContent('avatar');
    expect(section).toHaveTextContent('avatar.png · 2.0 KB');
    expect(section).toHaveTextContent('re-attach them inside Global Assets');
  });

  it('formats byte counts across thresholds (B / KB / MB)', async () => {
    await hydrateEmpty();
    const folderId = await seedFolder('Sizes');
    await act(async () => {
      const requestId = useWorkspaceStore.getState().addRequest(folderId, 'big');
      const synced = useWorkspaceStore.getState().synced!;
      useWorkspaceStore.setState({
        synced: {
          ...synced,
          globalAssets: {
            ...synced.globalAssets,
            files: {
              tiny: {
                id: 'tiny',
                name: 'a',
                slotId: 's',
                filename: 'a.bin',
                size: 100,
                mimeType: 'application/octet-stream',
                createdAt: synced.meta.createdAt,
                updatedAt: synced.meta.createdAt,
              },
              kb: {
                id: 'kb',
                name: 'b',
                slotId: 's',
                filename: 'b.bin',
                size: 2048,
                mimeType: 'application/octet-stream',
                createdAt: synced.meta.createdAt,
                updatedAt: synced.meta.createdAt,
              },
              mb: {
                id: 'mb',
                name: 'c',
                slotId: 's',
                filename: 'c.bin',
                size: 2 * 1024 * 1024,
                mimeType: 'application/octet-stream',
                createdAt: synced.meta.createdAt,
                updatedAt: synced.meta.createdAt,
              },
            },
          },
        },
      });
      useWorkspaceStore.getState().setRequestBody(requestId, {
        type: 'form-data',
        content: '',
        formRows: [
          { kind: 'file', key: 'a', slotId: 's', globalFileAssetId: 'tiny', enabled: true },
          { kind: 'file', key: 'b', slotId: 's', globalFileAssetId: 'kb', enabled: true },
          { kind: 'file', key: 'c', slotId: 's', globalFileAssetId: 'mb', enabled: true },
        ],
      });
    });
    render(
      <ExportFolderModal folderId={folderId} onClose={() => undefined} download={() => true} />,
    );
    const section = screen.getByTestId('export-dependencies');
    expect(section).toHaveTextContent('a.bin · 100 B');
    expect(section).toHaveTextContent('b.bin · 2.0 KB');
    expect(section).toHaveTextContent('c.bin · 2.0 MB');
  });

  it('invokes the download callback with the suggested filename + JSON contents', async () => {
    await hydrateEmpty();
    const folderId = await seedFolder('Auth');
    const download = vi.fn<(filename: string, contents: string) => boolean>(() => true);
    const onClose = vi.fn();
    render(<ExportFolderModal folderId={folderId} onClose={onClose} download={download} />);
    const btn = screen.getByRole('button', { name: /Download auth\.apicircle\.json/i });
    await userEvent.click(btn);
    expect(download).toHaveBeenCalledTimes(1);
    const [filename, contents] = download.mock.calls[0];
    expect(filename).toBe('auth.apicircle.json');
    expect(contents).toContain('"format": "apicircle.folder/v1"');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does NOT close the modal when the download callback returns false', async () => {
    await hydrateEmpty();
    const folderId = await seedFolder('Auth');
    const onClose = vi.fn();
    render(<ExportFolderModal folderId={folderId} onClose={onClose} download={() => false} />);
    const btn = screen.getByRole('button', { name: /Download auth\.apicircle\.json/i });
    await userEvent.click(btn);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Cancel button closes the modal', async () => {
    await hydrateEmpty();
    const folderId = await seedFolder('Auth');
    const onClose = vi.fn();
    render(<ExportFolderModal folderId={folderId} onClose={onClose} download={() => true} />);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('default downloader writes a blob and clicks an anchor when window APIs exist', async () => {
    await hydrateEmpty();
    const folderId = await seedFolder('Auth');
    const onClose = vi.fn();
    const createObjectURL = vi.fn(() => 'blob:fake');
    const revokeObjectURL = vi.fn();
    const origCreate = URL.createObjectURL;
    const origRevoke = URL.revokeObjectURL;
    URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = revokeObjectURL as unknown as typeof URL.revokeObjectURL;
    try {
      render(<ExportFolderModal folderId={folderId} onClose={onClose} />);
      const btn = screen.getByRole('button', { name: /Download auth\.apicircle\.json/i });
      await userEvent.click(btn);
      expect(createObjectURL).toHaveBeenCalledTimes(1);
      await Promise.resolve();
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake');
      expect(onClose).toHaveBeenCalled();
    } finally {
      URL.createObjectURL = origCreate;
      URL.revokeObjectURL = origRevoke;
    }
  });

  it('shows the "no credentials" empty state when nothing is leaking', async () => {
    await hydrateEmpty();
    const folderId = await seedFolder('Auth');
    render(
      <ExportFolderModal folderId={folderId} onClose={() => undefined} download={() => true} />,
    );
    const section = screen.getByTestId('export-credentials');
    expect(section).toHaveTextContent('No request or folder in this subtree carries a credential');
    expect(screen.queryByTestId('export-credentials-summary')).toBeNull();
  });

  it('lists credentials when a request carries a bearer token', async () => {
    await hydrateEmpty();
    const folderId = await seedFolder('Auth');
    await act(async () => {
      const state = useWorkspaceStore.getState();
      const reqId = state.addRequest(folderId, 'POST /login');
      state.setRequestAuth(reqId, { type: 'bearer', token: 'live-token' });
    });
    render(
      <ExportFolderModal folderId={folderId} onClose={() => undefined} download={() => true} />,
    );
    const section = screen.getByTestId('export-credentials');
    expect(section).toHaveTextContent('Bearer · token');
    expect(section).toHaveTextContent('POST /login');
    // Summary line: defaults to "will be redacted".
    expect(screen.getByTestId('export-credentials-summary')).toHaveTextContent(
      '1 credential will be redacted',
    );
  });

  it('redacts every credential by default in the download payload', async () => {
    await hydrateEmpty();
    const folderId = await seedFolder('Auth');
    await act(async () => {
      const state = useWorkspaceStore.getState();
      const reqId = state.addRequest(folderId, 'POST /login');
      state.setRequestAuth(reqId, { type: 'bearer', token: 'live-token' });
    });
    const download = vi.fn<(filename: string, contents: string) => boolean>(() => true);
    render(<ExportFolderModal folderId={folderId} onClose={() => undefined} download={download} />);
    await userEvent.click(screen.getByRole('button', { name: /Download auth\.apicircle\.json/i }));
    const [, contents] = download.mock.calls[0];
    expect(contents).not.toContain('live-token');
    expect(contents).toContain('"token": ""');
  });

  it('preserves a credential when the user opts in via its checkbox', async () => {
    await hydrateEmpty();
    const folderId = await seedFolder('Auth');
    await act(async () => {
      const state = useWorkspaceStore.getState();
      const reqId = state.addRequest(folderId, 'POST /login');
      state.setRequestAuth(reqId, { type: 'bearer', token: 'live-token' });
    });
    const download = vi.fn<(filename: string, contents: string) => boolean>(() => true);
    render(<ExportFolderModal folderId={folderId} onClose={() => undefined} download={download} />);
    const checkbox = screen.getByRole('checkbox', {
      name: /Include Bearer · token for POST \/login/i,
    });
    expect(checkbox).not.toBeChecked();
    await userEvent.click(checkbox);
    expect(checkbox).toBeChecked();
    expect(screen.getByTestId('export-credentials-summary')).toHaveTextContent(
      '1 credential included',
    );
    await userEvent.click(screen.getByRole('button', { name: /Download auth\.apicircle\.json/i }));
    const [, contents] = download.mock.calls[0];
    expect(contents).toContain('"token": "live-token"');
  });

  it('lets the user toggle a credential off again', async () => {
    await hydrateEmpty();
    const folderId = await seedFolder('Auth');
    await act(async () => {
      const state = useWorkspaceStore.getState();
      const reqId = state.addRequest(folderId, 'POST /login');
      state.setRequestAuth(reqId, { type: 'bearer', token: 'live-token' });
    });
    render(
      <ExportFolderModal folderId={folderId} onClose={() => undefined} download={() => true} />,
    );
    const checkbox = screen.getByRole('checkbox', {
      name: /Include Bearer · token for POST \/login/i,
    });
    await userEvent.click(checkbox);
    expect(checkbox).toBeChecked();
    await userEvent.click(checkbox);
    expect(checkbox).not.toBeChecked();
    expect(screen.getByTestId('export-credentials-summary')).toHaveTextContent(
      '1 credential will be redacted',
    );
  });

  it('renders plural credential copy when more than one is detected', async () => {
    await hydrateEmpty();
    const folderId = await seedFolder('Auth');
    await act(async () => {
      const state = useWorkspaceStore.getState();
      state.setFolderAuth(folderId, { type: 'bearer', token: 'root-token' });
      const reqId = state.addRequest(folderId, 'POST /login');
      state.setRequestAuth(reqId, { type: 'basic', username: 'u', password: 'p' });
    });
    render(
      <ExportFolderModal folderId={folderId} onClose={() => undefined} download={() => true} />,
    );
    const section = screen.getByTestId('export-credentials');
    expect(section).toHaveTextContent('Folder auth');
    expect(section).toHaveTextContent('Basic · password');
    expect(screen.getByTestId('export-credentials-summary')).toHaveTextContent(
      '2 credentials will be redacted',
    );
    // Toggle one — should switch to mixed counter.
    await userEvent.click(
      screen.getByRole('checkbox', { name: /Include Bearer · token for Auth/i }),
    );
    expect(screen.getByTestId('export-credentials-summary')).toHaveTextContent(
      '1 credential included · 1 redacted',
    );
    // Toggle the other on too — plural-included copy.
    await userEvent.click(
      screen.getByRole('checkbox', { name: /Include Basic · password for POST \/login/i }),
    );
    expect(screen.getByTestId('export-credentials-summary')).toHaveTextContent(
      '2 credentials included · 0 redacted',
    );
  });

  it('labels a subfolder credential with the "Subfolder auth" scope', async () => {
    await hydrateEmpty();
    const folderId = await seedFolder('Auth');
    await act(async () => {
      const state = useWorkspaceStore.getState();
      const childId = state.addFolder(folderId, 'Login');
      state.setFolderAuth(childId, { type: 'bearer', token: 'sub-token' });
    });
    render(
      <ExportFolderModal folderId={folderId} onClose={() => undefined} download={() => true} />,
    );
    const section = screen.getByTestId('export-credentials');
    expect(section).toHaveTextContent('Subfolder auth');
    expect(section).toHaveTextContent('Login');
  });

  it('default downloader gracefully refuses to download in non-browser envs', async () => {
    await hydrateEmpty();
    const folderId = await seedFolder('Auth');
    const onClose = vi.fn();
    const origCreate = URL.createObjectURL;
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = undefined;
    try {
      render(<ExportFolderModal folderId={folderId} onClose={onClose} />);
      const btn = screen.getByRole('button', { name: /Download auth\.apicircle\.json/i });
      await userEvent.click(btn);
      expect(onClose).not.toHaveBeenCalled();
    } finally {
      URL.createObjectURL = origCreate;
    }
  });
});
