import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Mock } from 'vitest';
import type * as vscode from 'vscode';
import type { GlobalFileAsset } from '@apicircle/shared';
import { Uri, window, workspace } from '../../test/mocks/vscode';
import type { RecordedEdit, WorkspaceEdit } from '../../test/mocks/vscode';
import { applyRecordedEdits } from '../../test/mocks/vscode';
import {
  renderFormDataRow,
  findFormRowsRange,
  parseFormRows,
  addFormDataRowCommand,
  switchFormDataRowKindCommand,
  pickFormDataRowFileCommand,
} from './formDataRow';
import type { VsCodeBridge } from '../host/vscodeBridge';

function makeDoc(lines: string[]): vscode.TextDocument {
  return {
    lineCount: lines.length,
    getText: () => lines.join('\n'),
    lineAt: (line: number) => ({
      text: lines[line] ?? '',
      range: {
        start: { line, character: 0 },
        end: { line, character: (lines[line] ?? '').length },
      },
    }),
  } as unknown as vscode.TextDocument;
}

const file: GlobalFileAsset = {
  id: 'asset-1',
  name: 'avatar.png',
  slotId: 'slot-1',
  filename: 'avatar.png',
  size: 2048,
  mimeType: 'image/png',
  sha256: 'cafef00d',
  createdAt: '2026-06-10T00:00:00.000Z',
  updatedAt: '2026-06-10T00:00:00.000Z',
};

describe('renderFormDataRow', () => {
  it('renders a text row with default key when none is preserved', () => {
    const text = renderFormDataRow('text');
    expect(text).toBe(
      [
        '    - kind: text',
        `      key: 'field'`,
        `      value: 'value'`,
        '      enabled: true',
      ].join('\n') + '\n',
    );
  });

  it('preserves the key when switching kinds', () => {
    const text = renderFormDataRow('text', undefined, 'user_name');
    expect(text).toContain(`key: 'user_name'`);
  });

  it('renders a file row with every asset field bound', () => {
    const text = renderFormDataRow('file', file, 'avatar');
    expect(text).toContain(`key: 'avatar'`);
    expect(text).toContain(`slotId: 'slot-1'`);
    expect(text).toContain(`globalFileAssetId: 'asset-1'`);
    expect(text).toContain(`filename: 'avatar.png'`);
    expect(text).toContain(`size: 2048`);
    expect(text).toContain(`mimeType: 'image/png'`);
    expect(text).toContain(`sha256: 'cafef00d'`);
    expect(text).toContain('enabled: true');
  });

  it('renders a file row with slotId: null when no asset is supplied', () => {
    const text = renderFormDataRow('file');
    expect(text).toContain('slotId: null');
    expect(text).not.toContain('globalFileAssetId');
  });
});

describe('findFormRowsRange', () => {
  it('returns null when formRows: is absent', () => {
    const doc = makeDoc(['name: X', 'body:', '  type: form-data', '  content: ""']);
    expect(findFormRowsRange(doc)).toBeNull();
  });

  it('covers the formRows: header through its last child line', () => {
    const doc = makeDoc([
      'name: X',
      'body:',
      '  type: form-data',
      '  formRows:',
      '    - kind: text',
      '      key: name',
      '      value: Alice',
      '      enabled: true',
      '    - kind: file',
      '      key: avatar',
      '      slotId: null',
      '      enabled: true',
      'auth:',
      '  type: none',
    ]);
    const range = findFormRowsRange(doc);
    expect(range).not.toBeNull();
    expect(range!.start.line).toBe(3);
    expect(range!.end.line).toBe(12); // start of `auth:`
  });
});

describe('parseFormRows', () => {
  it('returns [] when formRows: is empty', () => {
    const doc = makeDoc(['name: X', 'body:', '  type: form-data', '  formRows: []']);
    expect(parseFormRows(doc)).toEqual([]);
  });

  it('captures index / kind / key / value for each row', () => {
    const doc = makeDoc([
      'name: X',
      'body:',
      '  type: form-data',
      '  formRows:',
      '    - kind: text',
      '      key: name',
      '      value: Alice',
      '      enabled: true',
      '    - kind: file',
      '      key: avatar',
      '      slotId: abc',
      '      enabled: true',
    ]);
    const rows = parseFormRows(doc);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ index: 0, kind: 'text', key: 'name', value: 'Alice' });
    expect(rows[1]).toMatchObject({ index: 1, kind: 'file', key: 'avatar' });
    // Each row's line range covers the row header through its last child line.
    expect(rows[0].headerLine).toBe(4);
    expect(rows[0].endLine).toBe(8);
    expect(rows[1].headerLine).toBe(8);
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
  (window.showQuickPick as Mock).mockReset();
  (window.showWarningMessage as Mock).mockReset();
  (window.showErrorMessage as Mock).mockReset();
  (window.showTextDocument as Mock).mockReset();
  (workspace.openTextDocument as Mock).mockReset();
  (workspace.applyEdit as Mock).mockReset();
  window.activeTextEditor = undefined as unknown;
}

function arrange(lines: string[]): { applied: WorkspaceEdit | null } {
  const doc = docWithUri(reqUri, lines);
  (workspace.openTextDocument as Mock).mockResolvedValue(doc);
  (workspace.applyEdit as Mock).mockResolvedValue(true);
  (window.showTextDocument as Mock).mockResolvedValue({
    revealRange: vi.fn(),
    selection: undefined,
  });
  return { applied: null };
}

function appliedText(originalLines: string[]): string {
  const edits = (workspace.applyEdit as Mock).mock.calls[0][0] as WorkspaceEdit;
  return applyRecordedEdits(originalLines.join('\n'), edits.edits as RecordedEdit[]);
}

const fakeBridge = { activeWorkspace: () => null } as unknown as VsCodeBridge;
const asset: GlobalFileAsset = {
  id: 'asset-1',
  name: 'avatar.png',
  slotId: 'slot-1',
  filename: 'avatar.png',
  size: 4096,
  mimeType: 'image/png',
  sha256: 'cafef00d',
  createdAt: '2026-06-13T00:00:00.000Z',
  updatedAt: '2026-06-13T00:00:00.000Z',
};

describe('addFormDataRowCommand', () => {
  beforeEach(reset);

  it('warns when no URI is in focus', async () => {
    await addFormDataRowCommand({ bridge: fakeBridge }, undefined, 'text');
    expect(window.showWarningMessage).toHaveBeenCalledWith('No request YAML is active.');
  });

  it('warns on a non-apicircle URI', async () => {
    await addFormDataRowCommand({ bridge: fakeBridge }, Uri.parse('file:///r.yaml'), 'text');
    expect(window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('only runs against API Circle request YAML files'),
    );
  });

  it('warns when body type is not form-data', async () => {
    arrange(['body:', '  type: json']);
    await addFormDataRowCommand({ bridge: fakeBridge }, reqUri, 'text');
    expect(window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('Switch the body type to form-data'),
    );
  });

  it('appends a text row to an existing formRows block', async () => {
    const lines = [
      'body:',
      '  type: form-data',
      '  formRows:',
      '    - kind: text',
      "      key: 'old'",
      "      value: 'v'",
      '      enabled: true',
    ];
    arrange(lines);
    await addFormDataRowCommand({ bridge: fakeBridge }, reqUri, 'text');
    const updated = appliedText(lines);
    expect(updated).toContain('- kind: text');
    expect(updated.match(/- kind: text/g)!.length).toBe(2);
  });

  it('creates a formRows: section when none exists', async () => {
    const lines = ['body:', '  type: form-data'];
    arrange(lines);
    await addFormDataRowCommand({ bridge: fakeBridge }, reqUri, 'text');
    const updated = appliedText(lines);
    expect(updated).toContain('formRows:');
    expect(updated).toContain('- kind: text');
  });

  it('appends a file row using the resolveAsset hook', async () => {
    const lines = ['body:', '  type: form-data', '  formRows: []'];
    arrange(lines);
    await addFormDataRowCommand(
      { bridge: fakeBridge, resolveAsset: async () => asset },
      reqUri,
      'file',
    );
    const updated = appliedText(lines);
    expect(updated).toContain('- kind: file');
    expect(updated).toContain("slotId: 'slot-1'");
    expect(updated).toContain('size: 4096');
  });

  it('aborts file add when the picker is cancelled', async () => {
    const lines = ['body:', '  type: form-data'];
    arrange(lines);
    await addFormDataRowCommand(
      { bridge: fakeBridge, resolveAsset: async () => undefined },
      reqUri,
      'file',
    );
    expect(workspace.applyEdit).not.toHaveBeenCalled();
  });

  it('surfaces applyEdit failure', async () => {
    const lines = ['body:', '  type: form-data'];
    arrange(lines);
    (workspace.applyEdit as Mock).mockResolvedValue(false);
    await addFormDataRowCommand({ bridge: fakeBridge }, reqUri, 'text');
    expect(window.showErrorMessage).toHaveBeenCalledWith('Failed to add the form row.');
  });
});

describe('switchFormDataRowKindCommand', () => {
  beforeEach(reset);

  it('warns when there are no formRows entries', async () => {
    arrange(['body:', '  type: form-data', '  formRows: []']);
    await switchFormDataRowKindCommand({ bridge: fakeBridge }, reqUri, 0);
    expect(window.showWarningMessage).toHaveBeenCalledWith('No formRows entries to switch.');
  });

  it('toggles text → file using the supplied asset', async () => {
    const lines = [
      'body:',
      '  type: form-data',
      '  formRows:',
      '    - kind: text',
      "      key: 'avatar'",
      "      value: 'v'",
      '      enabled: true',
    ];
    arrange(lines);
    await switchFormDataRowKindCommand(
      { bridge: fakeBridge, resolveAsset: async () => asset },
      reqUri,
      0,
    );
    const updated = appliedText(lines);
    expect(updated).toContain('- kind: file');
    expect(updated).toContain("filename: 'avatar.png'");
    expect(updated).toContain("key: 'avatar'");
  });

  it('toggles file → text and strips file fields', async () => {
    const lines = [
      'body:',
      '  type: form-data',
      '  formRows:',
      '    - kind: file',
      "      key: 'pic'",
      "      slotId: 'slot-1'",
      '      enabled: true',
    ];
    arrange(lines);
    await switchFormDataRowKindCommand({ bridge: fakeBridge }, reqUri, 0);
    const updated = appliedText(lines);
    expect(updated).toContain('- kind: text');
    expect(updated).toContain("key: 'pic'");
    expect(updated).not.toContain('slotId');
  });

  it('warns when targeted rowIndex is missing', async () => {
    const lines = [
      'body:',
      '  type: form-data',
      '  formRows:',
      '    - kind: text',
      "      key: 'k'",
      '      enabled: true',
    ];
    arrange(lines);
    await switchFormDataRowKindCommand({ bridge: fakeBridge }, reqUri, 99);
    expect(window.showWarningMessage).toHaveBeenCalledWith('Row #99 not found.');
  });

  it('uses the pickRowIndex hook when no rowIndex is supplied and many rows exist', async () => {
    const lines = [
      'body:',
      '  type: form-data',
      '  formRows:',
      '    - kind: text',
      "      key: 'a'",
      '      enabled: true',
      '    - kind: text',
      "      key: 'b'",
      '      enabled: true',
    ];
    arrange(lines);
    const pickRowIndex = vi.fn(async () => 1);
    await switchFormDataRowKindCommand(
      { bridge: fakeBridge, resolveAsset: async () => asset, pickRowIndex },
      reqUri,
      undefined,
    );
    expect(pickRowIndex).toHaveBeenCalled();
  });
});

describe('pickFormDataRowFileCommand', () => {
  beforeEach(reset);

  it('warns when no kind:file rows exist', async () => {
    const lines = [
      'body:',
      '  type: form-data',
      '  formRows:',
      '    - kind: text',
      "      key: 'k'",
      '      enabled: true',
    ];
    arrange(lines);
    await pickFormDataRowFileCommand({ bridge: fakeBridge }, reqUri, undefined);
    expect(window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('No `kind: file` rows'),
    );
  });

  it('replaces the file row with the picked asset', async () => {
    const lines = [
      'body:',
      '  type: form-data',
      '  formRows:',
      '    - kind: file',
      "      key: 'pic'",
      '      slotId: null',
      '      enabled: true',
    ];
    arrange(lines);
    await pickFormDataRowFileCommand(
      { bridge: fakeBridge, resolveAsset: async () => asset },
      reqUri,
      0,
    );
    const updated = appliedText(lines);
    expect(updated).toContain("slotId: 'slot-1'");
    expect(updated).toContain("filename: 'avatar.png'");
  });
});
