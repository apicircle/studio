// Register a Monaco completion provider that surfaces workspace env / context
// / secret variables when the user types `{{`. Hooked from MonacoBodyEditor
// so it picks up live changes to the active environment + context vars
// without re-mounting the editor.
//
// The provider is global — Monaco doesn't scope completion providers to a
// single editor instance — but we re-register on every scope change so the
// suggestion list reflects the current workspace. The disposable is cleaned
// up on unmount so the registry doesn't leak on hot-reload.

import { useEffect } from 'react';
import type { Monaco } from '@monaco-editor/react';
import type { editor, IDisposable, languages, Position } from 'monaco-editor';
import { collectVariableSuggestions, type ResolutionScope } from '@apicircle/core';

const HANDLED_LANGUAGES: ReadonlyArray<string> = [
  'json',
  'xml',
  'plaintext',
  'graphql',
  'javascript',
  'html',
];

export function useVariableCompletions(
  editorInstance: editor.IStandaloneCodeEditor | null,
  monaco: Monaco | null,
  scope: ResolutionScope | null,
): void {
  useEffect(() => {
    if (!monaco || !editorInstance || !scope) return;
    const disposables: IDisposable[] = [];
    const provider: languages.CompletionItemProvider = {
      triggerCharacters: ['{'],
      provideCompletionItems(
        model,
        position: Position,
      ): languages.ProviderResult<languages.CompletionList> {
        const lineUpToCursor = model.getValueInRange({
          startLineNumber: position.lineNumber,
          startColumn: 1,
          endLineNumber: position.lineNumber,
          endColumn: position.column,
        });
        const open = lineUpToCursor.lastIndexOf('{{');
        if (open === -1) return { suggestions: [] };
        const fragment = lineUpToCursor.slice(open + 2);
        if (fragment.includes('}}')) return { suggestions: [] };
        const suggestions = collectVariableSuggestions(scope);
        const fragmentLower = fragment.trim().toLowerCase();
        const filtered = fragmentLower
          ? suggestions.filter((s) => s.key.toLowerCase().includes(fragmentLower))
          : suggestions;

        const replaceRange = {
          startLineNumber: position.lineNumber,
          startColumn: open + 1,
          endLineNumber: position.lineNumber,
          endColumn: position.column,
        };
        return {
          suggestions: filtered.map((s) => ({
            label: { label: s.key, description: s.source },
            kind: monaco.languages.CompletionItemKind.Variable,
            insertText: `{{${s.key}}}`,
            detail: s.source === 'secret' ? 'Secret' : s.preview,
            range: replaceRange,
            sortText: s.source === 'context' ? `0${s.key}` : `1${s.key}`,
          })),
        };
      },
    };
    for (const lang of HANDLED_LANGUAGES) {
      disposables.push(monaco.languages.registerCompletionItemProvider(lang, provider));
    }
    return () => {
      for (const d of disposables) d.dispose();
    };
  }, [editorInstance, monaco, scope]);
}
