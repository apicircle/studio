import { describe, it, expect } from 'vitest';
import type * as vscode from 'vscode';
import type { GlobalFileAsset } from '@apicircle/shared';
import { renderFormDataRow, findFormRowsRange, parseFormRows } from './formDataRow';

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
