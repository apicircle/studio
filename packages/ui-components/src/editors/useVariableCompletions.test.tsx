import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ResolutionScope } from '@apicircle/core';
import { useVariableCompletions } from './useVariableCompletions';

interface FakeRange {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

interface ProvideCompletionResult {
  suggestions: Array<{
    label: { label: string; description?: string };
    kind: number;
    insertText: string;
    detail?: string;
    range: FakeRange;
    sortText: string;
  }>;
}

interface CompletionProvider {
  triggerCharacters?: string[];
  provideCompletionItems: (
    model: { getValueInRange: (r: FakeRange) => string },
    pos: { lineNumber: number; column: number },
  ) => ProvideCompletionResult;
}

function fakeMonaco() {
  const registered: Array<{ lang: string; provider: CompletionProvider }> = [];
  const disposed = vi.fn();
  const monaco = {
    languages: {
      registerCompletionItemProvider: vi.fn((lang: string, provider: CompletionProvider) => {
        registered.push({ lang, provider });
        return { dispose: disposed };
      }),
      CompletionItemKind: { Variable: 1 },
    },
  } as unknown as Parameters<typeof useVariableCompletions>[1];
  const fakeEditor = {} as Parameters<typeof useVariableCompletions>[0];
  return { monaco, fakeEditor, registered, disposed };
}

const sampleScope: ResolutionScope = {
  contextVars: { CTX_VAR: 'one' },
  activeEnv: { BASE_URL: 'https://api', TOKEN: 'tok' },
  priorityEnvs: [],
  secrets: { SECRET_KEY: 'plain' },
};

describe('useVariableCompletions', () => {
  it('registers a provider for every handled language and disposes on unmount', () => {
    const { monaco, fakeEditor, registered, disposed } = fakeMonaco();
    const { unmount } = renderHook(() => useVariableCompletions(fakeEditor, monaco, sampleScope));
    expect(registered.map((r) => r.lang).sort()).toEqual(
      ['graphql', 'html', 'javascript', 'json', 'plaintext', 'xml'].sort(),
    );
    unmount();
    // 6 languages × 1 disposable each.
    expect(disposed).toHaveBeenCalledTimes(6);
  });

  it('does nothing when monaco / editor / scope is missing', () => {
    const { monaco, fakeEditor, registered } = fakeMonaco();
    renderHook(() => useVariableCompletions(null, monaco, sampleScope));
    expect(registered).toHaveLength(0);
    renderHook(() => useVariableCompletions(fakeEditor, null, sampleScope));
    expect(registered).toHaveLength(0);
    renderHook(() => useVariableCompletions(fakeEditor, monaco, null));
    expect(registered).toHaveLength(0);
  });

  it('returns no suggestions when the line has no open `{{`', () => {
    const { monaco, fakeEditor, registered } = fakeMonaco();
    renderHook(() => useVariableCompletions(fakeEditor, monaco, sampleScope));
    const provider = registered[0].provider;
    const result = provider.provideCompletionItems(
      { getValueInRange: () => 'hello world' },
      { lineNumber: 1, column: 12 },
    );
    expect(result.suggestions).toEqual([]);
  });

  it('returns no suggestions when the open token has been closed', () => {
    const { monaco, fakeEditor, registered } = fakeMonaco();
    renderHook(() => useVariableCompletions(fakeEditor, monaco, sampleScope));
    const provider = registered[0].provider;
    const result = provider.provideCompletionItems(
      { getValueInRange: () => '{{X}}' },
      { lineNumber: 1, column: 6 },
    );
    expect(result.suggestions).toEqual([]);
  });

  it('returns all suggestions inside an empty `{{` token', () => {
    const { monaco, fakeEditor, registered } = fakeMonaco();
    renderHook(() => useVariableCompletions(fakeEditor, monaco, sampleScope));
    const provider = registered[0].provider;
    const result = provider.provideCompletionItems(
      { getValueInRange: () => '{{' },
      { lineNumber: 1, column: 3 },
    );
    expect(result.suggestions.map((s) => s.label.label)).toEqual([
      'BASE_URL',
      'CTX_VAR',
      'SECRET_KEY',
      'TOKEN',
    ]);
  });

  it('filters by partial token text and prioritises context vars', () => {
    const { monaco, fakeEditor, registered } = fakeMonaco();
    renderHook(() => useVariableCompletions(fakeEditor, monaco, sampleScope));
    const provider = registered[0].provider;
    const result = provider.provideCompletionItems(
      { getValueInRange: () => '{{ctx' },
      { lineNumber: 1, column: 6 },
    );
    expect(result.suggestions.map((s) => s.label.label)).toEqual(['CTX_VAR']);
    expect(result.suggestions[0]?.sortText.startsWith('0')).toBe(true);
  });

  it('marks secrets with detail="Secret" rather than the masked preview', () => {
    const { monaco, fakeEditor, registered } = fakeMonaco();
    renderHook(() => useVariableCompletions(fakeEditor, monaco, sampleScope));
    const provider = registered[0].provider;
    const result = provider.provideCompletionItems(
      { getValueInRange: () => '{{SECRET' },
      { lineNumber: 1, column: 9 },
    );
    expect(result.suggestions[0]?.detail).toBe('Secret');
  });
});
