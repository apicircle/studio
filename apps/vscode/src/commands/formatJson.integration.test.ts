import type { Mock } from 'vitest';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  Uri,
  Range,
  window,
  workspace,
  applyRecordedEdits,
  type WorkspaceEdit,
} from '../../test/mocks/vscode';
import { formatJsonCommand } from './formatJson';
import { parseRequestFromYaml, serializeRequestToYaml } from '../fs/requestYaml';
import type { Request as ApiRequest } from '@apicircle/shared';

// =============================================================================
// Command-level integration for ⟳ Format JSON: mount an editable request YAML,
// run the command on a body's content row, apply the WorkspaceEdit to the text,
// and assert the result — including the multiline + empty + already-formatted +
// cross-surface round-trip cases the user reported.
// =============================================================================

const URI = Uri.parse('apicircle://x/requests/r.req.yaml?id=req-1');

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
  (workspace.applyEdit as Mock).mockImplementation(async (e: WorkspaceEdit) => {
    text = applyRecordedEdits(text, e.edits);
    return true;
  });
  return { get: () => text };
}

function lineOf(text: string, re: RegExp): number {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) if (re.test(lines[i])) return i;
  return -1;
}

beforeEach(() => {
  (window.showWarningMessage as Mock).mockReset();
  (window.showErrorMessage as Mock).mockReset();
  (workspace.openTextDocument as Mock).mockReset();
  (workspace.applyEdit as Mock).mockReset();
  (window.activeTextEditor as unknown) = undefined;
});

describe('formatJsonCommand', () => {
  it('reflows a minified inline JSON body into a pretty block scalar', async () => {
    const h = mountDoc(
      [
        'name: R',
        'method: POST',
        'url: https://x.com',
        'body:',
        '  type: json',
        '  content: \'{"a":1,"b":2}\'',
      ].join('\n'),
    );
    await formatJsonCommand(URI, lineOf(h.get(), /^\s+content:/));
    expect(h.get()).toContain('  content: |-');
    expect(h.get()).toContain('      "a": 1,');
    expect(window.showWarningMessage).not.toHaveBeenCalled();
  });

  it('reflows a multiline block scalar that is mis-indented', async () => {
    const h = mountDoc(
      [
        'name: R',
        'method: POST',
        'url: https://x.com',
        'body:',
        '  type: json',
        '  content: |-',
        '    {',
        '        "a": 1,',
        '      "b":    2',
        '    }',
      ].join('\n'),
    );
    await formatJsonCommand(URI, lineOf(h.get(), /^\s+content:/));
    expect(window.showWarningMessage).not.toHaveBeenCalled();
    // Normalized to clean 2-space JSON.
    const parsed = parseRequestFromYaml(h.get()).patch;
    expect(parsed.body).toMatchObject({ type: 'json', content: '{\n  "a": 1,\n  "b": 2\n}' });
  });

  it('silently skips an empty body (no warning, no edit)', async () => {
    const h = mountDoc(
      [
        'name: R',
        'method: POST',
        'url: https://x.com',
        'body:',
        '  type: json',
        "  content: ''",
      ].join('\n'),
    );
    const before = h.get();
    await formatJsonCommand(URI, lineOf(h.get(), /^\s+content:/));
    expect(window.showWarningMessage).not.toHaveBeenCalled();
    expect(window.showErrorMessage).not.toHaveBeenCalled();
    expect(workspace.applyEdit).not.toHaveBeenCalled();
    expect(h.get()).toBe(before);
  });

  it('skips the edit when the JSON is already perfectly formatted', async () => {
    const h = mountDoc(
      [
        'name: R',
        'method: POST',
        'url: https://x.com',
        'body:',
        '  type: json',
        '  content: |-',
        '    {',
        '      "a": 1',
        '    }',
      ].join('\n'),
    );
    await formatJsonCommand(URI, lineOf(h.get(), /^\s+content:/));
    expect(workspace.applyEdit).not.toHaveBeenCalled();
  });

  it('warns on genuinely invalid JSON', async () => {
    const h = mountDoc(
      [
        'name: R',
        'method: POST',
        'url: https://x.com',
        'body:',
        '  type: json',
        "  content: '{nope}'",
      ].join('\n'),
    );
    await formatJsonCommand(URI, lineOf(h.get(), /^\s+content:/));
    expect(window.showWarningMessage).toHaveBeenCalled();
  });

  it('cross-surface: formatted JSON round-trips through parse + re-serialize (Web/Desktop read this)', async () => {
    // VS Code formats → the FS provider parses the YAML into body.content → the
    // store (workspace.json) holds the multiline string the Web/Desktop editors
    // load. Re-serializing must keep the user's formatting (no reflow churn).
    const h = mountDoc(
      [
        'name: R',
        'method: POST',
        'url: https://x.com',
        'body:',
        '  type: json',
        '  content: \'{"b":2,"a":1}\'',
      ].join('\n'),
    );
    await formatJsonCommand(URI, lineOf(h.get(), /^\s+content:/));
    const patch = parseRequestFromYaml(h.get()).patch;
    // Valid, pretty, multiline JSON — exactly what Monaco renders on Web/Desktop.
    expect(patch.body?.type).toBe('json');
    const content = (patch.body as { content: string }).content;
    expect(content).toContain('\n');
    expect(() => JSON.parse(content)).not.toThrow();
    expect(JSON.parse(content)).toEqual({ b: 2, a: 1 });

    // Re-serializing the stored request keeps the multiline shape stable.
    const req: ApiRequest = {
      id: 'req-1',
      name: 'R',
      folderId: null,
      method: 'POST',
      url: 'https://x.com',
      headers: [],
      query: [],
      body: { type: 'json', content },
      auth: { type: 'none' },
      contextVars: [],
      extractions: [],
      assertions: [],
      createdAt: '2026-06-12T00:00:00.000Z',
      updatedAt: '2026-06-12T00:00:00.000Z',
    };
    const reserialized = serializeRequestToYaml(req);
    expect(parseRequestFromYaml(reserialized).patch.body).toEqual({ type: 'json', content });
  });
});
