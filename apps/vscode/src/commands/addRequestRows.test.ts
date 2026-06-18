import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Mock } from 'vitest';
import { Uri, window, workspace, applyRecordedEdits } from '../../test/mocks/vscode';
import type { RecordedEdit, WorkspaceEdit } from '../../test/mocks/vscode';
import {
  addQueryRowCommand,
  addCookieRowCommand,
  addPathParamRowCommand,
  addAssertionRowCommand,
  addExtractionRowCommand,
} from './addRequestRows';

function makeDoc(uri: Uri, lines: string[]) {
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

const reqUri = Uri.parse('apicircle://w/requests/r1.yaml');

function resetMocks(): void {
  (window.showInputBox as Mock).mockReset();
  (window.showQuickPick as Mock).mockReset();
  (window.showWarningMessage as Mock).mockReset();
  (window.showErrorMessage as Mock).mockReset();
  (window.showInformationMessage as Mock).mockReset();
  (window.showTextDocument as Mock).mockReset();
  (workspace.openTextDocument as Mock).mockReset();
  (workspace.applyEdit as Mock).mockReset();
  window.activeTextEditor = undefined as unknown;
}

function arrangeDoc(lines: string[]): void {
  const doc = makeDoc(reqUri, lines);
  (workspace.openTextDocument as Mock).mockResolvedValue(doc);
  (workspace.applyEdit as Mock).mockResolvedValue(true);
  (window.showTextDocument as Mock).mockResolvedValue({
    revealRange: vi.fn(),
  });
}

function appliedText(originalLines: string[]): string {
  const edits = (workspace.applyEdit as Mock).mock.calls[0][0] as WorkspaceEdit;
  return applyRecordedEdits(originalLines.join('\n'), edits.edits as RecordedEdit[]);
}

describe('addQueryRowCommand', () => {
  beforeEach(resetMocks);

  it('warns and exits when invoked with no URI and no active editor', async () => {
    await addQueryRowCommand();
    expect(window.showWarningMessage).toHaveBeenCalledWith('No request YAML is active.');
    expect(workspace.applyEdit).not.toHaveBeenCalled();
  });

  it('warns when the URI is not an apicircle request YAML', async () => {
    await addQueryRowCommand(Uri.parse('file:///foo.txt'));
    expect(window.showWarningMessage).toHaveBeenCalledWith(
      'This command only runs against API Circle request YAML files.',
    );
  });

  it('exits silently when the user cancels the key prompt', async () => {
    arrangeDoc(['name: r', 'method: GET', 'url: https://x']);
    (window.showInputBox as Mock).mockResolvedValueOnce(undefined);
    await addQueryRowCommand(reqUri);
    expect(workspace.applyEdit).not.toHaveBeenCalled();
  });

  it('exits silently when the user cancels the value prompt', async () => {
    arrangeDoc(['name: r', 'method: GET', 'url: https://x']);
    (window.showInputBox as Mock).mockResolvedValueOnce('page').mockResolvedValueOnce(undefined);
    await addQueryRowCommand(reqUri);
    expect(workspace.applyEdit).not.toHaveBeenCalled();
  });

  it('appends a new query: section when none exists', async () => {
    const lines = ['name: r', 'method: GET', 'url: https://x'];
    arrangeDoc(lines);
    (window.showInputBox as Mock).mockResolvedValueOnce('page').mockResolvedValueOnce('2');
    await addQueryRowCommand(reqUri);
    const updated = appliedText(lines);
    expect(updated).toContain('query:');
    expect(updated).toContain("key: 'page'");
    expect(updated).toContain("value: '2'");
    expect(updated).toContain('enabled: true');
  });

  it('expands inline `query: []` into a block section before appending', async () => {
    const lines = ['name: r', 'method: GET', 'url: https://x', 'query: []'];
    arrangeDoc(lines);
    (window.showInputBox as Mock).mockResolvedValueOnce('page').mockResolvedValueOnce('2');
    await addQueryRowCommand(reqUri);
    const updated = appliedText(lines);
    expect(updated).not.toContain('query: []');
    expect(updated).toMatch(/query:\n\s+- key: 'page'/);
  });
});

describe('addCookieRowCommand', () => {
  beforeEach(resetMocks);

  it('appends a cookies: section with key/value/enabled', async () => {
    const lines = ['name: r', 'method: GET', 'url: https://x'];
    arrangeDoc(lines);
    (window.showInputBox as Mock).mockResolvedValueOnce('session').mockResolvedValueOnce('abc');
    await addCookieRowCommand(reqUri);
    const updated = appliedText(lines);
    expect(updated).toContain('cookies:');
    expect(updated).toContain("key: 'session'");
    expect(updated).toContain("value: 'abc'");
  });
});

describe('addPathParamRowCommand', () => {
  beforeEach(resetMocks);

  it('uses a map shape (key: value), not the kv-array form', async () => {
    const lines = ['name: r', 'method: GET', 'url: https://x'];
    arrangeDoc(lines);
    (window.showInputBox as Mock).mockResolvedValueOnce('id').mockResolvedValueOnce('42');
    await addPathParamRowCommand(reqUri);
    const updated = appliedText(lines);
    expect(updated).toContain('pathParams:');
    expect(updated).toContain("  'id': '42'");
    expect(updated).not.toContain('- key:');
  });
});

describe('addAssertionRowCommand', () => {
  beforeEach(resetMocks);

  it('inserts a prefilled status=200 block without prompting', async () => {
    // The command no longer walks a multi-step quick-pick — it drops a
    // prefilled scaffold (kind: status / op: equals / expected: 200) and
    // expects the user to refine via the ◆ Kind / ◆ Op / ◆ Target /
    // ◆ Expected lenses. This mirrors the "🛡 Add validation rule" UX.
    const lines = ['name: r', 'method: GET', 'url: https://x'];
    arrangeDoc(lines);
    await addAssertionRowCommand(reqUri);
    const updated = appliedText(lines);
    expect(updated).toContain('assertions:');
    expect(updated).toContain('kind: status');
    expect(updated).toContain('op: equals');
    expect(updated).toContain("expected: '200'");
    // No prompts were used.
    expect(window.showQuickPick).not.toHaveBeenCalled();
    expect(window.showInputBox).not.toHaveBeenCalled();
  });

  it('omits target: from the prefilled block (kind: status has no target)', async () => {
    const lines = ['name: r', 'method: GET', 'url: https://x'];
    arrangeDoc(lines);
    await addAssertionRowCommand(reqUri);
    const updated = appliedText(lines);
    expect(updated).toContain('kind: status');
    expect(updated).not.toMatch(/^\s*target:/m);
  });
});

describe('addExtractionRowCommand', () => {
  beforeEach(resetMocks);

  it('skips the path prompt when source is status (no path applies)', async () => {
    const lines = ['name: r', 'method: GET', 'url: https://x'];
    arrangeDoc(lines);
    (window.showQuickPick as Mock).mockResolvedValueOnce({ label: 'Status code', value: 'status' });
    (window.showInputBox as Mock).mockResolvedValueOnce('http_status');
    await addExtractionRowCommand(reqUri);
    const updated = appliedText(lines);
    expect(updated).toContain('extractions:');
    expect(updated).toContain("variable: 'http_status'");
    expect(updated).toContain("source: 'status'");
    expect(updated).toContain("path: ''");
  });

  it('captures the path from the body / json-path source', async () => {
    const lines = ['name: r', 'method: GET', 'url: https://x'];
    arrangeDoc(lines);
    (window.showQuickPick as Mock).mockResolvedValueOnce({
      label: 'Body (JSON path)',
      value: 'body',
    });
    (window.showInputBox as Mock)
      .mockResolvedValueOnce('auth_token')
      .mockResolvedValueOnce('$.data.token');
    await addExtractionRowCommand(reqUri);
    const updated = appliedText(lines);
    expect(updated).toContain("variable: 'auth_token'");
    expect(updated).toContain("source: 'body'");
    expect(updated).toContain("path: '$.data.token'");
  });

  it('cancels silently when the variable name prompt is dismissed', async () => {
    arrangeDoc(['name: r']);
    (window.showQuickPick as Mock).mockResolvedValueOnce({ label: 'Status code', value: 'status' });
    (window.showInputBox as Mock).mockResolvedValueOnce(undefined);
    await addExtractionRowCommand(reqUri);
    expect(workspace.applyEdit).not.toHaveBeenCalled();
  });
});
