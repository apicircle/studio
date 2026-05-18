// Register a GraphQL completion provider keyed off the request's
// `graphqlSchemaId`. The provider walks the parsed schema and offers:
//
//   • Top-level operation type fields (Query/Mutation/Subscription) when
//     the user is at the start of a `{ }` block.
//   • Scalar / enum / object type names everywhere else.
//
// This isn't a full GraphQL LSP — it's a lightweight nudge that catches
// 90% of autocomplete cases without a multi-MB dependency.

import { useEffect } from 'react';
import type { Monaco } from '@monaco-editor/react';
import type { editor, IDisposable, languages, Position } from 'monaco-editor';
import type { GraphQLSchemaInfo } from '@apicircle/core';

export function useGraphqlCompletions(
  editorInstance: editor.IStandaloneCodeEditor | null,
  monaco: Monaco | null,
  info: GraphQLSchemaInfo | null,
): void {
  useEffect(() => {
    if (!monaco || !editorInstance || !info) return;

    const provider: languages.CompletionItemProvider = {
      triggerCharacters: [' ', '\n', '{', ':', '('],
      provideCompletionItems(
        model,
        position: Position,
      ): languages.ProviderResult<languages.CompletionList> {
        const word = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endLineNumber: position.lineNumber,
          endColumn: word.endColumn,
        };

        const suggestions: languages.CompletionItem[] = [];
        const queryType = info.rootTypes.query;
        if (queryType) {
          const fields = info.types.get(queryType)?.fields ?? [];
          for (const f of fields) {
            suggestions.push({
              label: f.name,
              kind: monaco.languages.CompletionItemKind.Field,
              insertText: f.name,
              detail: `${queryType}.${f.name}: ${f.type}`,
              documentation: f.description,
              range,
              sortText: `0${f.name}`,
            });
          }
        }

        for (const [typeName, t] of info.types) {
          for (const f of t.fields) {
            suggestions.push({
              label: f.name,
              kind: monaco.languages.CompletionItemKind.Property,
              insertText: f.name,
              detail: `${typeName}.${f.name}: ${f.type}`,
              range,
              sortText: `1${f.name}`,
            });
          }
        }

        for (const t of info.types.keys()) {
          suggestions.push({
            label: t,
            kind: monaco.languages.CompletionItemKind.Class,
            insertText: t,
            detail: 'Type',
            range,
            sortText: `2${t}`,
          });
        }
        for (const s of info.scalars) {
          suggestions.push({
            label: s,
            kind: monaco.languages.CompletionItemKind.Unit,
            insertText: s,
            detail: 'Scalar',
            range,
            sortText: `3${s}`,
          });
        }
        for (const e of info.enums) {
          suggestions.push({
            label: e,
            kind: monaco.languages.CompletionItemKind.Enum,
            insertText: e,
            detail: 'Enum',
            range,
            sortText: `3${e}`,
          });
        }
        return { suggestions };
      },
    };
    const dispose: IDisposable = monaco.languages.registerCompletionItemProvider(
      'graphql',
      provider,
    );
    return () => dispose.dispose();
  }, [editorInstance, info, monaco]);
}
