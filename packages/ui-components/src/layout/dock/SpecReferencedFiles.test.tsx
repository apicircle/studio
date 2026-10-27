import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { GlobalAssetsDockPanel } from './GlobalAssetsDockPanel';
import { SpecReferencedFiles } from './SpecReferencedFiles';

// The "Referenced files" part of a spec asset's card, driven through the real
// dock and store: what is missing, supplying it row by row / several at once /
// as a folder, and taking the spec away as one file.

const store = () => useWorkspaceStore.getState();

const root = JSON.stringify({
  openapi: '3.0.3',
  info: { title: 'Split', version: '1' },
  paths: { '/pets': { $ref: 'paths/pets.json' } },
});
const pets = JSON.stringify({
  get: {
    responses: {
      '200': {
        description: 'ok',
        content: { 'application/json': { schema: { $ref: '../schemas/pet.json#/Pet' } } },
      },
    },
  },
});
const pet = JSON.stringify({ Pet: { type: 'object', properties: { name: { type: 'string' } } } });

const json = (text: string, name: string, path?: string): File => {
  const file = new File([text], name, { type: 'application/json' });
  if (path) Object.defineProperty(file, 'webkitRelativePath', { value: path });
  return file;
};

async function seed(text = root, name = 'openapi.json'): Promise<string> {
  let id = '';
  await act(async () => {
    id = await store().addGlobalFileAsset(json(text, name));
  });
  return id;
}

/** Render the dock on the Files tab with asset `name` open. */
async function openSpec(name: string): Promise<void> {
  render(<GlobalAssetsDockPanel />);
  await userEvent.click(screen.getByRole('button', { name: /^Files/ }));
  await userEvent.click(screen.getByRole('button', { name: new RegExp(`^${name}`) }));
}

const section = () => screen.getByRole('region', { name: 'Referenced files' });

describe('Referenced files', () => {
  beforeEach(async () => {
    await act(async () => {
      await store().hydrate();
    });
    for (const t of store().toasts) store().dismissToast(t.id);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('says a self-contained spec references nothing', async () => {
    await seed(JSON.stringify({ openapi: '3.0.0', paths: {} }), 'solo.json');
    await openSpec('solo.json');
    expect(
      screen.getByText('Self-contained: this spec references no other files.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Referenced files' })).toBeNull();
  });

  it('lists what is missing and will not hand over one file until it is all here', async () => {
    await seed();
    await openSpec('openapi.json');
    const s = section();
    expect(
      within(s).getByText(/^1 of 1 referenced file missing — the schemas it holds read/),
    ).toBeInTheDocument();
    expect(within(s).getByText('paths/pets.json')).toBeInTheDocument();
    expect(within(s).getByText('Missing')).toBeInTheDocument();
    const download = within(s).getByRole('button', { name: 'Download one file' });
    expect(download).toBeDisabled();
    expect(within(s).getByRole('button', { name: 'Save as new spec' })).toBeDisabled();
    await userEvent.hover(download.parentElement!);
    expect(
      screen
        .getAllByRole('tooltip')
        .some((t) => t.textContent === '1 referenced file is still missing — upload it first.'),
    ).toBe(true);
  });

  it('supplies files row by row, then as a set, and reports a file that matched nothing', async () => {
    const id = await seed();
    await openSpec('openapi.json');
    await userEvent.upload(
      within(section()).getByLabelText('Upload a file for paths/pets.json'),
      json(pets, 'pets.json'),
    );
    // pets.json reveals the file IT points at.
    expect(await within(section()).findByText('schemas/pet.json')).toBeInTheDocument();
    expect(
      within(section()).getByText(/^1 of 2 referenced files missing — the schemas it holds/),
    ).toBeInTheDocument();

    await userEvent.upload(
      within(section()).getByLabelText('Upload referenced files for openapi.json'),
      [json(pet, 'pet.json'), json('# notes', 'README.md')],
    );
    await waitFor(() =>
      expect(
        within(section()).getByText('All 2 referenced files are here: the spec is read in full.'),
      ).toBeInTheDocument(),
    );
    expect(store().toasts.map((t) => t.title)).toEqual(
      expect.arrayContaining([
        'Mapped 1 referenced file',
        '1 file matched no reference and was not uploaded',
      ]),
    );
    expect(store().synced?.globalAssets.files?.[id]?.spec?.operationCount).toBe(1);
    // Nothing left to supply.
    expect(within(section()).getByRole('button', { name: 'Upload files…' })).toBeDisabled();
    expect(within(section()).getByRole('button', { name: 'Upload folder…' })).toBeDisabled();
    // Each supplied file names the spec as its user, and nests under it in the list.
    const nested = screen.getByRole('list', { name: 'Files referenced by openapi.json' });
    expect(within(nested).getAllByRole('button')).toHaveLength(2);
    expect(screen.getByText('+2 files')).toBeInTheDocument();
    await userEvent.click(within(nested).getByRole('button', { name: /^pets\.json/ }));
    expect(screen.getByText('spec-ref')).toBeInTheDocument();
  });

  it('maps a whole folder by path, and names the files left out', async () => {
    await seed();
    await openSpec('openapi.json');
    const folder = within(section()).getByLabelText(
      'Upload a folder of referenced files for openapi.json',
    );
    expect(folder).toHaveAttribute('webkitdirectory');
    await userEvent.upload(folder, [
      json(root, 'openapi.json', 'api/openapi.json'),
      json(pets, 'pets.json', 'api/paths/pets.json'),
      json(pet, 'pet.json', 'api/schemas/pet.json'),
      ...['a', 'b', 'c', 'd', 'e'].map((n) => json('{}', `${n}.md`, `api/docs/${n}.md`)),
    ]);
    await waitFor(() =>
      expect(within(section()).getByText(/^All 2 referenced files are here/)).toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(store().toasts.some((t) => t.title.startsWith('5 files matched'))).toBe(true),
    );
    const leftOut = store().toasts.find((t) => t.title.startsWith('5 files matched no reference'));
    expect(leftOut?.title).toBe('5 files matched no reference and were not uploaded');
    expect(leftOut?.detail).toBe('docs/a.md, docs/b.md, docs/c.md, docs/d.md and 1 more');
    expect(store().toasts.find((t) => t.title === 'Mapped 2 referenced files')?.detail).toBe(
      'paths/pets.json, schemas/pet.json',
    );
  });

  it('says nothing more when a set of files maps nothing', async () => {
    await seed();
    await openSpec('openapi.json');
    await userEvent.upload(
      within(section()).getByLabelText('Upload referenced files for openapi.json'),
      [json('{}', 'unrelated.json')],
    );
    await waitFor(() =>
      expect(store().toasts.map((t) => t.title)).toContain(
        '1 file matched no reference and was not uploaded',
      ),
    );
    expect(store().toasts.some((t) => t.title.startsWith('Mapped'))).toBe(false);
  });

  it('chooses an existing file for a reference, and unmaps it', async () => {
    const id = await seed();
    await seed(pets, 'pets-copy.json');
    await openSpec('openapi.json');
    await userEvent.selectOptions(
      within(section()).getByLabelText('Choose an existing file for paths/pets.json'),
      'pets-copy.json',
    );
    await waitFor(() =>
      expect(within(section()).getByText('schemas/pet.json')).toBeInTheDocument(),
    );
    expect(within(section()).getByRole('button', { name: 'Replace…' })).toBeInTheDocument();
    await userEvent.click(within(section()).getByRole('button', { name: 'Unmap paths/pets.json' }));
    await waitFor(() =>
      expect(store().synced?.globalAssets.files?.[id]?.spec?.externalRefs).toEqual([
        { target: 'paths/pets.json' },
      ]),
    );
  });

  it('downloads the spec as one file, and saves it as a new spec', async () => {
    await seed();
    await openSpec('openapi.json');
    await userEvent.upload(
      within(section()).getByLabelText('Upload referenced files for openapi.json'),
      [
        json(pets, 'pets.json', 'api/paths/pets.json'),
        json(pet, 'pet.json', 'api/schemas/pet.json'),
      ],
    );
    await waitFor(() =>
      expect(within(section()).getByRole('button', { name: 'Download one file' })).toBeEnabled(),
    );

    const blobs: Blob[] = [];
    Object.assign(URL, {
      createObjectURL: vi.fn((b: Blob) => {
        blobs.push(b);
        return 'blob:one-file';
      }),
      revokeObjectURL: vi.fn(),
    });
    // jsdom cannot follow the download link; the blob handed to it is what counts.
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    await userEvent.click(within(section()).getByRole('button', { name: 'Download one file' }));
    await waitFor(() => expect(blobs).toHaveLength(1));
    const text = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
      reader.readAsText(blobs[0]);
    });
    const doc = JSON.parse(text) as { paths: Record<string, { $ref: string }> };
    // Every reference is inside the file now.
    expect(doc.paths['/pets'].$ref).toBe('#/x-apicircle-documents/paths~1pets.json');
    expect(Object.keys((doc as Record<string, object>)['x-apicircle-documents'])).toEqual([
      'paths/pets.json',
      'schemas/pet.json',
    ]);

    await userEvent.click(within(section()).getByRole('button', { name: 'Save as new spec' }));
    await waitFor(() =>
      expect(Object.values(store().synced?.globalAssets.files ?? {}).map((f) => f.name)).toContain(
        'openapi.json (one file)',
      ),
    );
    expect(
      store().toasts.find((t) => t.title === 'Saved "openapi.json (one file)"')?.detail,
    ).toMatch(/reads a single spec file/);
  });

  it('says a URL is never fetched', async () => {
    await seed(
      JSON.stringify({ openapi: '3.0.0', paths: { '/x': { $ref: 'https://example.com/x.json' } } }),
      'remote.json',
    );
    await openSpec('remote.json');
    expect(
      within(section()).getByText('A URL — never fetched. Upload a copy of the file it points at.'),
    ).toBeInTheDocument();
  });

  it('turns a failed update into an error toast', async () => {
    await seed();
    const real = store().uploadSpecExternalRefs;
    useWorkspaceStore.setState({
      uploadSpecExternalRefs: () => Promise.reject(new Error('disk full')),
    });
    await openSpec('openapi.json');
    await userEvent.upload(
      within(section()).getByLabelText('Upload a file for paths/pets.json'),
      json(pets, 'pets.json'),
    );
    await waitFor(() =>
      expect(
        store().toasts.find((t) => t.title === 'Could not update the referenced files')?.detail,
      ).toBe('disk full'),
    );
    useWorkspaceStore.setState({
      uploadSpecExternalRefs: () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- a source that throws a non-Error is the case under test
        throw 'offline';
      },
    });
    await userEvent.upload(
      within(section()).getByLabelText('Upload referenced files for openapi.json'),
      [json(pets, 'pets.json')],
    );
    await waitFor(() => expect(store().toasts.some((t) => t.detail === 'offline')).toBe(true));
    useWorkspaceStore.setState({ uploadSpecExternalRefs: real });
  });

  it('opens the right picker from each button, and ignores a pick of nothing', async () => {
    await seed();
    await openSpec('openapi.json');
    const opened: string[] = [];
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (
      this: HTMLInputElement,
    ) {
      opened.push(this.getAttribute('aria-label') ?? '');
    });
    const s = section();
    await userEvent.click(within(s).getByRole('button', { name: 'Upload…' }));
    await userEvent.click(within(s).getByRole('button', { name: 'Upload files…' }));
    await userEvent.click(within(s).getByRole('button', { name: 'Upload folder…' }));
    expect(opened).toEqual([
      'Upload a file for paths/pets.json',
      'Upload referenced files for openapi.json',
      'Upload a folder of referenced files for openapi.json',
    ]);
    const before = store().toasts.length;
    fireEvent.change(within(s).getByLabelText('Upload referenced files for openapi.json'));
    expect(store().toasts).toHaveLength(before);
  });

  it('says nothing when saving produced no spec', async () => {
    const id = await seed();
    await act(async () => {
      await store().uploadSpecExternalRefs(id, [
        json(pets, 'pets.json', 'api/paths/pets.json'),
        json(pet, 'pet.json', 'api/schemas/pet.json'),
      ]);
    });
    useWorkspaceStore.setState({ saveBundledSpecAsset: () => Promise.resolve(null) });
    await openSpec('openapi.json');
    for (const t of store().toasts) store().dismissToast(t.id);
    await userEvent.click(within(section()).getByRole('button', { name: 'Save as new spec' }));
    await waitFor(() =>
      expect(within(section()).getByRole('button', { name: 'Save as new spec' })).toBeEnabled(),
    );
    expect(store().toasts).toEqual([]);
  });

  it('unmaps through the picker, and offers nothing to choose without other files', async () => {
    const id = await seed();
    const copy = await seed(pets, 'pets-copy.json');
    await act(async () => {
      await store().mapSpecExternalRef(id, 'paths/pets.json', copy);
    });
    await openSpec('openapi.json');
    await userEvent.selectOptions(
      within(section()).getByLabelText('Choose an existing file for paths/pets.json'),
      'Not mapped',
    );
    await waitFor(() =>
      expect(store().synced?.globalAssets.files?.[id]?.spec?.externalRefs).toEqual([
        { target: 'paths/pets.json' },
      ]),
    );

    // A workspace with no file map at all: everything is missing, nothing to choose.
    const spec = store().synced!.globalAssets.files![id];
    useWorkspaceStore.setState({
      synced: { ...store().synced!, globalAssets: { schemas: {}, graphql: {} } },
    });
    render(<SpecReferencedFiles spec={spec} />);
    expect(
      screen.getAllByLabelText('Choose an existing file for paths/pets.json').at(-1),
    ).toBeDisabled();
  });
});
