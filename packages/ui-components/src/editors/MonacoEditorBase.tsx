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
import { FONT_SIZE_PERCENT_DEFAULT } from '@apicircle/shared';
import { useApplyMonacoLanguage } from './useMonacoLanguage';
import { useWorkspaceStore } from '../store/workspaceStore';
import { getMonacoThemeId, registerMonacoThemes } from '../theme/monacoThemes';

const MONACO_BASE_FONT_SIZE_PX = 12;

const DEFAULT_MIN_HEIGHT = 200;
const DEFAULT_LARGE_PAYLOAD_THRESHOLD_BYTES = 5 * 1024 * 1024;

let monacoEditorLoader: Promise<ComponentType<EditorProps> | null> | null = null;

async function loadMonacoEditorComponent(): Promise<ComponentType<EditorProps> | null> {
  if (!monacoEditorLoader) {
    monacoEditorLoader = (async () => {
      try {
        const reactModule = await import('@monaco-editor/react');
        // Point `@monaco-editor/react`'s loader at the local
        // `monaco-editor` AMD bundle served by the Vite dev server / the
        // packaged build, instead of letting it fetch from jsdelivr's
        // CDN. The CDN path was racing under Playwright parallel-worker
        // load (lazy chunk hung on `Loading editor…` indefinitely);
        // serving locally is deterministic and matches the desktop
        // runtime which has no network at all. See vite.config.ts +
        // `apps/web/public/monaco-vendor` for how the bundle is served.
        //
        // The `vs` path MUST be absolute (origin-qualified). Monaco spawns
        // its language workers (JSON/TS/CSS) inside a blob-URL worker; a
        // root-relative `/monaco-vendor/vs` can't be resolved against a
        // `blob:` base, so the worker's `importScripts` throws "invalid
        // URL" and JSON-schema / syntax diagnostics silently never run.
        const vsBase =
          typeof window !== 'undefined'
            ? `${window.location.origin}/monaco-vendor/vs`
            : '/monaco-vendor/vs';
        reactModule.loader.config({ paths: { vs: vsBase } });
        return reactModule.default as ComponentType<EditorProps>;
      } catch {
        return null;
      }
    })();
  }
  return monacoEditorLoader;
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
  // Workspace setting: when true, the editor's scrollbar consumes wheel
  // events and the page won't scroll while the cursor sits in the editor.
  // Default false — most users find page-scroll-friendly behavior less
  // surprising than Monaco's default trap.
  const monacoConsumesWheel = useWorkspaceStore(
    (state) => state.local?.settings?.monacoConsumesWheel ?? false,
  );
  // Monaco's `fontSize` option is numeric (px), not CSS — it doesn't
  // participate in the html-root font-size scaling that the rest of the
  // UI rides on. Derive a scaled px size from the workspace setting so
  // the editor keeps visual parity with the chrome around it.
  const fontSizePercent = useWorkspaceStore(
    (state) => state.local?.ui.fontSizePercent ?? FONT_SIZE_PERCENT_DEFAULT,
  );
  const scaledFontSize = Math.max(
    1,
    Math.round((MONACO_BASE_FONT_SIZE_PX * fontSizePercent) / 100),
  );
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
      fontSize: scaledFontSize,
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
      // Honor the workspace setting. `alwaysConsumeMouseWheel: false`
      // releases the wheel back to the page once the editor reaches its
      // top/bottom (or when the editor's content fits in the viewport),
      // which is what most users expect on long pages with embedded
      // editors. Power-users who prefer Monaco's default eat-everything
      // behavior can flip the toggle in Settings.
      scrollbar: {
        alwaysConsumeMouseWheel: monacoConsumesWheel,
      },
    };
    return {
      ...baseOptions,
      ...options,
      minimap: { enabled: false, ...(options?.minimap ?? {}) },
      scrollbar: {
        ...baseOptions.scrollbar,
        ...(options?.scrollbar ?? {}),
      },
    };
  }, [isLargePayload, lineCount, monacoConsumesWheel, options, readOnly, scaledFontSize]);

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
      fontSize: scaledFontSize,
      lineHeight: 1.5,
      fontFamily: 'JetBrains Mono, Menlo, Monaco, "Courier New", monospace',
      background: 'transparent',
      color: 'inherit',
      resize: 'none',
      outline: 'none',
      boxSizing: 'border-box',
    }),
    [minHeight, scaledFontSize],
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
      // instance keyed by aria-label on a window-bound map, plus the
      // `monaco` namespace itself so specs can read model markers
      // (`monaco.editor.getModelMarkers`); production doesn't depend on
      // this hook, but Playwright specs read it.
      if (typeof window !== 'undefined') {
        const w = window as unknown as {
          __apicircleEditors?: Map<string, editor.IStandaloneCodeEditor>;
          monaco?: Monaco;
        };
        if (ariaLabel) {
          if (!w.__apicircleEditors) w.__apicircleEditors = new Map();
          w.__apicircleEditors.set(ariaLabel, instance);
        }
        w.monaco = monaco;
      }
      onEditorMount?.(instance, monaco);
    },
    [ariaLabel, onEditorMount],
  );

  // automaticLayout's ResizeObserver misses the initial sizing when Monaco
  // mounts into a container that gets its real size from a sibling
  // flex/Panel transition (e.g. ResponseViewer swapping its empty state
  // for the body editor on Send). Force layout on mount + on container
  // resizes — staggered timeouts catch cases where the parent's final
  // dimensions only settle after subsequent React commits.
  useEffect(() => {
    if (!editorInstance) return;
    const node = editorInstance.getContainerDomNode().parentElement;
    const relayout = () => {
      const r = node?.getBoundingClientRect();
      if (r && r.width > 0 && r.height > 0) {
        editorInstance.layout({ width: r.width, height: r.height });
      } else {
        editorInstance.layout();
      }
    };
    const timeouts = [setTimeout(relayout, 0), setTimeout(relayout, 50), setTimeout(relayout, 200)];
    let ro: ResizeObserver | null = null;
    if (node && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(relayout);
      ro.observe(node);
    }
    return () => {
      timeouts.forEach(clearTimeout);
      ro?.disconnect();
    };
  }, [editorInstance]);

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
