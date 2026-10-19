// Read-only Monaco for the response panel. Auto-formats JSON for
// readability (the network body usually arrives un-pretty-printed), and
// disables formatting on huge payloads to keep the editor responsive.

import { useMemo } from 'react';
import { MonacoEditorBase } from './MonacoEditorBase';
import { formatResponseForView, isLargeResponsePayload } from './formatResponseForView';
import { useMonacoLanguage } from './useMonacoLanguage';

export interface MonacoResponseViewerProps {
  value: string;
  contentType?: string;
  height?: number | string;
  minHeight?: number;
  modelPath?: string;
  ariaLabel?: string;
  /**
   * Show `value` exactly as given, without pretty-printing it: for a caller that
   * has already formatted it (`formatResponseForView`), or wants the body as it
   * was received.
   */
  asGiven?: boolean;
}

export function MonacoResponseViewer({
  value,
  contentType,
  height,
  minHeight = 200,
  modelPath,
  ariaLabel,
  asGiven = false,
}: MonacoResponseViewerProps) {
  const language = useMonacoLanguage(contentType);
  const isLargePayload = useMemo(() => isLargeResponsePayload(value), [value]);

  const displayValue = useMemo(
    () => (asGiven ? value : formatResponseForView(value, language)),
    [asGiven, language, value],
  );

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
