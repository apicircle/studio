import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { useWorkspaceStore } from '../../src/store/workspaceStore';

// Integration test: editor sends a request whose URL references {{BASE_URL}}
// and headers reference an encrypted {{TOKEN}}. The store must:
//   1. Build the resolution scope from the active env + priority order.
//   2. Decrypt the encrypted variable using the local master key.
//   3. Call fetch() with fully-resolved URL + headers.

describe('integration: env resolution at send time', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('substitutes {{BASE_URL}} in URL and resolves {{TOKEN}} bound to a vault secret key', async () => {
    const fetchImpl: typeof fetch = () =>
      Promise.resolve(
        new Response('{"ok":true}', {
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'application/json' },
        }),
      );
    const fetchMock = vi.fn(fetchImpl);
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    await screen.findByText('API Circle Studio');

    // Seed a vault secret key, then bind an env variable to it. Encryption
    // now flows exclusively through the vault — master-key blobs in env
    // values are gone.
    let secretId = '';
    await act(async () => {
      useWorkspaceStore.getState().addEnvironment('dev');
      useWorkspaceStore.getState().setPriorityOrder(['dev']);
      useWorkspaceStore.getState().setVariables('dev', [
        { key: 'BASE_URL', value: 'https://api.example.com', encrypted: false },
        { key: 'TOKEN', value: '', encrypted: false },
      ]);
      secretId = await useWorkspaceStore.getState().addSecret({
        label: 'API_TOKEN',
        value: 'super-secret',
        origin: 'workspace',
      });
      useWorkspaceStore.getState().bindVariableToSecretKey('dev', 1, secretId);
    });
    const tokenVar = useWorkspaceStore.getState().synced!.environments.items.dev.variables[1];
    expect(tokenVar.encrypted).toBe(true);
    expect(tokenVar.secretKeyId).toBe(secretId);
    expect(tokenVar.value).toBe('');

    // Create a request that uses both placeholders.
    act(() => {
      useWorkspaceStore.getState().setActivePanel('editor');
      const id = useWorkspaceStore.getState().addRequest(null);
      useWorkspaceStore.getState().setRequestUrl(id, '{{BASE_URL}}/users');
      useWorkspaceStore
        .getState()
        .setRequestHeaders(id, [
          { key: 'Authorization', value: 'Bearer {{TOKEN}}', enabled: true },
        ]);
    });

    // Click Send. The editor's Send button is the only one matching /^Send/.
    await userEvent.click(await screen.findByRole('button', { name: /^Send/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const [calledUrl, calledInit] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe('https://api.example.com/users');
    expect(calledInit?.headers).toMatchObject({
      Authorization: 'Bearer super-secret',
    });
  });
});
