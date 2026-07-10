import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CreateMockServerModal } from './CreateMockServerModal';
import { renderWithStore } from '../../../test/renderWithStore';
import { useWorkspaceStore } from '../../store/workspaceStore';

const OPENAPI_JSON = JSON.stringify({
  openapi: '3.0.0',
  info: { title: 'Petstore', version: '1.0.0' },
  paths: {
    '/pets': {
      get: { responses: { '200': { content: { 'application/json': { example: [{ id: 1 }] } } } } },
    },
  },
});

const OPENAPI_EXTERNAL_REF = JSON.stringify({
  openapi: '3.0.0',
  info: { title: 'Ext', version: '1.0.0' },
  paths: {
    '/pets': {
      get: {
        responses: {
          '200': { content: { 'application/json': { schema: { $ref: './pet.yaml#/Pet' } } } },
        },
      },
    },
  },
});

async function openModal() {
  await act(async () => {
    useWorkspaceStore.getState().openMocksCreateModal();
  });
}

/** Switch to the "Paste spec" tab and set the spec textarea value. */
async function pasteSpec(user: ReturnType<typeof userEvent.setup>, name: string, spec: string) {
  await user.type(screen.getByLabelText('Mock server name'), name);
  await user.click(screen.getByRole('button', { name: /Paste spec/i }));
  // fireEvent.change avoids userEvent interpreting `{`/`[` as keystrokes.
  fireEvent.change(screen.getByLabelText('Spec text'), { target: { value: spec } });
}

describe('CreateMockServerModal', () => {
  beforeEach(async () => {
    await renderWithStore(<CreateMockServerModal />);
    await openModal();
  });

  afterEach(() => {
    delete (globalThis as { apicircleDesktop?: unknown }).apicircleDesktop;
    vi.restoreAllMocks();
  });

  it('creates a manual (empty) mock and closes on submit', async () => {
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Mock server name'), 'Manual mock');
    await user.click(screen.getByRole('button', { name: /Create mock server/i }));
    await waitFor(() => expect(useWorkspaceStore.getState().mocksCreateModalOpen).toBe(false));
    const created = Object.values(useWorkspaceStore.getState().synced!.mockServers);
    expect(created.some((m) => m.name === 'Manual mock')).toBe(true);
  });

  it('shows the web external-$ref advisory on the OpenAPI spec tab', async () => {
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Paste spec/i }));
    expect(screen.getByText(/resolves in-document/i)).toBeInTheDocument();
  });

  it('imports an OpenAPI spec, materializes endpoints, and closes (no warnings)', async () => {
    const user = userEvent.setup();
    await pasteSpec(user, 'Petstore', OPENAPI_JSON);
    await user.click(screen.getByRole('button', { name: /Create mock server/i }));
    await waitFor(() => expect(useWorkspaceStore.getState().mocksCreateModalOpen).toBe(false));
    const created = Object.values(useWorkspaceStore.getState().synced!.mockServers).find(
      (m) => m.name === 'Petstore',
    );
    expect(created?.endpoints.length).toBe(1);
  });

  it('keeps the modal open and surfaces the external-$ref warning after import', async () => {
    const user = userEvent.setup();
    await pasteSpec(user, 'External', OPENAPI_EXTERNAL_REF);
    await user.click(screen.getByRole('button', { name: /Create mock server/i }));
    // Warnings present → result panel shown, modal stays open.
    await screen.findByText(/External \$ref not resolved in the web app/i);
    expect(useWorkspaceStore.getState().mocksCreateModalOpen).toBe(true);
    // The endpoint is still materialized despite the unresolved ref.
    const created = Object.values(useWorkspaceStore.getState().synced!.mockServers).find(
      (m) => m.name === 'External',
    );
    expect(created?.endpoints.length).toBe(1);
    // "Done" dismisses the result panel.
    await user.click(screen.getByRole('button', { name: /Done/i }));
    await waitFor(() => expect(useWorkspaceStore.getState().mocksCreateModalOpen).toBe(false));
  });

  it('shows an empty state on the spec-asset tab when no spec assets exist', async () => {
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /From spec asset/i }));
    expect(screen.getByText(/No spec assets yet/i)).toBeInTheDocument();
  });

  it('creates a "run live" (linked) mock from a spec asset', async () => {
    const user = userEvent.setup();
    // Seed a spec asset — parse-on-upload tags it as an OpenAPI doc.
    await act(async () => {
      await useWorkspaceStore
        .getState()
        .addGlobalFileAsset(
          new File([OPENAPI_JSON], 'petstore.json', { type: 'application/json' }),
        );
    });
    const assetId = Object.values(useWorkspaceStore.getState().synced!.globalAssets.files!)[0].id;

    await user.type(screen.getByLabelText('Mock server name'), 'Live petstore');
    await user.click(screen.getByRole('button', { name: /From spec asset/i }));
    await user.selectOptions(await screen.findByLabelText('Spec asset'), assetId);
    await user.click(screen.getByRole('button', { name: /Create mock server/i }));

    await waitFor(() => expect(useWorkspaceStore.getState().mocksCreateModalOpen).toBe(false));
    const created = Object.values(useWorkspaceStore.getState().synced!.mockServers).find(
      (m) => m.name === 'Live petstore',
    );
    expect(created?.source.kind).toBe('openapi-asset');
    if (created?.source.kind === 'openapi-asset') expect(created.source.mode).toBe('linked');
    expect(created?.endpoints.length).toBe(1);
  });
});
