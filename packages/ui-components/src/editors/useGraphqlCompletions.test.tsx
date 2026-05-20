import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { GraphQLSchemaInfo } from '@apicircle/core';
import { useGraphqlCompletions } from './useGraphqlCompletions';

interface FakeRange {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

interface CompletionItem {
  label: string;
  kind: number;
  insertText: string;
  detail?: string;
  range: FakeRange;
  sortText: string;
}

interface CompletionProvider {
  triggerCharacters?: string[];
  provideCompletionItems: (
    model: {
      getWordUntilPosition: (p: { lineNumber: number; column: number }) => {
        startColumn: number;
        endColumn: number;
      };
    },
    pos: { lineNumber: number; column: number },
  ) => { suggestions: CompletionItem[] };
}

function fakeMonaco() {
  const registered: CompletionProvider[] = [];
  const dispose = vi.fn();
  const monaco = {
    languages: {
      registerCompletionItemProvider: vi.fn((_lang: string, provider: CompletionProvider) => {
        registered.push(provider);
        return { dispose };
      }),
      CompletionItemKind: {
        Field: 1,
        Property: 2,
        Class: 3,
        Unit: 4,
        Enum: 5,
      },
    },
  } as unknown as Parameters<typeof useGraphqlCompletions>[1];
  const fakeEditor = {} as Parameters<typeof useGraphqlCompletions>[0];
  return { monaco, fakeEditor, registered, dispose };
}

const sampleInfo: GraphQLSchemaInfo = {
  types: new Map([
    [
      'Query',
      {
        fields: [
          { name: 'user', type: 'User', description: 'Look up a user' },
          { name: 'pets', type: '[Pet]' },
        ],
      },
    ],
    [
      'User',
      {
        fields: [
          { name: 'id', type: 'ID' },
          { name: 'name', type: 'String' },
        ],
      },
    ],
  ]),
  rootTypes: { query: 'Query' },
  scalars: ['DateTime'],
  enums: ['Role'],
};

describe('useGraphqlCompletions', () => {
  it('registers a single graphql provider and disposes on unmount', () => {
    const { monaco, fakeEditor, registered, dispose } = fakeMonaco();
    const { unmount } = renderHook(() => useGraphqlCompletions(fakeEditor, monaco, sampleInfo));
    expect(registered).toHaveLength(1);
    unmount();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('does nothing when monaco / editor / info is missing', () => {
    const { monaco, fakeEditor, registered } = fakeMonaco();
    renderHook(() => useGraphqlCompletions(null, monaco, sampleInfo));
    renderHook(() => useGraphqlCompletions(fakeEditor, null, sampleInfo));
    renderHook(() => useGraphqlCompletions(fakeEditor, monaco, null));
    expect(registered).toHaveLength(0);
  });

  it('surfaces Query fields, all-type fields, types, scalars, and enums', () => {
    const { monaco, fakeEditor, registered } = fakeMonaco();
    renderHook(() => useGraphqlCompletions(fakeEditor, monaco, sampleInfo));
    const provider = registered[0];
    const model = {
      getWordUntilPosition: () => ({ startColumn: 1, endColumn: 4 }),
    };
    const result = provider.provideCompletionItems(model, { lineNumber: 1, column: 4 });

    const labels = result.suggestions.map((s) => s.label);
    expect(labels).toContain('user'); // Query field, sortText 0...
    expect(labels).toContain('id'); // User field, sortText 1...
    expect(labels).toContain('User'); // type, sortText 2...
    expect(labels).toContain('DateTime'); // scalar, sortText 3...
    expect(labels).toContain('Role'); // enum, sortText 3...

    const userField = result.suggestions.find(
      (s) => s.label === 'user' && s.detail?.includes('User'),
    );
    expect(userField).toBeDefined();
    expect(userField!.sortText.startsWith('0')).toBe(true);
  });

  it('handles a schema with no Query root type without throwing', () => {
    const noQuery: GraphQLSchemaInfo = {
      types: new Map([['Order', { fields: [{ name: 'id', type: 'ID' }] }]]),
      rootTypes: {},
      scalars: [],
      enums: [],
    };
    const { monaco, fakeEditor, registered } = fakeMonaco();
    renderHook(() => useGraphqlCompletions(fakeEditor, monaco, noQuery));
    const provider = registered[0];
    const model = { getWordUntilPosition: () => ({ startColumn: 1, endColumn: 1 }) };
    const result = provider.provideCompletionItems(model, { lineNumber: 1, column: 1 });
    // No Query field bucket — but Order field + Order type still present.
    expect(result.suggestions.map((s) => s.label)).toContain('id');
    expect(result.suggestions.map((s) => s.label)).toContain('Order');
  });
});
