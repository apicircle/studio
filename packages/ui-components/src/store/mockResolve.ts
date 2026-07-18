// Resolve a MockServerSource to its endpoint table.
//
// `openapi-asset` sources (a spec-typed Global File Asset drives the mock)
// resolve the asset's bytes from IDB into an inline OpenAPI source first, so
// the SAME parser path serves paste-spec mocks, asset-backed "run live"
// (linked) mocks, and "import & edit" (materialized) mocks. On Desktop the
// parse runs in the Node main process (full external-`$ref` resolution); in the
// browser it uses `@apicircle/mock-server-core/parsing` (in-document refs only).

import type { MockEndpoint, MockServerSource, WorkspaceSynced } from '@apicircle/shared';
import { getAttachment } from '../persistence/attachments';
import { getDesktopMockBridge } from '../desktop/bridge';

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
    const record = await getAttachment(asset.slotId);
    if (!record) {
      return {
        endpoints: [],
        warnings: ['The spec asset bytes are not available locally — re-upload the file.'],
      };
    }
    parseSource = {
      kind: 'openapi',
      spec: new TextDecoder().decode(record.bytes),
      format: source.format,
    };
  }

  const bridge = getDesktopMockBridge();
  if (bridge?.parseSpec) return bridge.parseSpec(parseSource);
  const { parseSourceToEndpoints } = await import('@apicircle/mock-server-core/parsing');
  return parseSourceToEndpoints(parseSource);
}
