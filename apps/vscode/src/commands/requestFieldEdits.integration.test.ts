import type { Mock } from 'vitest';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Request as ApiRequest } from '@apicircle/shared';
import {
  Uri,
  Range,
  window,
  workspace,
  applyRecordedEdits,
  type WorkspaceEdit,
} from '../../test/mocks/vscode';
import { serializeRequestToYaml, parseRequestFromYaml } from '../fs/requestYaml';
import {
  setRequestMethodFieldCommand,
  setRequestHeaderKeyFieldCommand,
  setRequestHeaderValueFieldCommand,
  setRequestTextFieldCommand,
  setRequestAssertionKindFieldCommand,
  setRequestAssertionOpFieldCommand,
  setRequestExtractionSourceFieldCommand,
} from './requestFieldEdits';

// =============================================================================
// Command-level integration: open an editable request YAML, stub the picker,
// apply the WorkspaceEdit to the text, and assert the result re-parses to the
// expected Request patch — the request-side mirror of mockFieldEdits.integration.
// =============================================================================

const URI = Uri.parse('apicircle://x/requests/get-users.yaml?id=req-1');

function makeRequest(): ApiRequest {
  return {
    id: 'req-1',
    name: 'List users',
    folderId: null,
    method: 'GET',
    url: 'https://api.example.com/users/{id}',
    headers: [{ key: 'Accept', value: 'text/plain', enabled: true }],
    query: [{ key: 'page', value: '1', enabled: true }],
    pathParams: { id: '7' },
    cookies: [],
    body: { type: 'none', content: '' },
    auth: { type: 'none' },
    contextVars: [],
    extractions: [],
    assertions: [],
    createdAt: '2026-06-10T00:00:00.000Z',
    updatedAt: '2026-06-10T00:00:00.000Z',
  };
}

function mountDoc(initial: string): { get: () => string } {
  let text = initial;
  const doc = {
    uri: URI,
    get lineCount(): number {
      return text.split('\n').length;
    },
    getText: () => text,
    lineAt: (line: number) => {
      const l = text.split('\n')[line] ?? '';
      return { text: l, range: new Range(line, 0, line, l.length) };
    },
    save: vi.fn(async () => undefined),
  };
  (workspace.openTextDocument as Mock).mockResolvedValue(doc);
  (window.showTextDocument as Mock).mockResolvedValue({
    selection: undefined,
    revealRange: vi.fn(),
  });
  (workspace.applyEdit as Mock).mockImplementation(async (e: WorkspaceEdit) => {
    text = applyRecordedEdits(text, e.edits);
    return true;
  });
  return { get: () => text };
}

function lineOf(text: string, re: RegExp, afterRe?: RegExp): number {
  const lines = text.split('\n');
  let from = 0;
  if (afterRe) {
    from = lines.findIndex((l) => afterRe.test(l));
    if (from === -1) return -1;
  }
  for (let i = from; i < lines.length; i++) if (re.test(lines[i])) return i;
  return -1;
}

function parse(text: string) {
  return parseRequestFromYaml(text).patch;
}

beforeEach(() => {
  (window.showQuickPick as Mock).mockReset();
  (window.showInputBox as Mock).mockReset();
  (window.showWarningMessage as Mock).mockReset();
  (window.showErrorMessage as Mock).mockReset();
  (workspace.openTextDocument as Mock).mockReset();
  (workspace.applyEdit as Mock).mockReset();
  (window.showTextDocument as Mock).mockReset();
  (window.activeTextEditor as unknown) = undefined;
});

describe('requestFieldEdits', () => {
  it('setRequestMethodField replaces the method', async () => {
    const h = mountDoc(serializeRequestToYaml(makeRequest()));
    (window.showQuickPick as Mock).mockResolvedValueOnce('POST');
    await setRequestMethodFieldCommand(URI, lineOf(h.get(), /^method:/));
    expect(parse(h.get()).method).toBe('POST');
  });

  it('setRequestTextField edits the url', async () => {
    const h = mountDoc(serializeRequestToYaml(makeRequest()));
    (window.showInputBox as Mock).mockResolvedValueOnce('https://api.example.com/v2/users');
    await setRequestTextFieldCommand(URI, lineOf(h.get(), /^url:/));
    expect(parse(h.get()).url).toBe('https://api.example.com/v2/users');
  });

  it('setRequestHeaderKeyField + ValueField edit a header (value catalogue is header-aware)', async () => {
    const h = mountDoc(serializeRequestToYaml(makeRequest()));
    (window.showQuickPick as Mock).mockResolvedValueOnce({
      label: 'Content-Type',
      value: 'Content-Type',
    });
    await setRequestHeaderKeyFieldCommand(URI, lineOf(h.get(), /^\s+-\s+key:/, /^headers:/));
    // Content-Type has a curated value catalogue → the QuickPick path fires.
    (window.showQuickPick as Mock).mockResolvedValueOnce({
      label: 'application/json',
      value: 'application/json',
    });
    await setRequestHeaderValueFieldCommand(URI, lineOf(h.get(), /^\s+value:/, /^headers:/));
    expect(parse(h.get()).headers?.[0]).toMatchObject({
      key: 'Content-Type',
      value: 'application/json',
    });
  });

  it('setRequestTextField edits a path param value', async () => {
    const h = mountDoc(serializeRequestToYaml(makeRequest()));
    (window.showInputBox as Mock).mockResolvedValueOnce('42');
    await setRequestTextFieldCommand(URI, lineOf(h.get(), /^\s+id:/, /^pathParams:/));
    expect(parse(h.get()).pathParams?.id).toBe('42');
  });
});

function makeRichRequest(): ApiRequest {
  return {
    ...makeRequest(),
    auth: { type: 'api-key', key: 'X-Api-Key', value: 'secret', addTo: 'header' },
    assertions: [{ id: 'a1', kind: 'status', op: 'equals', expected: '200' }],
    extractions: [{ id: 'e1', variable: 'token', source: 'body', path: '$.token', enabled: true }],
  };
}

describe('requestFieldEdits — assertions / extractions', () => {
  it('setRequestAssertionKindField + OpField pick enum values', async () => {
    const h = mountDoc(serializeRequestToYaml(makeRichRequest()));
    (window.showQuickPick as Mock).mockResolvedValueOnce('header');
    await setRequestAssertionKindFieldCommand(URI, lineOf(h.get(), /^\s+kind:/, /^assertions:/));
    expect(parse(h.get()).assertions?.[0].kind).toBe('header');

    (window.showQuickPick as Mock).mockResolvedValueOnce('contains');
    await setRequestAssertionOpFieldCommand(URI, lineOf(h.get(), /^\s+op:/, /^assertions:/));
    expect(parse(h.get()).assertions?.[0].op).toBe('contains');
  });

  it('setRequestExtractionSourceField picks the source enum', async () => {
    const h = mountDoc(serializeRequestToYaml(makeRichRequest()));
    (window.showQuickPick as Mock).mockResolvedValueOnce('header');
    await setRequestExtractionSourceFieldCommand(
      URI,
      lineOf(h.get(), /^\s+source:/, /^extractions:/),
    );
    expect(parse(h.get()).extractions?.[0].source).toBe('header');
  });
});
