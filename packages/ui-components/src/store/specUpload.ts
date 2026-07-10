// Parse-on-upload: when a Global File Asset's bytes are an OpenAPI/Swagger
// document, derive its `SpecAssetMeta` so the asset carries a spec summary the
// Assets panel and the mock "run/import from spec" flows can read. Browser-safe
// (uses the `/parsing` subpath); guarded by extension/MIME so a large binary
// upload is never decoded as text.

import type { SpecAssetMeta } from '@apicircle/shared';

/** True when the filename/MIME suggests a textual (JSON/YAML) payload worth
 *  sniffing as a spec — so we never UTF-8-decode a large binary blob. */
export function looksTextual(filename: string, mimeType: string): boolean {
  const name = filename.toLowerCase();
  return (
    name.endsWith('.json') ||
    name.endsWith('.yaml') ||
    name.endsWith('.yml') ||
    /json|yaml|text/i.test(mimeType)
  );
}

/**
 * Derive a {@link SpecAssetMeta} from freshly-uploaded bytes when they are an
 * OpenAPI/Swagger document, else `undefined`. `nowIso` is injected so the
 * caller stamps `parsedAt` with the store's clock (and tests stay
 * deterministic).
 */
export async function summarizeUploadedSpec(
  bytes: Uint8Array,
  filename: string,
  mimeType: string,
  nowIso: string,
): Promise<SpecAssetMeta | undefined> {
  if (!looksTextual(filename, mimeType)) return undefined;
  const { summarizeSpec } = await import('@apicircle/mock-server-core/parsing');
  const text = new TextDecoder().decode(bytes);
  const summary = summarizeSpec(text, filename);
  if (!summary) return undefined;
  return { ...summary, parsedAt: nowIso };
}
