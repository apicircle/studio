import { utf8ByteLength } from '@apicircle/shared';
import { toToon } from './toon';
import { toYaml } from './yaml';
import { toCsv } from './csv';

/**
 * Output formats we measure savings for. Minification is NOT in this
 * list on purpose — stripping whitespace from pretty-printed JSON isn't
 * a "transformation", it's the wire-effective baseline most APIs already
 * send. Comparing TOON/YAML/CSV against pretty JSON would inflate the
 * apparent savings; we always normalize to minified JSON first.
 */
export type TransformFormat = 'toon' | 'yaml' | 'csv';

export interface TransformCandidate {
  format: TransformFormat;
  /** Encoded payload. Available so the UI can offer "view" / "copy". */
  preview: string;
  /** UTF-8 bytes of `preview`. */
  bytes: number;
  /**
   * Bytes saved vs `minifiedBytes` (the wire baseline), expressed as a
   * percentage with one decimal. Clamped at 0 — candidates that don't
   * beat the baseline are dropped from `candidates` entirely.
   */
  percentSaved: number;
}

export interface TransformSavings {
  /** UTF-8 bytes of the body as received (may be pretty-printed). */
  originalBytes: number;
  /**
   * UTF-8 bytes of the same body re-emitted as compact JSON. This is
   * the honest wire-baseline — most APIs already send minified JSON,
   * and any "transformation savings" should be measured against that,
   * not against a verbose pretty-printed version. When `originalBytes ===
   * minifiedBytes`, the wire body was already compact; when they differ,
   * the UI can surface that delta separately as a "minify only" tip
   * without mixing it into transformation savings.
   */
  minifiedBytes: number;
  /** Sorted by percentSaved descending. Empty when nothing beats minified. */
  candidates: TransformCandidate[];
}

/**
 * Compute savings candidates for a response body. Only JSON-shaped
 * content is inspected — binary, plain text, and HTML return an empty
 * candidate list. Pure, no side effects.
 *
 * Baselines:
 *  - `originalBytes`  : received-as-is. What the editor is currently rendering.
 *  - `minifiedBytes`  : what the wire would have carried with whitespace stripped.
 *  - `candidates[].percentSaved` : measured against `minifiedBytes`. So a
 *    "20% smaller as TOON" claim means TOON beats compact JSON by 20%,
 *    not that it beats pretty JSON by 20%.
 */
export function computeTransformSavings(body: string, contentType?: string): TransformSavings {
  const originalBytes = utf8ByteLength(body);
  if (!isJsonLike(body, contentType)) {
    return { originalBytes, minifiedBytes: originalBytes, candidates: [] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { originalBytes, minifiedBytes: originalBytes, candidates: [] };
  }

  const minified = JSON.stringify(parsed);
  const minifiedBytes = utf8ByteLength(minified);

  const candidates: TransformCandidate[] = [];

  try {
    const toon = toToon(parsed as Parameters<typeof toToon>[0]);
    if (toon && toon !== minified) {
      candidates.push(makeCandidate('toon', toon, minifiedBytes));
    }
  } catch {
    // Encoder bug shouldn't break the response panel — silently skip.
  }

  try {
    const yaml = toYaml(parsed as Parameters<typeof toYaml>[0]);
    if (yaml && yaml !== minified) {
      candidates.push(makeCandidate('yaml', yaml, minifiedBytes));
    }
  } catch {
    // Same: don't crash the panel on an encoder hiccup.
  }

  const csv = toCsv(parsed as Parameters<typeof toCsv>[0]);
  if (csv) {
    candidates.push(makeCandidate('csv', csv, minifiedBytes));
  }

  return {
    originalBytes,
    minifiedBytes,
    candidates: candidates
      .filter((c) => c.bytes < minifiedBytes)
      .sort((a, b) => b.percentSaved - a.percentSaved),
  };
}

function makeCandidate(
  format: TransformFormat,
  preview: string,
  baselineBytes: number,
): TransformCandidate {
  const bytes = utf8ByteLength(preview);
  const ratio = baselineBytes === 0 ? 0 : 1 - bytes / baselineBytes;
  return {
    format,
    preview,
    bytes,
    percentSaved: Math.max(0, Math.round(ratio * 1000) / 10),
  };
}

function isJsonLike(body: string, contentType?: string): boolean {
  if (contentType && /\bjson\b/i.test(contentType)) return true;
  // Best-effort sniff for missing/wrong content-type: strict trim, then
  // require an opening brace/bracket. Avoids accidentally trying to JSON
  // parse an HTML page.
  const trimmed = body.trim();
  if (!trimmed) return false;
  return trimmed.startsWith('{') || trimmed.startsWith('[');
}

export const TRANSFORM_FORMAT_LABELS: Record<TransformFormat, string> = {
  toon: 'TOON',
  yaml: 'YAML',
  csv: 'CSV',
};
