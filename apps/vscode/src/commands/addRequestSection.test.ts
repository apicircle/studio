import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Mock } from 'vitest';
import { Uri, window, workspace, applyRecordedEdits, Selection } from '../../test/mocks/vscode';
import type { RecordedEdit, WorkspaceEdit } from '../../test/mocks/vscode';
import { addRequestSectionCommand } from './addRequestSection';

const reqUri = Uri.parse('apicircle://w/requests/r1.yaml');

function makeDoc(lines: string[]) {
  return {
    uri: reqUri,
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

let revealRange: Mock;
let editor: { selection: unknown; revealRange: Mock };

function arrangeEditor(lines: string[]): void {
  revealRange = vi.fn();
  editor = { selection: undefined, revealRange };
  (workspace.openTextDocument as Mock).mockResolvedValue(makeDoc(lines));
  (window.showTextDocument as Mock).mockResolvedValue(editor);
  (workspace.applyEdit as Mock).mockResolvedValue(true);
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

function appliedText(originalLines: string[]): string {
  const edits = (workspace.applyEdit as Mock).mock.calls[0][0] as WorkspaceEdit;
  return applyRecordedEdits(originalLines.join('\n'), edits.edits as RecordedEdit[]);
}

describe('addRequestSectionCommand', () => {
  beforeEach(reset);

  it('warns when no URI is supplied and no active editor exists', async () => {
    await addRequestSectionCommand();
    expect(window.showWarningMessage).toHaveBeenCalledWith('No request YAML is active.');
  });

  it('warns when invoked on a non-apicircle URI', async () => {
    await addRequestSectionCommand(Uri.parse('file:///foo.yaml'));
    expect(window.showWarningMessage).toHaveBeenCalledWith(
      'This command only runs against APICircle request YAML files.',
    );
  });

  it('exits silently when the user cancels the quick pick', async () => {
    arrangeEditor(['name: r', 'method: GET', 'url: https://x']);
    (window.showQuickPick as Mock).mockResolvedValueOnce(undefined);
    await addRequestSectionCommand(reqUri);
    expect(workspace.applyEdit).not.toHaveBeenCalled();
  });

  it('inserts the chosen section scaffold when absent', async () => {
    const lines = ['name: r', 'method: GET', 'url: https://x'];
    arrangeEditor(lines);
    (window.showQuickPick as Mock).mockImplementationOnce(async (items: unknown[]) => {
      const list = items as Array<{ sectionKey: string; present: boolean }>;
      return list.find((i) => i.sectionKey === 'query');
    });
    await addRequestSectionCommand(reqUri);
    const updated = appliedText(lines);
    expect(updated).toContain('query:');
    expect(updated).toContain('- key: page');
    expect(updated).toContain('value: "1"');
    expect(updated).toContain('enabled: true');
  });

  it('marks already-present sections as ✓ in the picker and only scrolls (no edit)', async () => {
    const lines = ['name: r', 'method: GET', 'url: https://x', 'query: []'];
    arrangeEditor(lines);
    (window.showQuickPick as Mock).mockImplementationOnce(async (items: unknown[]) => {
      const list = items as Array<{
        sectionKey: string;
        present: boolean;
        description: string;
      }>;
      const queryItem = list.find((i) => i.sectionKey === 'query');
      expect(queryItem?.present).toBe(true);
      expect(queryItem?.description).toContain('already in document');
      return queryItem;
    });
    await addRequestSectionCommand(reqUri);
    expect(workspace.applyEdit).not.toHaveBeenCalled();
    expect(revealRange).toHaveBeenCalled();
    expect(editor.selection).toBeInstanceOf(Selection);
  });

  it('surfaces an error when applyEdit returns false', async () => {
    const lines = ['name: r'];
    arrangeEditor(lines);
    (workspace.applyEdit as Mock).mockResolvedValue(false);
    (window.showQuickPick as Mock).mockImplementationOnce(async (items: unknown[]) => {
      const list = items as Array<{ sectionKey: string }>;
      return list.find((i) => i.sectionKey === 'headers');
    });
    await addRequestSectionCommand(reqUri);
    expect(window.showErrorMessage).toHaveBeenCalledWith('Failed to insert headers scaffold.');
  });

  it('inserts a single leading newline when the last line is already blank', async () => {
    const lines = ['name: r', ''];
    arrangeEditor(lines);
    (window.showQuickPick as Mock).mockImplementationOnce(async (items: unknown[]) => {
      const list = items as Array<{ sectionKey: string }>;
      return list.find((i) => i.sectionKey === 'auth');
    });
    await addRequestSectionCommand(reqUri);
    const updated = appliedText(lines);
    expect(updated.endsWith('\n')).toBe(true);
    expect(updated).toContain('auth:');
    expect(updated).toContain('  type: bearer');
  });
});
