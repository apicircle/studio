// Monaco for the request body. Picks a language from the request's
// Content-Type (or the body type radio when there's no header), then
// renders MonacoEditorBase. JSON Schema validation, env-var autocomplete,
// and (later) GraphQL completion hang off the editor instance via hooks.

import { type CSSProperties, useCallback, useMemo, useState } from 'react';
import type { Monaco } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import type { BodyType, Request as ApiRequest } from '@apicircle/shared';
import { getLanguageFromBodyType, type MonacoLanguage } from '@apicircle/core';
import { useWorkspaceStore } from '../store/workspaceStore';
import { MonacoEditorBase } from './MonacoEditorBase';
import { useMonacoLanguage } from './useMonacoLanguage';
import { useVariableCompletions } from './useVariableCompletions';
import { useVariableScope } from './useVariableScope';
import { useJsonSchemaForBody } from './useJsonSchemaForBody';
import { useGraphqlCompletions } from './useGraphqlCompletions';
import { parseGraphqlSchema } from '@apicircle/core';

export interface MonacoBodyEditorProps {
  value: string;
  bodyType: BodyType;
  contentType?: string;
  onChange?: (value: string) => void;
  height?: number | string;
  minHeight?: number;
  readOnly?: boolean;
  modelPath?: string;
  containerStyle?: CSSProperties;
  ariaLabel?: string;
  /** Optional — enables env/context/secret autocomplete on `{{` and JSON Schema validation. */
  request?: ApiRequest | null;
  onEditorMount?: (editorInstance: editor.IStandaloneCodeEditor, monaco: Monaco) => void;
}

export function MonacoBodyEditor({
  value,
  bodyType,
  contentType,
  onChange,
  height,
  minHeight,
  readOnly,
  modelPath,
  containerStyle,
  ariaLabel,
  request,
  onEditorMount,
}: MonacoBodyEditorProps) {
  // The Content-Type header wins when present (e.g. `application/vnd.api+json`
  // resolves to JSON). Fall back to the body-type radio for the everyday case
  // where the header isn't set yet.
  const languageFromContentType = useMonacoLanguage(contentType);
  const language: MonacoLanguage = contentType
    ? languageFromContentType
    : getLanguageFromBodyType(bodyType);

  const [editorInstance, setEditorInstance] = useState<editor.IStandaloneCodeEditor | null>(null);
  const [monacoInstance, setMonacoInstance] = useState<Monaco | null>(null);
  const scope = useVariableScope(request ?? null);
  useVariableCompletions(editorInstance, monacoInstance, scope);

  // Resolve the request's bodySchemaId to a schema from the workspace
  // library. When the body is JSON and the schema parses, Monaco's JSON
  // language service surfaces validation errors inline.
  const schemaText = useWorkspaceStore((s) =>
    request?.bodySchemaId
      ? (s.synced?.globalAssets.schemas[request.bodySchemaId]?.schema ?? null)
      : null,
  );
  const jsonSchemaConfig = useMemo(() => {
    if (!modelPath || language !== 'json' || !request?.bodySchemaId || !schemaText) return null;
    return {
      modelUri: modelPath,
      schemaId: `apicircle://schema/${request.bodySchemaId}`,
      schemaText,
    };
  }, [language, modelPath, request?.bodySchemaId, schemaText]);
  useJsonSchemaForBody(monacoInstance, editorInstance, jsonSchemaConfig);

  // GraphQL: parse the linked schema and feed it to the completion
  // provider. Re-parses only when the source changes.
  const graphqlEntry = useWorkspaceStore((s) =>
    request?.graphqlSchemaId
      ? (s.synced?.globalAssets.graphql[request.graphqlSchemaId] ?? null)
      : null,
  );
  const graphqlInfo = useMemo(() => {
    if (!graphqlEntry || language !== 'graphql') return null;
    return parseGraphqlSchema(graphqlEntry.source, graphqlEntry.kind);
  }, [graphqlEntry, language]);
  useGraphqlCompletions(editorInstance, monacoInstance, graphqlInfo);

  const handleMount = useCallback(
    (instance: editor.IStandaloneCodeEditor, monaco: Monaco) => {
      setEditorInstance(instance);
      setMonacoInstance(monaco);
      onEditorMount?.(instance, monaco);
    },
    [onEditorMount],
  );

  return (
    <MonacoEditorBase
      value={value}
      language={language}
      onChange={onChange}
      readOnly={readOnly}
      height={height}
      minHeight={minHeight}
      modelPath={modelPath}
      containerStyle={containerStyle}
      ariaLabel={ariaLabel}
      onEditorMount={handleMount}
    />
  );
}
