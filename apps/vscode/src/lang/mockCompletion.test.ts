import { describe, it, expect } from 'vitest';
import type * as vscode from 'vscode';
import { Uri } from '../../test/mocks/vscode';
import { MockCompletionProvider } from './mockCompletion';

function makeDoc(uri: unknown, lines: string[]): vscode.TextDocument {
  return {
    uri,
    lineCount: lines.length,
    lineAt: (line: number) => ({ text: lines[line] ?? '' }),
  } as unknown as vscode.TextDocument;
}

const fakeToken = {} as unknown as vscode.CancellationToken;
const fakeCtx = {} as unknown as vscode.CompletionContext;
const pos = (line: number, ch: number) => ({ line, character: ch }) as unknown as vscode.Position;

describe('MockCompletionProvider', () => {
  const provider = new MockCompletionProvider();

  it('returns [] for non-apicircle scheme', () => {
    const items = provider.provideCompletionItems(
      makeDoc(Uri.parse('file:///x.mock.yaml'), ['name: ']),
      pos(0, 6),
      fakeToken,
      fakeCtx,
    );
    expect(items).toEqual([]);
  });

  it('returns [] for apicircle URIs that are not .mock.yaml', () => {
    const items = provider.provideCompletionItems(
      makeDoc(Uri.parse('apicircle://x/requests/r.req.yaml'), ['name: ']),
      pos(0, 6),
      fakeToken,
      fakeCtx,
    );
    expect(items).toEqual([]);
  });

  it('suggests root field names at column 0', () => {
    const items = provider.provideCompletionItems(
      makeDoc(Uri.parse('apicircle://x/mocks/m1.mock.yaml'), ['']),
      pos(0, 0),
      fakeToken,
      fakeCtx,
    );
    const labels = items.map((i) => i.label).sort();
    expect(labels).toContain('cors');
    expect(labels).toContain('defaultPort');
    expect(labels).toContain('name');
    // P3R1-G12: read-only annotations are surfaced too.
    expect(labels).toContain('source');
    expect(labels).toContain('endpoints');
    const sourceItem = items.find((i) => i.label === 'source');
    expect(sourceItem?.detail).toContain('read-only');
    // P3R2-G8: now inserts a YAML comment marker instead of nothing
    expect(sourceItem?.insertText).toContain('# source:');
    // P3R3-G7: documentation markdown attached AND has meaningful content
    expect(sourceItem?.documentation).toBeDefined();
    const docValue = (sourceItem?.documentation as { value: string }).value;
    expect(docValue).toContain('Read-only');
    expect(docValue).toContain('APICircle: New Mock');
  });

  it('suggests true/false on enabled: lines', () => {
    const items = provider.provideCompletionItems(
      makeDoc(Uri.parse('apicircle://x/mocks/m1.mock.yaml'), ['  enabled: ']),
      pos(0, 10),
      fakeToken,
      fakeCtx,
    );
    expect(items.map((i) => i.label)).toEqual(['true', 'false']);
  });

  it('suggests enabled/origins inside the cors block', () => {
    const items = provider.provideCompletionItems(
      makeDoc(Uri.parse('apicircle://x/mocks/m1.mock.yaml'), ['cors:', '  ']),
      pos(1, 2),
      fakeToken,
      fakeCtx,
    );
    expect(items.map((i) => i.label).sort()).toEqual(['enabled', 'origins']);
  });
});
