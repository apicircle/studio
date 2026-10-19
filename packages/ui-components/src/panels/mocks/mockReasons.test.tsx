import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { MockResponseConfig } from '@apicircle/shared';
import { MockResponseEditor } from './MockResponseEditor';
import { MockServersPanel } from './MockServersPanel';
import { ServeContractModal } from './ServeContractModal';
import { renderWithStore } from '../../../test/renderWithStore';
import { useWorkspaceStore } from '../../store/workspaceStore';

// A disabled control in the mock panels says why (STU-UX-16).

const OPENAPI_JSON = JSON.stringify({
  openapi: '3.0.0',
  info: { title: 'Petstore', version: '2.1.0' },
  paths: { '/pets': { get: { responses: { '200': { description: 'ok' } } } } },
});

describe('Serve OpenAPI contract', () => {
  it('says what Create waits for: a contract, then a name', async () => {
    await renderWithStore(<ServeContractModal />);
    await act(async () => {
      await useWorkspaceStore
        .getState()
        .addGlobalFileAsset(
          new File([OPENAPI_JSON], 'petstore.json', { type: 'application/json' }),
        );
      useWorkspaceStore.getState().openMocksServeContractModal();
    });
    const assetId = Object.values(useWorkspaceStore.getState().synced!.globalAssets.files!)[0].id;
    const create = await screen.findByRole('button', { name: 'Create contract server' });
    expect(create).toBeDisabled();
    expect(create).toHaveAccessibleDescription('Pick a contract first.');

    await userEvent.selectOptions(screen.getByLabelText('OpenAPI / Swagger contract'), assetId);
    expect(create).toBeEnabled();
    await userEvent.clear(screen.getByLabelText('Server name'));
    expect(create).toBeDisabled();
    expect(create).toHaveAccessibleDescription('Name the server first.');
  });
});

describe('A mock response body type the status cannot carry', () => {
  const noContent: MockResponseConfig = {
    status: 204,
    headers: [],
    body: { type: 'none', content: '' },
  };

  it('is disabled and says why; one it can carry is picked', async () => {
    const onChange = vi.fn();
    await renderWithStore(
      <MockResponseEditor
        label="default"
        value={noContent}
        onChange={onChange}
        attachmentSlot={null}
      />,
    );
    const types = screen.getByRole('tablist', { name: 'default body type' });
    const json = types.querySelector<HTMLButtonElement>(
      'button[role="tab"]:not([aria-selected="true"])',
    )!;
    expect(json).toBeDisabled();
    expect(json).toHaveAccessibleDescription("Status 204 doesn't support a body.");
    // `none` is the one a 204 can carry; pressing it again changes nothing harmful.
    await userEvent.click(types.querySelector<HTMLButtonElement>('button[aria-selected="true"]')!);
    expect(onChange).toHaveBeenCalled();
  });
});

describe('A mock server’s CORS origins', () => {
  it('says Add waits for an origin, then adds one', async () => {
    await renderWithStore(<MockServersPanel />);
    let id = '';
    await act(async () => {
      ({ id } = await useWorkspaceStore.getState().createMockServer({
        name: 'Local',
        source: { kind: 'manual', endpoints: [] },
      }));
      useWorkspaceStore.getState().setActiveMockEndpoint({ serverId: id, endpointId: null });
    });
    await userEvent.click(await screen.findByLabelText('Enable CORS'));
    const add = screen.getByRole('button', { name: 'Add origin' });
    expect(add).toBeDisabled();
    expect(add).toHaveAccessibleDescription('Type an origin first.');
    await userEvent.type(screen.getByLabelText('Add allowed origin'), 'https://app.example.com');
    await userEvent.click(add);
    expect(useWorkspaceStore.getState().synced!.mockServers[id].cors.origins).toEqual([
      'https://app.example.com',
    ]);
  });
});
