// Read-only Monaco for the response panel. Auto-formats JSON for
// readability (the network body usually arrives un-pretty-printed), and
// disables formatting on huge payloads to keep the editor responsive.

import { useMemo } from 'react';
import { MonacoEditorBase } from './MonacoEditorBase';
import { useMonacoLanguage } from './useMonacoLanguage';

const LARGE_PAYLOAD_THRESHOLD_BYTES = 5 * 1024 * 1024;

function estimatePayloadBytes(value: string): number {
  if (typeof TextEncoder === 'undefined') return value.length;
  return new TextEncoder().encode(value).byteLength;
}

function tryFormatJson(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

export interface MonacoResponseViewerProps {
  value: string;
  contentType?: string;
  height?: number | string;
  minHeight?: number;
  modelPath?: string;
  ariaLabel?: string;
}

export function MonacoResponseViewer({
  value,
  contentType,
  height,
  minHeight = 200,
  modelPath,
  ariaLabel,
}: MonacoResponseViewerProps) {
  const language = useMonacoLanguage(contentType);
  const isLargePayload = useMemo(
    () => estimatePayloadBytes(value) >= LARGE_PAYLOAD_THRESHOLD_BYTES,
    [value],
  );

  const displayValue = useMemo(() => {
    if (language !== 'json' || isLargePayload) return value;
    return tryFormatJson(value);
  }, [isLargePayload, language, value]);

  return (
    <MonacoEditorBase
      value={displayValue}
      language={language}
      readOnly
      height={height}
      minHeight={minHeight}
      modelPath={modelPath}
      largePayload={isLargePayload}
      ariaLabel={ariaLabel}
    />
  );
}
