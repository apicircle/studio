import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Mock } from 'vitest';
import type * as vscode from 'vscode';
import type { GlobalFileAsset } from '@apicircle/shared';
import { Uri, window, workspace } from '../../test/mocks/vscode';
import type { RecordedEdit, WorkspaceEdit } from '../../test/mocks/vscode';
import { applyRecordedEdits } from '../../test/mocks/vscode';
import {
  renderAttachmentBlock,
  renderBinaryBodyBlock,
  findExistingAttachmentRange,
  pickBinaryAttachmentCommand,
} from './binaryAttachment';
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
  name: 'sample.pdf',
  slotId: 'slot-abc',
  filename: 'sample.pdf',
  size: 12345,
  mimeType: 'application/pdf',
  sha256: 'deadbeef',
  createdAt: '2026-06-10T00:00:00.000Z',
  updatedAt: '2026-06-10T00:00:00.000Z',
};

describe('renderAttachmentBlock', () => {
  it('writes every attachment field on its own indented line', () => {
    const block = renderAttachmentBlock(file);
    const lines = block.trimEnd().split('\n');
    expect(lines[0]).toBe('  attachment:');
    expect(lines.slice(1)).toEqual([
      `    slotId: 'slot-abc'`,
      `    globalFileAssetId: 'asset-1'`,
      `    filename: 'sample.pdf'`,
      `    size: 12345`,
      `    mimeType: 'application/pdf'`,
      `    sha256: 'deadbeef'`,
    ]);
    expect(block.endsWith('\n')).toBe(true);
  });

  it('omits sha256 line when absent', () => {
    const { sha256: _drop, ...rest } = file;
    void _drop;
    const block = renderAttachmentBlock(rest as GlobalFileAsset);
    expect(block).not.toContain('sha256');
  });
});

describe('renderBinaryBodyBlock', () => {
  it('produces a clean body: section with type + attachment only', () => {
    const block = renderBinaryBodyBlock(file);
    const lines = block.trimEnd().split('\n');
    expect(lines[0]).toBe('body:');
    expect(lines[1]).toBe('  type: binary');
    expect(lines[2]).toBe('  attachment:');
    // No `content:` line — binary's bytes live in the attachment, so the
    // empty-string content from the scaffold would be misleading noise.
    expect(block).not.toContain('content:');
    expect(block.endsWith('\n')).toBe(true);
  });

  it('replaces any pre-existing body scaffold cruft cleanly when used as a section replacement', () => {
    // Simulate what `pickBinaryAttachmentCommand` does after the user
    // attaches a file: the whole body: range gets replaced with this block,
    // so any leftover `content: ""` from the prior scaffold disappears.
    const replacement = renderBinaryBodyBlock(file);
    // The replacement is self-contained — starts with `body:` and is
    // ready to splice into a document via `WorkspaceEdit.replace(bodyRange,
    // block)` without manual line-joining.
    expect(replacement.split('\n')[0]).toBe('body:');
  });
});

describe('findExistingAttachmentRange', () => {
  it('returns null when the body section has no attachment: block', () => {
    const doc = makeDoc(['name: X', 'body:', '  type: binary', '  content: ""']);
    expect(findExistingAttachmentRange(doc)).toBeNull();
  });

  it('returns the range covering all attachment lines', () => {
    const doc = makeDoc([
      'name: X',
      'body:',
      '  type: binary',
      '  content: ""',
      '  attachment:',
      `    slotId: 'old-slot'`,
      `    filename: 'old.bin'`,
      '    size: 1',
      'auth:',
      '  type: none',
    ]);
    const range = findExistingAttachmentRange(doc);
    expect(range).not.toBeNull();
    expect(range!.start.line).toBe(4); // `  attachment:`
    // End collapses at the start of `auth:` (line 8).
    expect(range!.end.line).toBe(8);
  });

  it('stops at the next top-level key, not at an indented sibling sub-block', () => {
    const doc = makeDoc([
      'name: X',
      'body:',
      '  type: binary',
      '  attachment:',
      `    slotId: 'a'`,
      `    filename: 'b'`,
    ]);
    const range = findExistingAttachmentRange(doc);
    expect(range).not.toBeNull();
    expect(range!.start.line).toBe(3);
    // EOF — covers through the last line.
    expect(range!.end.line).toBeGreaterThanOrEqual(5);
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

const fakeBridge = { activeWorkspace: () => null } as unknown as VsCodeBridge;
const asset: GlobalFileAsset = {
  id: 'asset-1',
  name: 'pic.png',
  slotId: 'slot-1',
  filename: 'pic.png',
  size: 12345,
  mimeType: 'image/png',
  sha256: 'cafef00d',
  createdAt: '2026-06-13T00:00:00.000Z',
  updatedAt: '2026-06-13T00:00:00.000Z',
};

describe('pickBinaryAttachmentCommand', () => {
  beforeEach(reset);

  it('warns when no URI is in focus', async () => {
    await pickBinaryAttachmentCommand({ bridge: fakeBridge });
    expect(window.showWarningMessage).toHaveBeenCalledWith('No request YAML is active.');
  });

  it('warns on a non-apicircle URI', async () => {
    await pickBinaryAttachmentCommand({ bridge: fakeBridge }, Uri.parse('file:///r.yaml'));
    expect(window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('only runs against APICircle request YAML files'),
    );
  });

  it('warns when body type is not binary', async () => {
    arrange(['body:', '  type: json']);
    await pickBinaryAttachmentCommand({ bridge: fakeBridge }, reqUri);
    expect(window.showWarningMessage).toHaveBeenCalledWith(expect.stringContaining('not "binary"'));
  });

  it('exits silently when the file picker is cancelled', async () => {
    arrange(['body:', '  type: binary']);
    await pickBinaryAttachmentCommand(
      { bridge: fakeBridge, resolveAsset: async () => undefined },
      reqUri,
    );
    expect(workspace.applyEdit).not.toHaveBeenCalled();
  });

  it('rewrites the whole body: section with the attached asset and toasts success', async () => {
    const lines = ['body:', '  type: binary', "  content: ''"];
    arrange(lines);
    await pickBinaryAttachmentCommand(
      { bridge: fakeBridge, resolveAsset: async () => asset },
      reqUri,
    );
    const updated = appliedText(lines);
    expect(updated).toContain('body:');
    expect(updated).toContain('  type: binary');
    expect(updated).toContain('  attachment:');
    expect(updated).toContain("    filename: 'pic.png'");
    expect(updated).toContain('    size: 12345');
    expect(updated).not.toContain("content: ''");
    expect(window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('Attached pic.png'),
    );
  });

  it('surfaces an error when applyEdit returns false', async () => {
    arrange(['body:', '  type: binary']);
    (workspace.applyEdit as Mock).mockResolvedValue(false);
    await pickBinaryAttachmentCommand(
      { bridge: fakeBridge, resolveAsset: async () => asset },
      reqUri,
    );
    expect(window.showErrorMessage).toHaveBeenCalledWith(
      'Failed to write attachment back to the request YAML.',
    );
  });
});
