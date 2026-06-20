import { describe, it, expect } from 'vitest';
import type * as vscode from 'vscode';
import { Uri } from '../../test/mocks/vscode';
import { MCP_PROMPTS } from '@apicircle/mcp-server';
import { PromptCatalogCodeLensProvider } from './promptCatalogCodeLens';
import {
  buildPromptCategoryMarkdown,
  promptCategoryUri,
  promptsForCategory,
} from '../fs/promptCatalog';

function makeDoc(uri: unknown, text: string): vscode.TextDocument {
  const lines = text.split('\n');
  return {
    uri,
    lineCount: lines.length,
    lineAt: (line: number) => ({ text: lines[line] ?? '' }),
  } as unknown as vscode.TextDocument;
}

const fakeToken = {} as unknown as vscode.CancellationToken;

describe('PromptCatalogCodeLensProvider', () => {
  it('returns [] for foreign schemes', () => {
    const p = new PromptCatalogCodeLensProvider();
    const lenses = p.provideCodeLenses(
      makeDoc(Uri.parse('file:///Collections.md'), '# Collections prompts\n'),
      fakeToken,
    );
    expect(lenses).toEqual([]);
    p.dispose();
  });

  it('adds one ⧉ Copy lens per prompt + a single preview lens on the title', () => {
    const p = new PromptCatalogCodeLensProvider();
    const uri = promptCategoryUri('collections', 'Collections');
    const doc = makeDoc(uri, buildPromptCategoryMarkdown('collections', 'Collections'));
    const lenses = p.provideCodeLenses(doc, fakeToken);

    const copyLenses = lenses.filter((l) => l.command?.command === 'apicircle.copyMcpPrompt');
    const previewLenses = lenses.filter((l) => l.command?.command === 'markdown.showPreviewToSide');
    expect(copyLenses).toHaveLength(promptsForCategory('collections').length);
    expect(previewLenses).toHaveLength(1);
    expect(previewLenses[0].command?.arguments?.[0]).toBe(uri);
    p.dispose();
  });

  it('passes the matching prompt object to each copy lens', () => {
    const p = new PromptCatalogCodeLensProvider();
    const doc = makeDoc(
      promptCategoryUri('mocks', 'Mocks'),
      buildPromptCategoryMarkdown('mocks', 'Mocks'),
    );
    const copyLenses = p
      .provideCodeLenses(doc, fakeToken)
      .filter((l) => l.command?.command === 'apicircle.copyMcpPrompt');
    const expectedIds = promptsForCategory('mocks').map((pr) => pr.id);
    const actualIds = copyLenses.map(
      (l) => (l.command?.arguments?.[0] as { id: string } | undefined)?.id,
    );
    expect(actualIds).toEqual(expectedIds);
    // each argument is the real catalog object (reference equality)
    for (const lens of copyLenses) {
      const arg = lens.command?.arguments?.[0];
      expect(MCP_PROMPTS).toContain(arg);
    }
    p.dispose();
  });

  it('places the copy lens on the anchor line for each prompt', () => {
    const p = new PromptCatalogCodeLensProvider();
    const md = buildPromptCategoryMarkdown('auth', 'Auth');
    const lines = md.split('\n');
    const doc = makeDoc(promptCategoryUri('auth', 'Auth'), md);
    const copyLenses = p
      .provideCodeLenses(doc, fakeToken)
      .filter((l) => l.command?.command === 'apicircle.copyMcpPrompt');
    for (const lens of copyLenses) {
      const lineText = lines[lens.range.start.line];
      expect(lineText.startsWith('<!-- prompt:')).toBe(true);
    }
    p.dispose();
  });
});
