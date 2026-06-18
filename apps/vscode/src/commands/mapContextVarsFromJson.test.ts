import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Mock } from 'vitest';
import { Uri, window, workspace } from '../../test/mocks/vscode';
import type { RecordedEdit, WorkspaceEdit } from '../../test/mocks/vscode';
import { applyRecordedEdits } from '../../test/mocks/vscode';
import {
  flattenJsonToRows,
  renderContextVarsBlock,
  mapContextVarsFromJsonCommand,
} from './mapContextVarsFromJson';

describe('flattenJsonToRows', () => {
  it('flattens a flat object into key/value rows', () => {
    expect(flattenJsonToRows({ scope: 'read', id: 42 })).toEqual([
      { key: 'scope', value: 'read' },
      { key: 'id', value: '42' },
    ]);
  });

  it('joins nested object keys with dots', () => {
    expect(flattenJsonToRows({ user: { id: 1, name: 'Ada' } })).toEqual([
      { key: 'user.id', value: '1' },
      { key: 'user.name', value: 'Ada' },
    ]);
  });

  it('uses array indices for array members', () => {
    expect(flattenJsonToRows({ tags: ['a', 'b'] })).toEqual([
      { key: 'tags.0', value: 'a' },
      { key: 'tags.1', value: 'b' },
    ]);
  });

  it('handles deeply nested arrays of objects', () => {
    expect(
      flattenJsonToRows({
        orders: [
          { id: 'o1', total: 10 },
          { id: 'o2', total: 20 },
        ],
      }),
    ).toEqual([
      { key: 'orders.0.id', value: 'o1' },
      { key: 'orders.0.total', value: '10' },
      { key: 'orders.1.id', value: 'o2' },
      { key: 'orders.1.total', value: '20' },
    ]);
  });

  it('stringifies booleans + null literals', () => {
    expect(flattenJsonToRows({ active: true, parent: null })).toEqual([
      { key: 'active', value: 'true' },
      { key: 'parent', value: 'null' },
    ]);
  });

  it('returns [] for an empty object', () => {
    expect(flattenJsonToRows({})).toEqual([]);
  });
});

describe('renderContextVarsBlock', () => {
  it('writes a contextVars: header + key/value rows', () => {
    const text = renderContextVarsBlock([
      { key: 'user.id', value: '1' },
      { key: 'user.name', value: 'Ada' },
    ]);
    expect(text).toBe(
      [
        'contextVars:',
        `  - key: 'user.id'`,
        `    value: '1'`,
        `  - key: 'user.name'`,
        `    value: 'Ada'`,
      ].join('\n') + '\n',
    );
  });

  it('double-quotes values that contain YAML special chars', () => {
    const text = renderContextVarsBlock([{ key: 'note', value: 'hello: world' }]);
    expect(text).toContain('"hello: world"');
  });
});

const reqUri = Uri.parse('apicircle://w/requests/r.yaml');

function docWithUri(uri: Uri, lines: string[]) {
  return {
    uri,
    lineCount: lines.length,
    getText: () => lines.join('\n'),
    lineAt: (n: number) => ({
      text: lines[n] ?? '',
      range: {
        start: { line: n, character: 0 },
        end: { line: n, character: (lines[n] ?? '').length },
      },
    }),
  } as unknown;
}

function reset(): void {
  (window.showInformationMessage as Mock).mockReset();
  (window.showWarningMessage as Mock).mockReset();
  (window.showErrorMessage as Mock).mockReset();
  (window.showInputBox as Mock).mockReset();
  (window.showTextDocument as Mock).mockReset();
  (workspace.openTextDocument as Mock).mockReset();
  (workspace.applyEdit as Mock).mockReset();
  window.activeTextEditor = undefined as unknown;
}

function arrange(lines: string[]): void {
  const doc = docWithUri(reqUri, lines);
  (workspace.openTextDocument as Mock).mockResolvedValue(doc);
  (workspace.applyEdit as Mock).mockResolvedValue(true);
  (window.showTextDocument as Mock).mockResolvedValue({
    revealRange: vi.fn(),
    selection: undefined,
  });
}

function appliedText(originalLines: string[]): string {
  const edits = (workspace.applyEdit as Mock).mock.calls[0][0] as WorkspaceEdit;
  return applyRecordedEdits(originalLines.join('\n'), edits.edits as RecordedEdit[]);
}

describe('mapContextVarsFromJsonCommand', () => {
  beforeEach(reset);

  it('warns when no URI is in focus', async () => {
    await mapContextVarsFromJsonCommand();
    expect(window.showWarningMessage).toHaveBeenCalledWith('No request YAML is active.');
  });

  it('warns on a non-apicircle URI', async () => {
    await mapContextVarsFromJsonCommand(Uri.parse('file:///r.yaml'));
    expect(window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('only runs against API Circle request YAML files'),
    );
  });

  it('exits silently when input box is dismissed', async () => {
    arrange(['name: r']);
    (window.showInputBox as Mock).mockResolvedValueOnce(undefined);
    await mapContextVarsFromJsonCommand(reqUri);
    expect(workspace.applyEdit).not.toHaveBeenCalled();
  });

  it('warns when the JSON has no primitive leaves', async () => {
    arrange(['name: r']);
    (window.showInputBox as Mock).mockResolvedValueOnce('{}');
    await mapContextVarsFromJsonCommand(reqUri);
    expect(window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('no primitive leaves'),
    );
  });

  it('appends a fresh contextVars: block when none exists', async () => {
    const lines = ['name: r', 'method: GET'];
    arrange(lines);
    (window.showInputBox as Mock).mockResolvedValueOnce('{"a":1,"b":"x"}');
    await mapContextVarsFromJsonCommand(reqUri);
    const updated = appliedText(lines);
    expect(updated).toContain('contextVars:');
    expect(updated).toContain("key: 'a'");
    expect(updated).toContain("key: 'b'");
    expect(window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringMatching(/Mapped 2 contextVar/),
    );
  });

  it('confirms before replacing an existing contextVars block; aborts when modal dismissed', async () => {
    const lines = ['contextVars:', "  - key: 'old'", "    value: 'v'"];
    arrange(lines);
    (window.showInputBox as Mock).mockResolvedValueOnce('{"new":1}');
    (window.showWarningMessage as Mock).mockResolvedValueOnce(undefined);
    await mapContextVarsFromJsonCommand(reqUri);
    expect(workspace.applyEdit).not.toHaveBeenCalled();
  });

  it('replaces the existing contextVars block when user confirms', async () => {
    const lines = ['contextVars:', "  - key: 'old'", "    value: 'v'"];
    arrange(lines);
    (window.showInputBox as Mock).mockResolvedValueOnce('{"new":1}');
    (window.showWarningMessage as Mock).mockResolvedValueOnce('Replace');
    await mapContextVarsFromJsonCommand(reqUri);
    const updated = appliedText(lines);
    expect(updated).toContain("key: 'new'");
    expect(updated).not.toContain("key: 'old'");
  });

  it('surfaces an error when applyEdit fails', async () => {
    const lines = ['name: r'];
    arrange(lines);
    (workspace.applyEdit as Mock).mockResolvedValue(false);
    (window.showInputBox as Mock).mockResolvedValueOnce('{"a":1}');
    await mapContextVarsFromJsonCommand(reqUri);
    expect(window.showErrorMessage).toHaveBeenCalledWith('Failed to write contextVars block.');
  });

  it('exposes a validator that rejects empty / invalid / non-object JSON', async () => {
    arrange(['name: r']);
    let captured: ((v: string) => string | null) | undefined;
    (window.showInputBox as Mock).mockImplementationOnce(
      async (opts: { validateInput?: (v: string) => string | null }) => {
        captured = opts.validateInput;
        return undefined;
      },
    );
    await mapContextVarsFromJsonCommand(reqUri);
    expect(captured).toBeDefined();
    expect(captured?.('')).toMatch(/Paste a JSON object/);
    expect(captured?.('not json')).toMatch(/Invalid JSON/);
    expect(captured?.('[1,2,3]')).toMatch(/must be a JSON object/);
    expect(captured?.('null')).toMatch(/must be a JSON object/);
    expect(captured?.('{"a":1}')).toBeNull();
  });
});
