import { describe, it, expect, vi, beforeEach } from 'vitest';
import { workspace, Uri } from '../../test/mocks/vscode';
import type { TextEdit } from '../../test/mocks/vscode';
import { registerRequestSyncOnSave } from './requestSyncOnSave';
import { serializeRequestToYaml } from '../fs/requestYaml';

interface MockWillSaveEvent {
  document: {
    uri: unknown;
    getText: () => string;
    positionAt: (offset: number) => { line: number; character: number };
  };
  waitUntil: ReturnType<typeof vi.fn>;
}

function makeDoc(uri: unknown, text: string): MockWillSaveEvent['document'] {
  return {
    uri,
    getText: () => text,
    positionAt: (offset: number) => ({ line: 0, character: offset }),
  };
}

function captureListener(): (event: MockWillSaveEvent) => void {
  const calls = (workspace.onWillSaveTextDocument as unknown as { mock: { calls: unknown[][] } })
    .mock.calls;
  const last = calls[calls.length - 1];
  return last[0] as (event: MockWillSaveEvent) => void;
}

describe('registerRequestSyncOnSave', () => {
  beforeEach(() => {
    (workspace.onWillSaveTextDocument as unknown as { mockReset: () => void }).mockReset();
    (
      workspace.onWillSaveTextDocument as unknown as { mockReturnValue: (v: unknown) => void }
    ).mockReturnValue({ dispose: vi.fn() });
  });

  it('subscribes to onWillSaveTextDocument and returns a disposable', () => {
    const sub = registerRequestSyncOnSave();
    expect(workspace.onWillSaveTextDocument).toHaveBeenCalledTimes(1);
    expect(sub).toHaveProperty('dispose');
  });

  it('ignores non-apicircle URIs', () => {
    registerRequestSyncOnSave();
    const listener = captureListener();
    const event: MockWillSaveEvent = {
      document: makeDoc(Uri.parse('file:///foo.yaml'), 'name: x\nmethod: GET\nurl: https://x'),
      waitUntil: vi.fn(),
    };
    listener(event);
    expect(event.waitUntil).not.toHaveBeenCalled();
  });

  it('ignores apicircle URIs that are not .yaml', () => {
    registerRequestSyncOnSave();
    const listener = captureListener();
    const event: MockWillSaveEvent = {
      document: makeDoc(
        Uri.parse('apicircle://x/environments/dev.yaml'),
        'name: dev\nvariables: []',
      ),
      waitUntil: vi.fn(),
    };
    listener(event);
    expect(event.waitUntil).not.toHaveBeenCalled();
  });

  it('emits a TextEdit when the URL embeds ?key=val (sync visible in buffer on save)', () => {
    registerRequestSyncOnSave();
    const listener = captureListener();
    const buffer = ['name: x', 'method: GET', 'url: https://x.com/api?page2=15'].join('\n');
    const event: MockWillSaveEvent = {
      document: makeDoc(Uri.parse('apicircle://w/requests/x.yaml'), buffer),
      waitUntil: vi.fn(),
    };
    listener(event);
    expect(event.waitUntil).toHaveBeenCalledTimes(1);
    const promise = (event.waitUntil.mock.calls[0] as unknown[])[0] as Promise<TextEdit[]>;
    return promise.then((edits) => {
      expect(edits).toHaveLength(1);
      expect(edits[0].newText).toContain('url: https://x.com/api');
      expect(edits[0].newText).not.toContain('?page2=15');
      expect(edits[0].newText).toContain('key: page2');
    });
  });

  it('does not emit a TextEdit when the buffer is already canonical', () => {
    registerRequestSyncOnSave();
    const listener = captureListener();
    // The canonical projection includes the header comment + sorted-as-emitted
    // fields. Build it through serializeRequestToYaml so the buffer is byte-
    // identical to what the hook would produce.
    const buffer = serializeRequestToYaml({
      id: 'r',
      folderId: null,
      name: 'x',
      method: 'GET',
      url: 'https://x.com/api',
      headers: [],
      query: [],
      body: { type: 'none', content: '' },
      auth: { type: 'none' },
      contextVars: [],
      extractions: [],
      assertions: [],
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    });
    const event: MockWillSaveEvent = {
      document: makeDoc(Uri.parse('apicircle://w/requests/x.yaml'), buffer),
      waitUntil: vi.fn(),
    };
    listener(event);
    expect(event.waitUntil).not.toHaveBeenCalled();
  });

  it('does not emit a TextEdit when the YAML fails to parse (writeFile surfaces the error)', () => {
    registerRequestSyncOnSave();
    const listener = captureListener();
    const event: MockWillSaveEvent = {
      document: makeDoc(Uri.parse('apicircle://w/requests/x.yaml'), '::: not yaml :::'),
      waitUntil: vi.fn(),
    };
    listener(event);
    expect(event.waitUntil).not.toHaveBeenCalled();
  });
});
