// Bridges studio-v2's Content-Type → Monaco language map (in core/editors)
// to live editor instances. `useMonacoLanguage` resolves a language id from
// a Content-Type header value; `useApplyMonacoLanguage` updates the editor's
// model language when the resolved language changes — this is what makes
// switching from JSON to XML in the body type radio re-tokenize the editor
// without recreating it.

import { useEffect, useMemo } from 'react';
import type { Monaco } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { getLanguageFromContentType, type MonacoLanguage } from '@apicircle/core';

export function useMonacoLanguage(contentType?: string): MonacoLanguage {
  return useMemo(() => getLanguageFromContentType(contentType), [contentType]);
}

export function useApplyMonacoLanguage(
  editorInstance: editor.IStandaloneCodeEditor | null,
  monaco: Monaco | null,
  language: MonacoLanguage,
): void {
  useEffect(() => {
    if (!editorInstance || !monaco) return;
    const model = editorInstance.getModel();
    if (!model) return;
    if (model.getLanguageId() === language) return;
    monaco.editor.setModelLanguage(model, language);
  }, [editorInstance, language, monaco]);
}
