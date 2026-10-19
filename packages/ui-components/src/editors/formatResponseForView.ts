// How the response viewer shows a body: JSON pretty-printed, unless it is too
// large to format without stalling the editor.

import type { MonacoLanguage } from '@apicircle/core';

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

/**
 * A response body as the viewer shows it: JSON pretty-printed, unless it is too
 * large to format without stalling the editor, and anything else as it came.
 * The response panel compares this with the body itself to know whether a Raw
 * view would show anything different.
 */
export function formatResponseForView(value: string, language: MonacoLanguage): string {
  if (language !== 'json' || isLargeResponsePayload(value)) {
    return value;
  }
  return tryFormatJson(value);
}

/** A body large enough that the editor should not format or fold it. */
export function isLargeResponsePayload(value: string): boolean {
  return estimatePayloadBytes(value) >= LARGE_PAYLOAD_THRESHOLD_BYTES;
}
