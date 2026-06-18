import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Mock } from 'vitest';
import { Uri, window, workspace } from '../../test/mocks/vscode';
import type { RecordedEdit, WorkspaceEdit } from '../../test/mocks/vscode';
import { applyRecordedEdits } from '../../test/mocks/vscode';
import { renderHeaderRow, pickHeaderCommand, __testHooks } from './pickHeader';

const { HEADERS } = __testHooks;

describe('renderHeaderRow', () => {
  it('writes a three-line key/value/enabled block with single-quoted strings', () => {
    expect(renderHeaderRow('Accept', 'application/json')).toBe(
      [`  - key: 'Accept'`, `    value: 'application/json'`, '    enabled: true'].join('\n') + '\n',
    );
  });

  it('double-quotes values that contain YAML special chars', () => {
    expect(renderHeaderRow('X-Trace-Id', 'a:b:c')).toContain('"a:b:c"');
  });
});

describe('header catalogue', () => {
  it('covers the staples + the auth / api-key escape hatches', () => {
    const names = HEADERS.map((h) => h.name);
    for (const expected of [
      'Accept',
      'Authorization',
      'Cache-Control',
      'Content-Type',
      'User-Agent',
      'X-API-Key',
      'X-Request-ID',
    ]) {
      expect(names).toContain(expected);
    }
  });

  it('every catalogue entry has a non-empty description', () => {
    for (const h of HEADERS) {
      expect(h.description.length).toBeGreaterThan(0);
    }
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
  (window.showQuickPick as Mock).mockReset();
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

describe('pickHeaderCommand', () => {
  beforeEach(reset);

  it('warns when no URI is in focus', async () => {
    await pickHeaderCommand();
    expect(window.showWarningMessage).toHaveBeenCalledWith('No request YAML is active.');
  });

  it('warns on a non-apicircle URI', async () => {
    await pickHeaderCommand(Uri.parse('file:///r.yaml'));
    expect(window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('only runs against API Circle request YAML files'),
    );
  });

  it('exits silently when the name picker is dismissed', async () => {
    arrange(['name: r']);
    (window.showQuickPick as Mock).mockResolvedValueOnce(undefined);
    await pickHeaderCommand(reqUri);
    expect(workspace.applyEdit).not.toHaveBeenCalled();
  });

  it('writes a curated catalog row (Accept + application/json) into existing headers:', async () => {
    const lines = [
      'name: r',
      'headers:',
      "  - key: 'X-Other'",
      "    value: 'v'",
      '    enabled: true',
    ];
    arrange(lines);
    (window.showQuickPick as Mock)
      .mockResolvedValueOnce({ value: 'Accept' })
      .mockResolvedValueOnce({ value: 'application/json' });
    await pickHeaderCommand(reqUri);
    const updated = appliedText(lines);
    expect(updated).toContain("key: 'Accept'");
    expect(updated).toContain("value: 'application/json'");
  });

  it('creates a headers: section when none exists', async () => {
    const lines = ['name: r'];
    arrange(lines);
    (window.showQuickPick as Mock)
      .mockResolvedValueOnce({ value: 'Accept' })
      .mockResolvedValueOnce({ value: '*/*' });
    await pickHeaderCommand(reqUri);
    const updated = appliedText(lines);
    expect(updated).toContain('headers:');
    expect(updated).toContain("key: 'Accept'");
  });

  it('falls through to free-text input for the ✏ Custom header path', async () => {
    const lines = ['name: r'];
    arrange(lines);
    (window.showQuickPick as Mock).mockResolvedValueOnce({ value: '__custom__' });
    (window.showInputBox as Mock)
      .mockResolvedValueOnce('X-Trace-Id') // name
      .mockResolvedValueOnce('abc'); // value (no catalog)
    await pickHeaderCommand(reqUri);
    const updated = appliedText(lines);
    expect(updated).toContain("key: 'X-Trace-Id'");
    expect(updated).toContain("value: 'abc'");
  });

  it('uses the ✏ Custom value path through the catalog item', async () => {
    const lines = ['name: r'];
    arrange(lines);
    (window.showQuickPick as Mock)
      .mockResolvedValueOnce({ value: 'Accept' })
      .mockResolvedValueOnce({ value: '__custom__' });
    (window.showInputBox as Mock).mockResolvedValueOnce('application/vnd.api+json');
    await pickHeaderCommand(reqUri);
    const updated = appliedText(lines);
    expect(updated).toContain("value: 'application/vnd.api+json'");
  });

  it('uses an input box for headers with no curated catalog (e.g. Cookie)', async () => {
    const lines = ['name: r'];
    arrange(lines);
    (window.showQuickPick as Mock).mockResolvedValueOnce({ value: 'Cookie' });
    (window.showInputBox as Mock).mockResolvedValueOnce('sid=abc');
    await pickHeaderCommand(reqUri);
    const updated = appliedText(lines);
    expect(updated).toContain("key: 'Cookie'");
    expect(updated).toContain("value: 'sid=abc'");
  });

  it('aborts custom-name flow when name input is dismissed', async () => {
    arrange(['name: r']);
    (window.showQuickPick as Mock).mockResolvedValueOnce({ value: '__custom__' });
    (window.showInputBox as Mock).mockResolvedValueOnce(undefined);
    await pickHeaderCommand(reqUri);
    expect(workspace.applyEdit).not.toHaveBeenCalled();
  });

  it('aborts when the value input is dismissed', async () => {
    arrange(['name: r']);
    (window.showQuickPick as Mock).mockResolvedValueOnce({ value: 'Cookie' });
    (window.showInputBox as Mock).mockResolvedValueOnce(undefined);
    await pickHeaderCommand(reqUri);
    expect(workspace.applyEdit).not.toHaveBeenCalled();
  });

  it('aborts when the value picker is dismissed', async () => {
    arrange(['name: r']);
    (window.showQuickPick as Mock)
      .mockResolvedValueOnce({ value: 'Accept' })
      .mockResolvedValueOnce(undefined);
    await pickHeaderCommand(reqUri);
    expect(workspace.applyEdit).not.toHaveBeenCalled();
  });

  it('exposes a custom-name validator that rejects empty + whitespace', async () => {
    arrange(['name: r']);
    (window.showQuickPick as Mock).mockResolvedValueOnce({ value: '__custom__' });
    let captured: ((v: string) => string | null) | undefined;
    (window.showInputBox as Mock).mockImplementationOnce(
      async (opts: { validateInput?: (v: string) => string | null }) => {
        captured = opts.validateInput;
        return undefined;
      },
    );
    await pickHeaderCommand(reqUri);
    expect(captured?.('')).toMatch(/required/i);
    expect(captured?.('X Trace')).toMatch(/whitespace/i);
    expect(captured?.('X-Trace')).toBeNull();
  });

  it('surfaces applyEdit failure', async () => {
    arrange(['name: r']);
    (workspace.applyEdit as Mock).mockResolvedValue(false);
    (window.showQuickPick as Mock).mockResolvedValueOnce({ value: 'Cookie' });
    (window.showInputBox as Mock).mockResolvedValueOnce('x');
    await pickHeaderCommand(reqUri);
    expect(window.showErrorMessage).toHaveBeenCalledWith('Failed to insert header row.');
  });
});
