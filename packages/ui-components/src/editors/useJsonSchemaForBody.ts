// Wire Monaco's built-in JSON Schema diagnostics to the request body
// editor when the request has a `bodySchemaId` mapping to a workspace
// JSON Schema. Re-registers on every change to the schema or the
// editor's model path so user edits in Global Assets feed back into
// the editor without remounting.
//
// Failure modes are silent: an unparseable schema string just skips
// registration so the user keeps a working editor while they fix it.

import { useEffect } from 'react';
import type { Monaco } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';

interface JsonSchemaConfig {
  /** The Monaco model URI to apply the schema to. */
  modelUri: string;
  /** A stable id for the schema; used as the registration's `uri`. */
  schemaId: string;
  /** The JSON Schema text. Empty / unparseable disables validation. */
  schemaText: string | null;
}

export function useJsonSchemaForBody(
  monaco: Monaco | null,
  editorInstance: editor.IStandaloneCodeEditor | null,
  config: JsonSchemaConfig | null,
): void {
  useEffect(() => {
    if (!monaco || !editorInstance || !config) return;
    const json = monaco.languages.json;
    if (!json?.jsonDefaults) return;

    let parsed: unknown;
    if (config.schemaText) {
      try {
        parsed = JSON.parse(config.schemaText);
      } catch {
        // Bad schema — clear any existing entry for this model so we don't
        // leave stale validation hanging around.
        applySchemas(json, (current) => current.filter((s) => s.uri !== config.schemaId));
        return;
      }
    }

    const entry = parsed
      ? {
          uri: config.schemaId,
          fileMatch: [config.modelUri],
          schema: parsed,
        }
      : null;

    applySchemas(json, (current) => {
      const filtered = current.filter((s) => s.uri !== config.schemaId);
      return entry ? [...filtered, entry] : filtered;
    });

    return () => {
      applySchemas(json, (current) => current.filter((s) => s.uri !== config.schemaId));
    };
  }, [config, editorInstance, monaco]);
}

function applySchemas(
  json: NonNullable<Monaco['languages']['json']>,
  patch: (
    current: ReadonlyArray<{ uri: string; fileMatch?: string[]; schema?: object }>,
  ) => Array<{ uri: string; fileMatch?: string[]; schema?: object }>,
): void {
  const defaults = json.jsonDefaults;
  const opts = defaults.diagnosticsOptions;
  const next = patch(opts.schemas ?? []);
  defaults.setDiagnosticsOptions({
    ...opts,
    validate: true,
    allowComments: false,
    schemas: next,
  });
}
