import type { ApicircleFsProvider } from './fs/apicircleFsProvider';
import type { VsCodeBridge } from './host/vscodeBridge';

// =============================================================================
// Public extension API (0e seam).
//
// `activate()` returns an `ApicircleExtensionApi`, which VS Code exposes as the
// extension's `exports`. A companion extension — e.g. the Enterprise build's
// Endpoint Explorer — declares
//   "extensionDependencies": ["apicircle.apicircle-vscode"]
// and reads it via:
//   const ext = vscode.extensions.getExtension('apicircle.apicircle-vscode');
//   const api = ext?.exports as ApicircleExtensionApi | undefined;
// so it can build on the same workspace bridge + `apicircle://` virtual
// filesystem WITHOUT forking the extension. Open core ships this surface; the
// Enterprise extension is purely additive on top of it.
// =============================================================================

/**
 * Version of the extension's public API contract — independent of the
 * extension's release version. Bump only when the shape of
 * `ApicircleExtensionApi` changes, so a companion extension can gate on a
 * minimum it understands.
 */
export const EXTENSION_API_VERSION = '1.0.0';

/** The object the API Circle extension returns from `activate()`. */
export interface ApicircleExtensionApi {
  /** Contract version — compare against `EXTENSION_API_VERSION`. */
  readonly apiVersion: string;
  /** The active-workspace bridge: read / apply / write, list + switch workspaces. */
  readonly bridge: VsCodeBridge;
  /** The `apicircle://` virtual filesystem provider. */
  readonly fsProvider: ApicircleFsProvider;
}
