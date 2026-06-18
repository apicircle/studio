import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Mock } from 'vitest';
import { window } from '../../test/mocks/vscode';
import { applyFormStateToMock, editMockEndpointCommand } from './editMockEndpoint';
import type { MockServer } from '@apicircle/shared';
import type { VsCodeBridge } from '../host/vscodeBridge';
import type { MockEndpointEditor } from '../webview/mockEndpointEditor';

function makeMock(): MockServer {
  return {
    id: 'm-1',
    name: 'Test Mock',
    source: { kind: 'manual', endpoints: [] },
    endpoints: [
      {
        id: 'ep-1',
        name: 'Original',
        method: 'GET',
        pathPattern: '/users',
        requestSchema: {
          contentType: 'application/json',
          query: [],
          headers: [],
          pathParams: [],
        },
        requestValidation: [],
        responseRules: [
          {
            id: 'rule-1',
            name: 'odd-user',
            when: [{ kind: 'pathParam', key: 'id', op: 'matches', value: '^[13579]$' }],
            response: { status: 418, headers: [], body: { type: 'text', content: 'odd' } },
          },
        ],
        defaultResponse: {
          status: 200,
          headers: [{ key: 'X-Original', value: 'preserved', enabled: true }],
          body: { type: 'json', content: '{"original":true}' },
          delayMs: 50,
        },
      },
    ],
    runtime: 'desktop-bridge',
    port: null,
    spec: null,
    overrides: { perEndpointResponses: {} },
    createdAt: '',
    updatedAt: '',
  } as unknown as MockServer;
}

describe('applyFormStateToMock', () => {
  it('returns error when endpointId no longer exists', () => {
    const result = applyFormStateToMock(makeMock(), {
      endpointId: 'ghost',
      method: 'GET',
      pathPattern: '/x',
      status: 200,
      bodyType: 'none',
      bodyContent: '',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('ghost');
    }
  });

  it('preserves response rules, headers, delayMs when editor saves', () => {
    const result = applyFormStateToMock(makeMock(), {
      endpointId: 'ep-1',
      method: 'POST',
      pathPattern: '/users/{id}',
      status: 201,
      bodyType: 'json',
      bodyContent: '{"created":true}',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const ep = result.next.endpoints[0];
      expect(ep.method).toBe('POST');
      expect(ep.pathPattern).toBe('/users/{id}');
      expect(ep.defaultResponse.status).toBe(201);
      expect(ep.defaultResponse.body).toEqual({ type: 'json', content: '{"created":true}' });
      // Preserved fields:
      expect(ep.defaultResponse.headers).toEqual([
        { key: 'X-Original', value: 'preserved', enabled: true },
      ]);
      expect(ep.defaultResponse.delayMs).toBe(50);
      expect(ep.responseRules).toHaveLength(1);
      expect(ep.responseRules[0].id).toBe('rule-1');
    }
  });

  it('rejects malformed JSON in the body when bodyType is json', () => {
    const result = applyFormStateToMock(makeMock(), {
      endpointId: 'ep-1',
      method: 'GET',
      pathPattern: '/x',
      status: 200,
      bodyType: 'json',
      bodyContent: '{not json',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('does not parse');
    }
  });

  it('accepts an empty body when bodyType is json (caller may clear)', () => {
    const result = applyFormStateToMock(makeMock(), {
      endpointId: 'ep-1',
      method: 'GET',
      pathPattern: '/x',
      status: 200,
      bodyType: 'json',
      bodyContent: '',
    });
    expect(result.ok).toBe(true);
  });

  it('switches bodyType from json to none cleanly', () => {
    const result = applyFormStateToMock(makeMock(), {
      endpointId: 'ep-1',
      method: 'GET',
      pathPattern: '/x',
      status: 200,
      bodyType: 'none',
      bodyContent: '',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.next.endpoints[0].defaultResponse.body).toEqual({
        type: 'none',
        content: '',
      });
    }
  });

  it('switches bodyType to xml', () => {
    const result = applyFormStateToMock(makeMock(), {
      endpointId: 'ep-1',
      method: 'GET',
      pathPattern: '/x',
      status: 200,
      bodyType: 'xml',
      bodyContent: '<ok/>',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.next.endpoints[0].defaultResponse.body).toEqual({
        type: 'xml',
        content: '<ok/>',
      });
    }
  });
});

function makeBridge(mocks: Record<string, MockServer>, hasActive = true) {
  const surface = {
    workspace: { id: 'ws-1', name: 'demo' },
    read: vi.fn(async () => ({
      synced: { mockServers: mocks } as never,
      local: {} as never,
    })),
    apply: vi.fn(),
    write: vi.fn(),
  };
  return {
    activeWorkspace: () =>
      hasActive ? (surface as unknown as ReturnType<VsCodeBridge['activeWorkspace']>) : null,
  } as unknown as VsCodeBridge;
}

function makeEditor(): MockEndpointEditor {
  return { open: vi.fn() } as unknown as MockEndpointEditor;
}

function reset(): void {
  (window.showWarningMessage as Mock).mockReset();
  (window.showErrorMessage as Mock).mockReset();
}

describe('editMockEndpointCommand', () => {
  beforeEach(reset);

  it('warns when there is no active workspace', async () => {
    await editMockEndpointCommand({
      bridge: makeBridge({}, false),
      editor: makeEditor(),
    });
    expect(window.showWarningMessage).toHaveBeenCalledWith('No active API Circle workspace.');
  });

  it('warns when called with no arguments', async () => {
    await editMockEndpointCommand({ bridge: makeBridge({}), editor: makeEditor() });
    expect(window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('Open this command from a mock endpoint row'),
    );
  });

  it('errors when the mock server is not found', async () => {
    await editMockEndpointCommand(
      { bridge: makeBridge({}), editor: makeEditor() },
      { mockId: 'nope', endpointId: 'ep-1' },
    );
    expect(window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('Mock server'));
  });

  it('errors when the endpoint is not found inside the mock', async () => {
    await editMockEndpointCommand(
      { bridge: makeBridge({ 'm-1': makeMock() }), editor: makeEditor() },
      { mockId: 'm-1', endpointId: 'no-such' },
    );
    expect(window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('Endpoint "no-such" not found'),
    );
  });

  it('opens the editor with the endpoint snapshot when found via MockView shape', async () => {
    const editor = makeEditor();
    await editMockEndpointCommand(
      { bridge: makeBridge({ 'm-1': makeMock() }), editor },
      { kind: 'endpoint', serverId: 'm-1', endpointId: 'ep-1' },
    );
    expect((editor as unknown as { open: Mock }).open).toHaveBeenCalledWith(
      expect.objectContaining({
        endpointId: 'ep-1',
        method: 'GET',
        pathPattern: '/users',
        bodyType: 'json',
      }),
      'GET /users',
    );
  });

  it('falls back bodyType to none for unsupported original types (e.g. urlencoded)', async () => {
    const mock = makeMock();
    mock.endpoints[0].defaultResponse.body = {
      type: 'urlencoded',
      content: 'a=b',
    } as never;
    const editor = makeEditor();
    await editMockEndpointCommand(
      { bridge: makeBridge({ 'm-1': mock }), editor },
      { mockId: 'm-1', endpointId: 'ep-1' },
    );
    expect((editor as unknown as { open: Mock }).open).toHaveBeenCalledWith(
      expect.objectContaining({ bodyType: 'none', bodyContent: 'a=b' }),
      expect.any(String),
    );
  });

  it('falls back method to GET for an unrecognised HTTP verb', async () => {
    const mock = makeMock();
    (mock.endpoints[0] as { method: string }).method = 'CONNECT';
    const editor = makeEditor();
    await editMockEndpointCommand(
      { bridge: makeBridge({ 'm-1': mock }), editor },
      { mockId: 'm-1', endpointId: 'ep-1' },
    );
    expect((editor as unknown as { open: Mock }).open).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'GET' }),
      expect.any(String),
    );
  });
});

describe('applyFormStateToMock additional coverage', () => {
  it('returns ok=false when bodyType=json but content does not parse', () => {
    const result = applyFormStateToMock(makeMock(), {
      endpointId: 'ep-1',
      method: 'POST',
      pathPattern: '/users',
      status: 201,
      bodyType: 'json',
      bodyContent: '{not json}',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('Body type is json');
  });

  it('builds a "none" body when bodyType=none', () => {
    const result = applyFormStateToMock(makeMock(), {
      endpointId: 'ep-1',
      method: 'GET',
      pathPattern: '/users',
      status: 204,
      bodyType: 'none',
      bodyContent: 'ignored',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.next.endpoints[0].defaultResponse.body).toEqual({ type: 'none', content: '' });
    }
  });

  it('builds a "text" body when bodyType=text', () => {
    const result = applyFormStateToMock(makeMock(), {
      endpointId: 'ep-1',
      method: 'GET',
      pathPattern: '/users',
      status: 200,
      bodyType: 'text',
      bodyContent: 'hello',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.next.endpoints[0].defaultResponse.body).toEqual({
        type: 'text',
        content: 'hello',
      });
    }
  });
});
