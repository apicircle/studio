// React wrapper around `@monaco-editor/react` with three jobs:
//   1. Lazy-load the editor module (it's ~2 MB un-gzipped — keeps the
//      web shell startup cheap; first request that opens an editor pays).
//   2. Register all six v2 themes the first time Monaco mounts, then
//      switch between them as the workspace theme changes.
//   3. Fall back to a plain <textarea> when monaco fails to load (offline,
//      adblocker, etc.) — the user still gets a working editor.
//
// `automaticLayout: true` is the load-bearing option for resize/fullscreen:
// react-resizable-panels mutates the container size; Monaco watches the
// container and re-flows on its own.

import {
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
  type CSSProperties,
  type ComponentType,
} from 'react';
import type { EditorProps, Monaco } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import type { MonacoLanguage } from '@apicircle/core';
import { useApplyMonacoLanguage } from './useMonacoLanguage';
import { useWorkspaceStore } from '../store/workspaceStore';
import { getMonacoThemeId, registerMonacoThemes } from '../theme/monacoThemes';

const DEFAULT_MIN_HEIGHT = 200;
const DEFAULT_LARGE_PAYLOAD_THRESHOLD_BYTES = 5 * 1024 * 1024;

let monacoEditorLoader: Promise<ComponentType<EditorProps> | null> | null = null;

async function loadMonacoEditorComponent(): Promise<ComponentType<EditorProps> | null> {
  if (!monacoEditorLoader) {
    monacoEditorLoader = import('@monaco-editor/react')
      .then((module) => module.default as ComponentType<EditorProps>)
      .catch(() => null);
  }
  return monacoEditorLoader;
}

export function __resetMonacoEditorLoaderForTests(): void {
  monacoEditorLoader = null;
}

function estimatePayloadBytes(value: string): number {
  if (typeof TextEncoder === 'undefined') return value.length;
  return new TextEncoder().encode(value).byteLength;
}

export interface MonacoEditorBaseProps {
  value: string;
  language: MonacoLanguage;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  className?: string;
  containerStyle?: CSSProperties;
  height?: number | string;
  minHeight?: number;
  modelPath?: string;
  options?: editor.IStandaloneEditorConstructionOptions;
  largePayload?: boolean;
  largePayloadThresholdBytes?: number;
  beforeMount?: (monaco: Monaco) => void;
  onEditorMount?: (editorInstance: editor.IStandaloneCodeEditor, monaco: Monaco) => void;
  ariaLabel?: string;
}

function MonacoEditorBaseComponent({
  value,
  language,
  onChange,
  readOnly = false,
  className,
  containerStyle: containerStyleOverride,
  height,
  minHeight = DEFAULT_MIN_HEIGHT,
  modelPath,
  options,
  largePayload,
  largePayloadThresholdBytes = DEFAULT_LARGE_PAYLOAD_THRESHOLD_BYTES,
  beforeMount,
  onEditorMount,
  ariaLabel,
}: MonacoEditorBaseProps) {
  const themeId = useWorkspaceStore((state) => state.local?.ui.themeId ?? 'studio-dark');
  const [editorComponent, setEditorComponent] = useState<ComponentType<EditorProps> | null>(null);
  const [editorInstance, setEditorInstance] = useState<editor.IStandaloneCodeEditor | null>(null);
  const [monacoInstance, setMonacoInstance] = useState<Monaco | null>(null);
  const generatedId = useId();

  useEffect(() => {
    let mounted = true;
    void loadMonacoEditorComponent().then((loadedEditorComponent) => {
      if (!mounted) return;
      setEditorComponent(() => loadedEditorComponent);
    });
    return () => {
      mounted = false;
    };
  }, []);

  // Drop the test-registry entry on unmount so subsequent renders of an
  // editor with the same aria-label don't see a stale instance.
  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && ariaLabel) {
        const w = window as unknown as {
          __apicircleEditors?: Map<string, editor.IStandaloneCodeEditor>;
        };
        w.__apicircleEditors?.delete(ariaLabel);
      }
    };
  }, [ariaLabel]);

  const editorModelPath = useMemo(() => {
    if (modelPath) return modelPath;
    return `inmemory://apicircle/${generatedId.replaceAll(':', '_')}.payload`;
  }, [generatedId, modelPath]);

  const resolvedHeight = useMemo(() => {
    if (height === undefined || height === null) return `${minHeight}px`;
    if (typeof height === 'number') return `${height}px`;
    return height;
  }, [height, minHeight]);
  const monacoThemeId = useMemo(() => getMonacoThemeId(themeId), [themeId]);

  const isLargePayload = useMemo(() => {
    if (typeof largePayload === 'boolean') return largePayload;
    return estimatePayloadBytes(value) >= largePayloadThresholdBytes;
  }, [largePayload, largePayloadThresholdBytes, value]);

  const lineCount = useMemo(() => {
    let count = 1;
    for (let i = 0; i < value.length; i++) {
      if (value.charCodeAt(i) === 10) count++;
    }
    return count;
  }, [value]);

  const mergedOptions = useMemo<editor.IStandaloneEditorConstructionOptions>(() => {
    const baseOptions: editor.IStandaloneEditorConstructionOptions = {
      readOnly,
      minimap: { enabled: false },
      fontSize: 12,
      automaticLayout: true,
      scrollBeyondLastLine: false,
      wordWrap: isLargePayload ? 'off' : 'on',
      fontFamily:
        '"JetBrains Mono", "Fira Code", Menlo, Monaco, Consolas, "Courier New", monospace',
      tabSize: 2,
      insertSpaces: true,
      smoothScrolling: true,
      formatOnPaste: !readOnly && !isLargePayload,
      formatOnType: !readOnly && !isLargePayload,
      largeFileOptimizations: true,
      links: !isLargePayload,
      codeLens: !isLargePayload,
      occurrencesHighlight: isLargePayload ? 'off' : 'singleFile',
      selectionHighlight: !isLargePayload,
      quickSuggestions: !isLargePayload,
      renderValidationDecorations: isLargePayload ? 'off' : 'on',
      folding: !isLargePayload,
      padding: { top: 8, bottom: 8 },
      lineNumbers: 'on',
      glyphMargin: false,
      lineDecorationsWidth: 4,
      lineNumbersMinChars: Math.max(2, String(lineCount).length),
    };
    return {
      ...baseOptions,
      ...options,
      minimap: { enabled: false, ...(options?.minimap ?? {}) },
    };
  }, [isLargePayload, lineCount, options, readOnly]);

  const containerStyle = useMemo<CSSProperties>(
    () => ({
      width: '100%',
      height: resolvedHeight,
      minHeight,
      overflow: 'hidden',
      ...containerStyleOverride,
    }),
    [containerStyleOverride, minHeight, resolvedHeight],
  );

  const fallbackStyle = useMemo<CSSProperties>(
    () => ({
      width: '100%',
      height: '100%',
      minHeight,
      border: 'none',
      padding: 8,
      fontSize: 12,
      lineHeight: 1.5,
      fontFamily: 'JetBrains Mono, Menlo, Monaco, "Courier New", monospace',
      background: 'transparent',
      color: 'inherit',
      resize: 'none',
      outline: 'none',
      boxSizing: 'border-box',
    }),
    [minHeight],
  );

  const handleBeforeMount = useCallback(
    (monaco: Monaco) => {
      setMonacoInstance(monaco);
      registerMonacoThemes(monaco.editor);
      beforeMount?.(monaco);
    },
    [beforeMount],
  );

  const handleMount = useCallback(
    (instance: editor.IStandaloneCodeEditor, monaco: Monaco) => {
      setEditorInstance(instance);
      setMonacoInstance(monaco);
      // Test-friendly registry. Monaco's hidden textarea fights synthetic
      // typing (auto-bracket pairs, suggestion popups), so e2e specs need
      // a way to set the editor value programmatically. We expose the
      // instance keyed by aria-label on a window-bound map; production
      // doesn't depend on this hook, but Playwright specs read it.
      if (typeof window !== 'undefined' && ariaLabel) {
        const w = window as unknown as {
          __apicircleEditors?: Map<string, editor.IStandaloneCodeEditor>;
        };
        if (!w.__apicircleEditors) w.__apicircleEditors = new Map();
        w.__apicircleEditors.set(ariaLabel, instance);
      }
      onEditorMount?.(instance, monaco);
    },
    [ariaLabel, onEditorMount],
  );

  const handleChange = useCallback<NonNullable<EditorProps['onChange']>>(
    (nextValue) => {
      onChange?.(nextValue ?? '');
    },
    [onChange],
  );

  useApplyMonacoLanguage(editorInstance, monacoInstance, language);

  if (!editorComponent) {
    return (
      <div className={className} style={containerStyle} data-testid="monaco-fallback">
        <textarea
          value={value}
          onChange={(event) => onChange?.(event.target.value)}
          readOnly={readOnly}
          spellCheck={false}
          aria-label={ariaLabel}
          style={fallbackStyle}
        />
      </div>
    );
  }

  const EditorComponent = editorComponent;

  return (
    <div
      className={className}
      style={containerStyle}
      data-testid="monaco-editor"
      aria-label={ariaLabel}
    >
      <EditorComponent
        value={value}
        path={editorModelPath}
        defaultLanguage={language}
        theme={monacoThemeId}
        options={mergedOptions}
        onChange={handleChange}
        beforeMount={handleBeforeMount}
        onMount={handleMount}
        keepCurrentModel
        saveViewState
        width="100%"
        height="100%"
        loading={
          <div className="px-2 py-1 text-xs text-text-muted" role="status">
            Loading editor…
          </div>
        }
      />
    </div>
  );
}

export const MonacoEditorBase = memo(MonacoEditorBaseComponent);
