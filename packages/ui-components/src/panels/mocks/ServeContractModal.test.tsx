import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ServeContractModal } from './ServeContractModal';
import { renderWithStore } from '../../../test/renderWithStore';
import { useWorkspaceStore } from '../../store/workspaceStore';

const OPENAPI_JSON = JSON.stringify({
  openapi: '3.0.0',
  info: { title: 'Petstore', version: '2.1.0' },
  paths: {
    '/pets': {
      get: { responses: { '200': { content: { 'application/json': { example: [{ id: 1 }] } } } } },
    },
  },
});

// A Swagger 2.0 doc with no info.title/version and two operations — exercises
// the name fallback (asset name), the "Swagger 2.0" label, and the plural "ops".
const SWAGGER_2_MULTI = JSON.stringify({
  swagger: '2.0',
  paths: {
    '/a': {
      get: { responses: { '200': { description: 'ok' } } },
      post: { responses: { '200': { description: 'ok' } } },
    },
  },
});

async function openModal() {
  await act(async () => {
    useWorkspaceStore.getState().openMocksServeContractModal();
  });
}

async function seedSpecAsset(): Promise<string> {
  await act(async () => {
    await useWorkspaceStore
      .getState()
      .addGlobalFileAsset(new File([OPENAPI_JSON], 'petstore.json', { type: 'application/json' }));
  });
  return Object.values(useWorkspaceStore.getState().synced!.globalAssets.files!)[0].id;
}

describe('ServeContractModal', () => {
  it('warns when there are no spec assets to serve', async () => {
    await renderWithStore(<ServeContractModal />);
    await openModal();
    expect(await screen.findByText(/No OpenAPI\/Swagger assets yet/i)).toBeInTheDocument();
  });

  it('previews the selected contract and pre-fills a name from its title', async () => {
    await renderWithStore(<ServeContractModal />);
    const assetId = await seedSpecAsset();
    await openModal();
    const user = userEvent.setup();

    await user.selectOptions(await screen.findByLabelText('OpenAPI / Swagger contract'), assetId);

    // Preview card renders with the contract title (capitalised, from info.title
    // — unique vs the lowercase filename shown in the <option>).
    expect(await screen.findByText(/Petstore/)).toBeInTheDocument();
    expect((screen.getByLabelText('Server name') as HTMLInputElement).value).toMatch(/Petstore/);
  });

  it('creates a linked (run-live) mock with the chosen port and activates it', async () => {
    await renderWithStore(<ServeContractModal />);
    const assetId = await seedSpecAsset();
    await openModal();
    const user = userEvent.setup();

    // Type the name BEFORE selecting so onSelectAsset keeps it (skip pre-fill).
    await user.type(screen.getByLabelText('Server name'), 'Petstore live');
    await user.selectOptions(await screen.findByLabelText('OpenAPI / Swagger contract'), assetId);
    await user.type(screen.getByLabelText('Port'), '4010');
    await user.click(screen.getByRole('button', { name: /Create contract server/i }));

    await waitFor(() =>
      expect(useWorkspaceStore.getState().mocksServeContractModalOpen).toBe(false),
    );
    const created = Object.values(useWorkspaceStore.getState().synced!.mockServers).find(
      (m) => m.name === 'Petstore live',
    );
    expect(created?.source.kind).toBe('openapi-asset');
    if (created?.source.kind === 'openapi-asset') {
      expect(created.source.mode).toBe('linked');
      expect(created.source.assetId).toBe(assetId);
    }
    expect(created?.defaultPort).toBe(4010);
    expect(created?.endpoints.length).toBe(1);
    // Activated so the mock panel (with Start/Stop) surfaces immediately.
    expect(useWorkspaceStore.getState().activeMockServerId).toBe(created?.id);
  });

  it('defaults to an auto port when the field is left blank', async () => {
    await renderWithStore(<ServeContractModal />);
    const assetId = await seedSpecAsset();
    await openModal();
    const user = userEvent.setup();

    await user.selectOptions(await screen.findByLabelText('OpenAPI / Swagger contract'), assetId);
    await user.click(screen.getByRole('button', { name: /Create contract server/i }));

    await waitFor(() =>
      expect(useWorkspaceStore.getState().mocksServeContractModalOpen).toBe(false),
    );
    const created = Object.values(useWorkspaceStore.getState().synced!.mockServers)[0];
    expect(created?.defaultPort).toBeNull();
    if (created?.source.kind === 'openapi-asset') expect(created.source.mode).toBe('linked');
  });

  it('rejects an out-of-range port and creates nothing', async () => {
    await renderWithStore(<ServeContractModal />);
    const assetId = await seedSpecAsset();
    await openModal();
    const user = userEvent.setup();

    await user.selectOptions(await screen.findByLabelText('OpenAPI / Swagger contract'), assetId);
    await user.type(screen.getByLabelText('Port'), '80');
    await user.click(screen.getByRole('button', { name: /Create contract server/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/between 1024 and 65535/i);
    expect(Object.keys(useWorkspaceStore.getState().synced!.mockServers)).toHaveLength(0);
    expect(useWorkspaceStore.getState().mocksServeContractModalOpen).toBe(true);
  });

  it('surfaces an error and stays open when the create fails (duplicate name)', async () => {
    await renderWithStore(<ServeContractModal />);
    const assetId = await seedSpecAsset();
    await act(async () => {
      await useWorkspaceStore
        .getState()
        .createMockServer({ name: 'Dupe', source: { kind: 'manual', endpoints: [] } });
    });
    await openModal();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText('Server name'), 'Dupe');
    await user.selectOptions(await screen.findByLabelText('OpenAPI / Swagger contract'), assetId);
    await user.click(screen.getByRole('button', { name: /Create contract server/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/already exists/i);
    expect(useWorkspaceStore.getState().mocksServeContractModalOpen).toBe(true);
  });

  it('previews a Swagger 2.0 contract with no title (name falls back to the asset, plural ops)', async () => {
    await renderWithStore(<ServeContractModal />);
    await act(async () => {
      await useWorkspaceStore
        .getState()
        .addGlobalFileAsset(
          new File([SWAGGER_2_MULTI], 'legacy.json', { type: 'application/json' }),
        );
    });
    const assetId = Object.values(useWorkspaceStore.getState().synced!.globalAssets.files!)[0].id;
    await openModal();
    const user = userEvent.setup();

    await user.selectOptions(await screen.findByLabelText('OpenAPI / Swagger contract'), assetId);
    expect(await screen.findByText(/Swagger 2\.0/)).toBeInTheDocument();
    expect(screen.getByText(/2 operations/)).toBeInTheDocument();
    // No info.title → name pre-fills from the asset name.
    expect((screen.getByLabelText('Server name') as HTMLInputElement).value).toMatch(/legacy/i);
  });

  it('Cancel resets and closes without creating anything', async () => {
    await renderWithStore(<ServeContractModal />);
    await seedSpecAsset();
    await openModal();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /Cancel/i }));
    expect(useWorkspaceStore.getState().mocksServeContractModalOpen).toBe(false);
    expect(Object.keys(useWorkspaceStore.getState().synced!.mockServers)).toHaveLength(0);
  });
});
