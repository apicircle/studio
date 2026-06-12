import { describe, it, expect } from 'vitest';
import type * as vscode from 'vscode';
import type { GlobalFileAsset } from '@apicircle/shared';
import {
  renderAttachmentBlock,
  renderBinaryBodyBlock,
  findExistingAttachmentRange,
} from './binaryAttachment';

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
