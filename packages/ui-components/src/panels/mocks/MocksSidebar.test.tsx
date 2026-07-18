import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { MocksSidebar, MocksSidebarActions } from './MocksSidebar';
import { renderWithStore } from '../../../test/renderWithStore';
import { useWorkspaceStore } from '../../store/workspaceStore';

const OPENAPI = JSON.stringify({
  openapi: '3.0.0',
  info: { title: 'P', version: '1' },
  paths: { '/pets': { get: { responses: { '200': { description: 'ok' } } } } },
});

async function seedAssetMock(name: string, mode: 'linked' | 'materialized'): Promise<void> {
  await act(async () => {
    const assetId = await useWorkspaceStore
      .getState()
      .addGlobalFileAsset(new File([OPENAPI], 'p.json', { type: 'application/json' }));
    await useWorkspaceStore
      .getState()
      .createMockServer({ name, source: { kind: 'openapi-asset', assetId, format: 'json', mode } });
  });
}

describe('MocksSidebar — asset-backed mocks', () => {
  it('marks a linked mock read-only: Refresh (not Add endpoint) + a read-only indicator', async () => {
    await renderWithStore(<MocksSidebar />);
    await seedAssetMock('Live', 'linked');

    expect(await screen.findByLabelText('Linked spec (read-only)')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Live actions/i }));
    expect(screen.getByText('Refresh from spec')).toBeInTheDocument();
    expect(screen.queryByText('Add endpoint')).not.toBeInTheDocument();
  });

  it('offers "Convert to editable mock" on a linked mock and flips it to materialized', async () => {
    await renderWithStore(<MocksSidebar />);
    await seedAssetMock('Live', 'linked');

    await userEvent.click(await screen.findByRole('button', { name: /Live actions/i }));
    await userEvent.click(screen.getByText('Convert to editable mock'));

    await waitFor(() => {
      const m = Object.values(useWorkspaceStore.getState().synced!.mockServers).find(
        (s) => s.name === 'Live',
      );
      expect(m?.source).toMatchObject({ kind: 'openapi-asset', mode: 'materialized' });
    });
    // Now editable: Add endpoint returns, Convert is gone, read-only indicator lifts.
    await userEvent.click(screen.getByRole('button', { name: /Live actions/i }));
    expect(screen.getByText('Add endpoint')).toBeInTheDocument();
    expect(screen.queryByText('Convert to editable mock')).not.toBeInTheDocument();
  });

  it('offers "Update spec…" on a linked mock and re-derives endpoints from the new file', async () => {
    await renderWithStore(<MocksSidebar />);
    await seedAssetMock('Live', 'linked');
    const mockId = Object.values(useWorkspaceStore.getState().synced!.mockServers)[0].id;
    expect(useWorkspaceStore.getState().synced!.mockServers[mockId].endpoints.length).toBe(1);

    // Click "Update spec…" (stashes the target server), then supply the new file.
    await userEvent.click(await screen.findByRole('button', { name: /Live actions/i }));
    await userEvent.click(screen.getByText('Update spec…'));

    const revised = new File(
      [
        JSON.stringify({
          openapi: '3.0.0',
          info: { title: 'P', version: '1' },
          paths: {
            '/a': { get: { responses: { '200': { description: 'ok' } } } },
            '/b': { get: { responses: { '200': { description: 'ok' } } } },
          },
        }),
      ],
      'revised.json',
      { type: 'application/json' },
    );
    fireEvent.change(screen.getByLabelText('Update OpenAPI/Swagger spec file'), {
      target: { files: [revised] },
    });

    await waitFor(() => {
      expect(useWorkspaceStore.getState().synced!.mockServers[mockId].endpoints.length).toBe(2);
    });
  });

  it('offers "Re-import from spec" alongside Add endpoint on a materialized mock', async () => {
    await renderWithStore(<MocksSidebar />);
    await seedAssetMock('Editable', 'materialized');

    await userEvent.click(await screen.findByRole('button', { name: /Editable actions/i }));
    expect(screen.getByText('Re-import from spec')).toBeInTheDocument();
    expect(screen.getByText('Add endpoint')).toBeInTheDocument();
  });

  it('a manual mock offers Add endpoint and no refresh action', async () => {
    await renderWithStore(<MocksSidebar />);
    await act(async () => {
      await useWorkspaceStore
        .getState()
        .createMockServer({ name: 'Manual', source: { kind: 'manual', endpoints: [] } });
    });

    await userEvent.click(await screen.findByRole('button', { name: /Manual actions/i }));
    expect(screen.getByText('Add endpoint')).toBeInTheDocument();
    expect(screen.queryByText('Refresh from spec')).not.toBeInTheDocument();
    expect(screen.queryByText('Re-import from spec')).not.toBeInTheDocument();
  });

  it('promotes an endpoint into the collection via "Add to collection"', async () => {
    await renderWithStore(<MocksSidebar />);
    let mockId = '';
    await act(async () => {
      const r = await useWorkspaceStore
        .getState()
        .createMockServer({ name: 'API', source: { kind: 'manual', endpoints: [] } });
      mockId = r.id;
      useWorkspaceStore.getState().addMockEndpoint(mockId);
    });

    // The active server auto-expands, so the endpoint row + its kebab are visible.
    await userEvent.click(await screen.findByRole('button', { name: /GET \/path actions/i }));
    await userEvent.click(screen.getByText('Add to collection'));

    await waitFor(() => {
      const reqs = Object.values(useWorkspaceStore.getState().synced!.collections.requests);
      expect(reqs.some((r) => r.url === '{{MOCK_BASE_URL}}:{{MOCK_PORT}}/path')).toBe(true);
    });
  });

  it('promotes ALL endpoints to a "<name> (mock)" folder via the server kebab', async () => {
    await renderWithStore(<MocksSidebar />);
    let mockId = '';
    await act(async () => {
      const r = await useWorkspaceStore
        .getState()
        .createMockServer({ name: 'API', source: { kind: 'manual', endpoints: [] } });
      mockId = r.id;
    });
    act(() => {
      const e1 = useWorkspaceStore.getState().addMockEndpoint(mockId);
      useWorkspaceStore
        .getState()
        .updateMockEndpoint(mockId, e1, { method: 'GET', pathPattern: '/pets' });
      const e2 = useWorkspaceStore.getState().addMockEndpoint(mockId);
      useWorkspaceStore
        .getState()
        .updateMockEndpoint(mockId, e2, { method: 'POST', pathPattern: '/pets' });
    });

    await userEvent.click(await screen.findByRole('button', { name: /API actions/i }));
    await userEvent.click(screen.getByText('Add all to collection'));

    await waitFor(() => {
      const s = useWorkspaceStore.getState().synced!;
      const folder = Object.values(s.collections.folders).find((f) => f.name === 'API (mock)');
      expect(folder).toBeTruthy();
      const reqs = Object.values(s.collections.requests).filter((r) => r.folderId === folder!.id);
      expect(reqs).toHaveLength(2);
      expect(s.environments.activeName).toBe('Mock');
    });
  });
});

describe('MocksSidebarActions', () => {
  it('offers "New Mock Server" and "Serve OpenAPI contract"; the latter opens the serve modal', async () => {
    await renderWithStore(<MocksSidebarActions />);
    await userEvent.click(screen.getByRole('button', { name: /Mocks actions/i }));
    expect(screen.getByText('New Mock Server')).toBeInTheDocument();
    const serve = screen.getByText('Serve OpenAPI contract');
    expect(serve).toBeInTheDocument();
    await userEvent.click(serve);
    expect(useWorkspaceStore.getState().mocksServeContractModalOpen).toBe(true);
  });
});
