import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Mock } from 'vitest';
import { Uri, window } from '../../test/mocks/vscode';
import { parseMessage, MockEndpointEditor } from './mockEndpointEditor';
import type { VsCodeBridge } from '../host/vscodeBridge';

describe('parseMessage — webview → host validation', () => {
  it('parses a valid save message', () => {
    const result = parseMessage({
      type: 'save',
      state: {
        endpointId: 'ep-1',
        method: 'POST',
        pathPattern: '/users/{id}',
        status: 200,
        bodyType: 'json',
        bodyContent: '{"ok":true}',
      },
    });
    expect(result).toEqual({
      type: 'save',
      state: {
        endpointId: 'ep-1',
        method: 'POST',
        pathPattern: '/users/{id}',
        status: 200,
        bodyType: 'json',
        bodyContent: '{"ok":true}',
      },
    });
  });

  it('parses a cancel message', () => {
    expect(parseMessage({ type: 'cancel' })).toEqual({ type: 'cancel' });
  });

  it('returns null when type is unknown', () => {
    expect(parseMessage({ type: 'inject', payload: '<script>' })).toBeNull();
  });

  it('returns null when state is missing for save', () => {
    expect(parseMessage({ type: 'save' })).toBeNull();
  });

  it('returns null when method is not in the allowlist', () => {
    expect(
      parseMessage({
        type: 'save',
        state: {
          endpointId: 'ep-1',
          method: 'TRACE',
          pathPattern: '/x',
          status: 200,
          bodyType: 'json',
          bodyContent: '',
        },
      }),
    ).toBeNull();
  });

  it('returns null when status is outside 100-599', () => {
    expect(
      parseMessage({
        type: 'save',
        state: {
          endpointId: 'ep-1',
          method: 'GET',
          pathPattern: '/x',
          status: 999,
          bodyType: 'json',
          bodyContent: '',
        },
      }),
    ).toBeNull();
    expect(
      parseMessage({
        type: 'save',
        state: {
          endpointId: 'ep-1',
          method: 'GET',
          pathPattern: '/x',
          status: 0,
          bodyType: 'json',
          bodyContent: '',
        },
      }),
    ).toBeNull();
  });

  it('returns null when status is a non-integer', () => {
    expect(
      parseMessage({
        type: 'save',
        state: {
          endpointId: 'ep-1',
          method: 'GET',
          pathPattern: '/x',
          status: 200.5,
          bodyType: 'json',
          bodyContent: '',
        },
      }),
    ).toBeNull();
  });

  it('returns null when bodyType is not in the allowlist', () => {
    expect(
      parseMessage({
        type: 'save',
        state: {
          endpointId: 'ep-1',
          method: 'GET',
          pathPattern: '/x',
          status: 200,
          bodyType: 'binary',
          bodyContent: '',
        },
      }),
    ).toBeNull();
  });

  it('returns null when endpointId is empty', () => {
    expect(
      parseMessage({
        type: 'save',
        state: {
          endpointId: '',
          method: 'GET',
          pathPattern: '/x',
          status: 200,
          bodyType: 'json',
          bodyContent: '',
        },
      }),
    ).toBeNull();
  });

  it('returns null for null + non-object input', () => {
    expect(parseMessage(null)).toBeNull();
    expect(parseMessage(undefined)).toBeNull();
    expect(parseMessage('save')).toBeNull();
    expect(parseMessage(42)).toBeNull();
  });

  it('returns null when state is not an object', () => {
    expect(parseMessage({ type: 'save', state: 'string' })).toBeNull();
    expect(parseMessage({ type: 'save', state: null })).toBeNull();
  });

  it('returns null when pathPattern is not a string', () => {
    expect(
      parseMessage({
        type: 'save',
        state: {
          endpointId: 'ep-1',
          method: 'GET',
          pathPattern: 123 as never,
          status: 200,
          bodyType: 'json',
          bodyContent: '',
        },
      }),
    ).toBeNull();
  });

  it('returns null when bodyContent is not a string', () => {
    expect(
      parseMessage({
        type: 'save',
        state: {
          endpointId: 'ep-1',
          method: 'GET',
          pathPattern: '/x',
          status: 200,
          bodyType: 'json',
          bodyContent: 42 as never,
        },
      }),
    ).toBeNull();
  });
});

const initial = {
  endpointId: 'ep-1',
  method: 'GET' as const,
  pathPattern: '/users',
  status: 200,
  bodyType: 'json' as const,
  bodyContent: '{}',
};

function reset(): void {
  (window.showInformationMessage as Mock).mockReset();
  (window.showErrorMessage as Mock).mockReset();
  (window.createWebviewPanel as Mock).mockClear();
}

describe('MockEndpointEditor', () => {
  beforeEach(reset);

  it('creates a fresh webview panel on first open() and seeds it with the form state', () => {
    const onSave = vi.fn(async () => ({ ok: true }));
    const editor = new MockEndpointEditor(Uri.file('/ext'), {
      bridge: {} as unknown as VsCodeBridge,
      onSave,
    });
    editor.open(initial, 'GET /users');
    expect(window.createWebviewPanel).toHaveBeenCalledTimes(1);
    const panel = (window.createWebviewPanel as Mock).mock.results[0].value as {
      webview: { html: string; postMessage: Mock };
    };
    expect(panel.webview.html).toContain('Mock Endpoint Editor');
    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'seed', state: initial }),
    );
  });

  it('reuses the same panel on a second open() for the same endpoint', () => {
    const editor = new MockEndpointEditor(Uri.file('/ext'), {
      bridge: {} as unknown as VsCodeBridge,
      onSave: async () => ({ ok: true }),
    });
    editor.open(initial, 'GET /users');
    editor.open(initial, 'GET /users');
    expect(window.createWebviewPanel).toHaveBeenCalledTimes(1);
    const panel = (window.createWebviewPanel as Mock).mock.results[0].value as {
      reveal: Mock;
    };
    expect(panel.reveal).toHaveBeenCalled();
  });

  it('drops the panel reference on disposal so the next open() builds a fresh one', () => {
    const editor = new MockEndpointEditor(Uri.file('/ext'), {
      bridge: {} as unknown as VsCodeBridge,
      onSave: async () => ({ ok: true }),
    });
    editor.open(initial, 'GET /users');
    const panel = (window.createWebviewPanel as Mock).mock.results[0].value as { dispose: Mock };
    panel.dispose();
    editor.open(initial, 'GET /users');
    expect(window.createWebviewPanel).toHaveBeenCalledTimes(2);
  });

  it('disposes the panel when the webview posts {type:"cancel"}', async () => {
    const editor = new MockEndpointEditor(Uri.file('/ext'), {
      bridge: {} as unknown as VsCodeBridge,
      onSave: async () => ({ ok: true }),
    });
    editor.open(initial, 'GET /users');
    const panel = (window.createWebviewPanel as Mock).mock.results[0].value as {
      dispose: Mock;
      webview: { _fireMessage: (msg: unknown) => void };
    };
    panel.webview._fireMessage({ type: 'cancel' });
    expect(panel.dispose).toHaveBeenCalled();
  });

  it('invokes onSave for a valid save, toasts success, and disposes', async () => {
    const onSave = vi.fn(async () => ({ ok: true }));
    const editor = new MockEndpointEditor(Uri.file('/ext'), {
      bridge: {} as unknown as VsCodeBridge,
      onSave,
    });
    editor.open(initial, 'GET /users');
    const panel = (window.createWebviewPanel as Mock).mock.results[0].value as {
      dispose: Mock;
      webview: { _fireMessage: (msg: unknown) => void };
    };
    panel.webview._fireMessage({ type: 'save', state: initial });
    // Wait microtask for async handler.
    await new Promise((r) => setImmediate(r));
    expect(onSave).toHaveBeenCalledWith(initial);
    expect(window.showInformationMessage).toHaveBeenCalledWith('Mock endpoint saved.');
    expect(panel.dispose).toHaveBeenCalled();
  });

  it('toasts an error and KEEPS the panel open when onSave returns ok:false', async () => {
    const onSave = vi.fn(async () => ({ ok: false, error: 'bad' }));
    const editor = new MockEndpointEditor(Uri.file('/ext'), {
      bridge: {} as unknown as VsCodeBridge,
      onSave,
    });
    editor.open(initial, 'GET /users');
    const panel = (window.createWebviewPanel as Mock).mock.results[0].value as {
      dispose: Mock;
      webview: { _fireMessage: (msg: unknown) => void };
    };
    panel.webview._fireMessage({ type: 'save', state: initial });
    await new Promise((r) => setImmediate(r));
    expect(window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('Failed to save endpoint: bad'),
    );
    expect(panel.dispose).not.toHaveBeenCalled();
  });

  it('logs and drops malformed inbound messages', async () => {
    const log = vi.fn();
    const editor = new MockEndpointEditor(Uri.file('/ext'), {
      bridge: {} as unknown as VsCodeBridge,
      onSave: async () => ({ ok: true }),
      log,
    });
    editor.open(initial, 'GET /users');
    const panel = (window.createWebviewPanel as Mock).mock.results[0].value as {
      webview: { _fireMessage: (msg: unknown) => void };
    };
    panel.webview._fireMessage({ type: 'inject' });
    await new Promise((r) => setImmediate(r));
    expect(log).toHaveBeenCalledWith(expect.stringContaining('malformed'));
  });

  it('dispose() tears down every panel without throwing', () => {
    const editor = new MockEndpointEditor(Uri.file('/ext'), {
      bridge: {} as unknown as VsCodeBridge,
      onSave: async () => ({ ok: true }),
    });
    editor.open(initial, 'GET /users');
    editor.open({ ...initial, endpointId: 'ep-2' }, 'GET /other');
    expect(() => editor.dispose()).not.toThrow();
    const panel = (window.createWebviewPanel as Mock).mock.results[0].value as { dispose: Mock };
    expect(panel.dispose).toHaveBeenCalled();
  });

  it('dispose() swallows errors thrown by individual panel.dispose()', () => {
    const editor = new MockEndpointEditor(Uri.file('/ext'), {
      bridge: {} as unknown as VsCodeBridge,
      onSave: async () => ({ ok: true }),
    });
    editor.open(initial, 'GET /users');
    const panel = (window.createWebviewPanel as Mock).mock.results[0].value as { dispose: Mock };
    panel.dispose.mockImplementationOnce(() => {
      throw new Error('already gone');
    });
    expect(() => editor.dispose()).not.toThrow();
  });
});
