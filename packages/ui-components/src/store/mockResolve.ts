// Resolve a MockServerSource to its endpoint table.
//
// `openapi-asset` sources (a spec-typed Global File Asset drives the mock)
// resolve the asset's bytes from IDB into an inline OpenAPI source first —
// bundled with the files a split spec points at (`readSpecAssetSource`) — so
// the SAME parser path serves paste-spec mocks, asset-backed "run live"
// (linked) mocks, and "import & edit" (materialized) mocks. On Desktop the
// parse runs in the Node main process (swagger-parser); in the browser it uses
// `@apicircle/mock-server-core/parsing`. Both resolve in-document refs only,
// which is all a bundled spec has.

import type { MockEndpoint, MockServerSource, WorkspaceSynced } from '@apicircle/shared';
import { getDesktopMockBridge } from '../desktop/bridge';
import { readSpecAssetSource } from './specSource';

// `requestShapeFromMockEndpoint` moved to `@apicircle/shared` (Increment K) so
// the store, the MCP server, and the VS Code extension all share one mapper.
// Re-exported here for the existing in-package import sites.
export { requestShapeFromMockEndpoint } from '@apicircle/shared';

export interface ResolvedMockEndpoints {
  endpoints: MockEndpoint[];
  warnings: string[];
}

export async function resolveMockEndpoints(
  source: MockServerSource,
  synced: WorkspaceSynced,
): Promise<ResolvedMockEndpoints> {
  if (source.kind === 'manual') return { endpoints: source.endpoints, warnings: [] };

  // Fold an asset-backed source into an inline OpenAPI source for parsing.
  let parseSource: MockServerSource = source;
  if (source.kind === 'openapi-asset') {
    const asset = synced.globalAssets.files?.[source.assetId];
    if (!asset) {
      return { endpoints: [], warnings: [`Spec asset "${source.assetId}" was not found.`] };
    }
    const spec = await readSpecAssetSource(synced, source.assetId);
    if (!spec) {
      return {
        endpoints: [],
        warnings: ['The spec asset bytes are not available locally — re-upload the file.'],
      };
    }
    parseSource = { kind: 'openapi', spec: spec.text, format: spec.format };
    // The bundler's own findings (a referenced file that would not parse) come
    // first; the parser then names every reference still left unresolved.
    const parsed = await parse(parseSource);
    return { ...parsed, warnings: [...spec.warnings, ...parsed.warnings] };
  }
  return parse(parseSource);
}

async function parse(source: MockServerSource): Promise<ResolvedMockEndpoints> {
  const bridge = getDesktopMockBridge();
  if (bridge?.parseSpec) return bridge.parseSpec(source);
  const { parseSourceToEndpoints } = await import('@apicircle/mock-server-core/parsing');
  return parseSourceToEndpoints(source);
}
