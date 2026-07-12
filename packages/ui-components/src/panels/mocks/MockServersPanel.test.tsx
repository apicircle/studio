import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MockRuntimeEntry, MockServer } from '@apicircle/shared';
import { MockServersPanel } from './MockServersPanel';
import { renderWithStore } from '../../../test/renderWithStore';
import { useWorkspaceStore } from '../../store/workspaceStore';

const T0 = '2026-04-27T00:00:00.000Z';

const OPENAPI_JSON = JSON.stringify({
  openapi: '3.0.0',
  info: { title: 'Petstore', version: '1.0.0' },
  paths: {
    '/pets': {
      get: { responses: { '200': { content: { 'application/json': { example: [{ id: 1 }] } } } } },
    },
  },
});

function fixtureMock(id: string, name: string): MockServer {
  const endpoint = {
    id: 'ep1',
    name: 'GET /health',
    method: 'GET' as const,
    pathPattern: '/health',
    requestSchema: {
      pathParams: [],
      queryParams: [],
      headers: [],
      cookies: [],
    },
    requestValidation: [],
    responseRules: [],
    defaultResponse: {
      status: 200,
      headers: [{ key: 'Content-Type', value: 'application/json', enabled: true }],
      body: { type: 'json' as const, content: '{}' },
    },
  };
  return {
    id,
    name,
    source: { kind: 'manual', endpoints: [endpoint] },
    endpoints: [endpoint],
    defaultPort: null,
    cors: { enabled: false, origins: [] },
    createdAt: T0,
    updatedAt: T0,
  };
}

let bridge: {
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  list: ReturnType<typeof vi.fn>;
  getRuntime: ReturnType<typeof vi.fn>;
  stopAll: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  bridge = {
    start: vi.fn().mockResolvedValue({
      port: 4040,
      pid: 1234,
      startedAt: T0,
      lastError: null,
      requestCount: 0,
    } satisfies MockRuntimeEntry),
    stop: vi.fn().mockResolvedValue({ ok: true }),
    list: vi.fn().mockResolvedValue([]),
    getRuntime: vi.fn().mockResolvedValue(null),
    stopAll: vi.fn().mockResolvedValue({ ok: true }),
  };
  (window as unknown as { apicircleDesktop?: unknown }).apicircleDesktop = { mock: bridge };
});

afterEach(() => {
  delete (window as unknown as { apicircleDesktop?: unknown }).apicircleDesktop;
  vi.useRealTimers();
});

describe('MockServersPanel (post-rich-editor redesign)', () => {
  it('shows the empty state when no mocks exist + no active selection', async () => {
    delete (window as unknown as { apicircleDesktop?: unknown }).apicircleDesktop;
    await renderWithStore(<MockServersPanel />);
    expect(screen.getByText('No mock servers yet.')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Create your first mock server/ }),
    ).toBeInTheDocument();
  });

  it('renders the server-summary view when a server is active without an endpoint', async () => {
    await renderWithStore(<MockServersPanel />);
    useWorkspaceStore.setState((s) => ({
      ...s,
      synced: {
        ...(s.synced ?? ({} as never)),
        mockServers: { m1: fixtureMock('m1', 'Petstore') },
      },
      activeMockServerId: 'm1',
      activeMockEndpointId: null,
    }));
    expect(await screen.findByLabelText('Mock server name')).toHaveValue('Petstore');
  });

  it('shows a "Served directly from contract" callout + friendly label for a linked mock', async () => {
    await renderWithStore(<MockServersPanel />);
    await act(async () => {
      await useWorkspaceStore
        .getState()
        .addGlobalFileAsset(
          new File([OPENAPI_JSON], 'petstore.json', { type: 'application/json' }),
        );
    });
    const assetId = Object.values(useWorkspaceStore.getState().synced!.globalAssets.files!)[0].id;
    const { id } = await useWorkspaceStore.getState().createMockServer({
      name: 'Petstore live',
      source: { kind: 'openapi-asset', assetId, format: 'json', mode: 'linked' },
    });
    act(() => {
      useWorkspaceStore.getState().setActiveMockEndpoint({ serverId: id, endpointId: null });
    });

    expect(await screen.findByText(/Served directly from contract/i)).toBeInTheDocument();
    // Friendly source label instead of the raw `openapi-asset` union tag.
    expect(screen.getByText('OpenAPI contract')).toBeInTheDocument();
  });

  it('renders the endpoint editor READ-ONLY for a linked contract mock', async () => {
    await renderWithStore(<MockServersPanel />);
    await act(async () => {
      await useWorkspaceStore
        .getState()
        .addGlobalFileAsset(
          new File([OPENAPI_JSON], 'petstore.json', { type: 'application/json' }),
        );
    });
    const assetId = Object.values(useWorkspaceStore.getState().synced!.globalAssets.files!)[0].id;
    const { id } = await useWorkspaceStore.getState().createMockServer({
      name: 'Live',
      source: { kind: 'openapi-asset', assetId, format: 'json', mode: 'linked' },
    });
    const ep = useWorkspaceStore.getState().synced!.mockServers[id].endpoints[0];
    act(() => {
      useWorkspaceStore.getState().setActiveMockEndpoint({ serverId: id, endpointId: ep.id });
    });

    // Banner + native controls disabled via the wrapping <fieldset disabled>.
    expect(await screen.findByText(/Read-only/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Mock endpoint method')).toBeDisabled();
    expect(screen.getByLabelText('Mock endpoint name')).toBeDisabled();
  });

  it('the read-only editor "Convert to editable" button unlocks editing', async () => {
    await renderWithStore(<MockServersPanel />);
    await act(async () => {
      await useWorkspaceStore
        .getState()
        .addGlobalFileAsset(
          new File([OPENAPI_JSON], 'petstore.json', { type: 'application/json' }),
        );
    });
    const assetId = Object.values(useWorkspaceStore.getState().synced!.globalAssets.files!)[0].id;
    const { id } = await useWorkspaceStore.getState().createMockServer({
      name: 'Live',
      source: { kind: 'openapi-asset', assetId, format: 'json', mode: 'linked' },
    });
    const ep = useWorkspaceStore.getState().synced!.mockServers[id].endpoints[0];
    act(() => {
      useWorkspaceStore.getState().setActiveMockEndpoint({ serverId: id, endpointId: ep.id });
    });

    // Read-only initially.
    expect(await screen.findByText(/Read-only/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Mock endpoint method')).toBeDisabled();

    // Convert unlocks it: banner gone, controls enabled, source now materialized.
    await userEvent.click(screen.getByRole('button', { name: /Convert to editable/i }));
    await waitFor(() => expect(screen.queryByText(/Read-only/i)).not.toBeInTheDocument());
    expect(screen.getByLabelText('Mock endpoint method')).not.toBeDisabled();
    const src = useWorkspaceStore.getState().synced!.mockServers[id].source;
    expect(src).toMatchObject({ kind: 'openapi-asset', mode: 'materialized' });
  });

  it('leaves the endpoint editor EDITABLE for a materialized (imported) mock', async () => {
    await renderWithStore(<MockServersPanel />);
    await act(async () => {
      await useWorkspaceStore
        .getState()
        .addGlobalFileAsset(
          new File([OPENAPI_JSON], 'petstore.json', { type: 'application/json' }),
        );
    });
    const assetId = Object.values(useWorkspaceStore.getState().synced!.globalAssets.files!)[0].id;
    const { id } = await useWorkspaceStore.getState().createMockServer({
      name: 'Imported',
      source: { kind: 'openapi-asset', assetId, format: 'json', mode: 'materialized' },
    });
    const ep = useWorkspaceStore.getState().synced!.mockServers[id].endpoints[0];
    act(() => {
      useWorkspaceStore.getState().setActiveMockEndpoint({ serverId: id, endpointId: ep.id });
    });

    expect(await screen.findByLabelText('Mock endpoint method')).not.toBeDisabled();
    expect(screen.queryByText(/Read-only/i)).not.toBeInTheDocument();
  });

  it('renders the MockEndpointEditor flow + node editor when both a server and endpoint are active', async () => {
    await renderWithStore(<MockServersPanel />);
    useWorkspaceStore.setState((s) => ({
      ...s,
      synced: {
        ...(s.synced ?? ({} as never)),
        mockServers: { m1: fixtureMock('m1', 'Petstore') },
      },
      activeMockServerId: 'm1',
      activeMockEndpointId: 'ep1',
    }));
    // Flow renders the four nodes as buttons. The Request tab is gone
    // (its inputs were not consumed elsewhere) — the flow shows the
    // pipeline shape directly.
    expect(
      await screen.findByRole('button', { name: /Endpoint GET \/health/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Validation node/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Response rules node/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Default response node/ })).toBeInTheDocument();
  });

  it('clicking the Default response node surfaces the response editor below the flow', async () => {
    await renderWithStore(<MockServersPanel />);
    useWorkspaceStore.setState((s) => ({
      ...s,
      synced: {
        ...(s.synced ?? ({} as never)),
        mockServers: { m1: fixtureMock('m1', 'Petstore') },
      },
      activeMockServerId: 'm1',
      activeMockEndpointId: 'ep1',
    }));
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Default response node/ }));
    // The MockResponseEditor surfaces a status input labelled by its label prop.
    expect(screen.getByLabelText('Default response status')).toBeInTheDocument();
  });

  it('shows the desktop runtime banner when the bridge is missing AND mocks exist', async () => {
    delete (window as unknown as { apicircleDesktop?: unknown }).apicircleDesktop;
    await renderWithStore(<MockServersPanel />);
    useWorkspaceStore.setState((s) => ({
      ...s,
      synced: {
        ...(s.synced ?? ({} as never)),
        mockServers: { m1: fixtureMock('m1', 'Petstore') },
      },
    }));
    // The banner explains web is read-only and points at the Desktop App
    // download. "Desktop App" is rendered as an anchor — match on the
    // banner's flattened textContent, then assert at least one Desktop App
    // link points at the GitHub Releases URL. (A second link surfaces in
    // the ServerSummary below the Start button when the bridge is missing,
    // which is expected.)
    const banner = await screen.findByText(/Running them needs the/);
    expect(banner.textContent).toMatch(/Running them needs the Desktop App/);
    const links = screen.getAllByRole('link', { name: /Desktop App/ });
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link).toHaveAttribute('href', 'https://github.com/apicircle/studio/releases/latest');
    }
  });

  it('B-fix: empty-state Create CTA opens the modal', async () => {
    delete (window as unknown as { apicircleDesktop?: unknown }).apicircleDesktop;
    await renderWithStore(<MockServersPanel />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Create your first mock server/ }));
    expect(useWorkspaceStore.getState().mocksCreateModalOpen).toBe(true);
  });

  it('B-fix: createMockServer (manual, empty) seeds a server with no endpoints — endpoints added later via the sidebar', async () => {
    await renderWithStore(<MockServersPanel />);
    const { id } = await useWorkspaceStore
      .getState()
      .createMockServer({ name: 'Smoke', source: { kind: 'manual', endpoints: [] } });
    const created = useWorkspaceStore.getState().synced!.mockServers[id];
    expect(created.source.kind).toBe('manual');
    expect(created.endpoints).toEqual([]);
  });

  it('B-fix: addMockEndpoint seeds the new schema shape (defaultResponse, requestSchema, etc.) and selects the endpoint', async () => {
    await renderWithStore(<MockServersPanel />);
    const { id: sid } = await useWorkspaceStore
      .getState()
      .createMockServer({ name: 'Smoke', source: { kind: 'manual', endpoints: [] } });
    const eid = useWorkspaceStore.getState().addMockEndpoint(sid);
    const ep = useWorkspaceStore.getState().synced!.mockServers[sid].endpoints[0];
    expect(ep.id).toBe(eid);
    expect(ep.requestSchema).toEqual({
      pathParams: [],
      queryParams: [],
      headers: [],
      cookies: [],
    });
    expect(ep.responseRules).toEqual([]);
    expect(ep.requestValidation).toEqual([]);
    expect(ep.defaultResponse.status).toBe(200);
    expect(ep.defaultResponse.body.type).toBe('json');
    // The new endpoint becomes active so the editor pane surfaces it.
    expect(useWorkspaceStore.getState().activeMockEndpointId).toBe(eid);
  });

  it('default port input commits a valid 1024-65535 integer via setMockServerDefaultPort', async () => {
    await renderWithStore(<MockServersPanel />);
    useWorkspaceStore.setState((s) => ({
      ...s,
      synced: {
        ...(s.synced ?? ({} as never)),
        mockServers: { m1: fixtureMock('m1', 'Petstore') },
      },
      activeMockServerId: 'm1',
      activeMockEndpointId: null,
    }));
    const user = userEvent.setup();
    const input = await screen.findByLabelText('Default port');
    await user.clear(input);
    await user.type(input, '3000');
    await user.tab();
    expect(useWorkspaceStore.getState().synced!.mockServers.m1.defaultPort).toBe(3000);
  });

  it('default port input rejects values outside 1024-65535 with inline error', async () => {
    await renderWithStore(<MockServersPanel />);
    useWorkspaceStore.setState((s) => ({
      ...s,
      synced: {
        ...(s.synced ?? ({} as never)),
        mockServers: { m1: fixtureMock('m1', 'Petstore') },
      },
      activeMockServerId: 'm1',
      activeMockEndpointId: null,
    }));
    const user = userEvent.setup();
    const input = await screen.findByLabelText('Default port');
    await user.clear(input);
    await user.type(input, '80');
    await user.tab();
    expect(await screen.findByText('Port must be between 1024 and 65535.')).toBeInTheDocument();
    // Store unchanged.
    expect(useWorkspaceStore.getState().synced!.mockServers.m1.defaultPort).toBeNull();
  });

  it('default port input is editable while the mock is running (applies on next Start)', async () => {
    // Live runtime is mocked by the bridge.list() call — pre-seed the panel's
    // running state by stuffing the runtime entry into the in-memory bridge.
    bridge.list.mockResolvedValue([
      {
        serverId: 'm1',
        runtime: { port: 4040, pid: 1234, startedAt: T0, lastError: null, requestCount: 0 },
      },
    ]);
    await renderWithStore(<MockServersPanel />);
    useWorkspaceStore.setState((s) => ({
      ...s,
      synced: {
        ...(s.synced ?? ({} as never)),
        mockServers: { m1: fixtureMock('m1', 'Petstore') },
      },
      activeMockServerId: 'm1',
      activeMockEndpointId: null,
    }));
    // Wait for the bridge.list() refresh to populate `running` so the
    // "applies on next Start" hint can render.
    await screen.findByText(/applies on next Start/i);
    const input = await screen.findByLabelText('Default port');
    expect(input).not.toBeDisabled();
    const user = userEvent.setup();
    await user.clear(input);
    await user.type(input, '5500');
    await user.tab();
    expect(useWorkspaceStore.getState().synced!.mockServers.m1.defaultPort).toBe(5500);
  });

  it('empty default port input clears back to null (auto)', async () => {
    await renderWithStore(<MockServersPanel />);
    useWorkspaceStore.setState((s) => ({
      ...s,
      synced: {
        ...(s.synced ?? ({} as never)),
        mockServers: { m1: { ...fixtureMock('m1', 'Petstore'), defaultPort: 4000 } },
      },
      activeMockServerId: 'm1',
      activeMockEndpointId: null,
    }));
    const user = userEvent.setup();
    const input = await screen.findByLabelText('Default port');
    await user.clear(input);
    await user.tab();
    expect(useWorkspaceStore.getState().synced!.mockServers.m1.defaultPort).toBeNull();
  });

  it('B-fix: updateMockEndpoint patches a single endpoint field while preserving the rest', async () => {
    await renderWithStore(<MockServersPanel />);
    const { id: sid } = await useWorkspaceStore
      .getState()
      .createMockServer({ name: 'Smoke', source: { kind: 'manual', endpoints: [] } });
    const eid = useWorkspaceStore.getState().addMockEndpoint(sid);
    useWorkspaceStore
      .getState()
      .updateMockEndpoint(sid, eid, { method: 'POST', pathPattern: '/orders' });
    const ep = useWorkspaceStore.getState().synced!.mockServers[sid].endpoints[0];
    expect(ep.method).toBe('POST');
    expect(ep.pathPattern).toBe('/orders');
    // Defaults preserved.
    expect(ep.defaultResponse.status).toBe(200);
  });
});
