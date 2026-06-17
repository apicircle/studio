import * as vscode from 'vscode';
import type { EmbeddedMcpHost } from './embeddedMcpHost';

// =============================================================================
// Phase 10 — vscode.lm.registerMcpServerDefinitionProvider integration.
//
// VS Code 1.95+ shipped (initially as a proposed API) a way for extensions
// to register MCP servers directly with VS Code's MCP client surface
// (Copilot Chat, the Agents view, etc.) — no `.vscode/mcp.json` write
// required. The API ships on `vscode.lm` once stabilised; older
// engines / proposed-only builds expose it under different paths.
//
// We probe the runtime ONCE for the registration function — if present,
// register a provider that emits the embedded host's URL + auth so
// Copilot Chat picks up the in-extension server natively. If absent
// (engine ^1.85, no proposed-api opt-in), this is a no-op — the
// .vscode/mcp.json install command from P6 still covers Copilot Chat,
// and external clients still get the snippet/auto-install paths from
// P5/P8.
//
// We do NOT compile against `@types/vscode-proposed` because the engine
// in `package.json` is `^1.85.0` — we'd lock out the majority of users.
// The runtime probe is the right tradeoff: it's structural-typed at
// the call site so future API renames don't crash the extension.
// =============================================================================

interface ProposedLmApi {
  registerMcpServerDefinitionProvider?: (
    id: string,
    provider: {
      onDidChangeMcpServerDefinitions?: vscode.Event<void>;
      provideMcpServerDefinitions: () => Promise<unknown[]> | unknown[];
      resolveMcpServerDefinition?: (server: unknown) => Promise<unknown>;
    },
  ) => vscode.Disposable;
}

/**
 * Best-effort registration of an MCP server definition provider for the
 * embedded host. Returns a Disposable when the API is present, or `null`
 * when it isn't (the caller can ignore null — degradation is silent
 * because we don't want to alarm stable-channel users).
 *
 * Re-call after `host.start()` / `host.restart()` so the definition
 * reflects the current URL + token. (We expose a `refresh()` method on
 * the returned object that re-emits the change event.)
 */
export interface ProposedMcpRegistration extends vscode.Disposable {
  refresh: () => void;
}

export function tryRegisterEmbeddedMcpAsLmProvider(
  host: EmbeddedMcpHost,
  log?: (msg: string) => void,
): ProposedMcpRegistration | null {
  const lm = (vscode as unknown as { lm?: ProposedLmApi }).lm;
  if (!lm?.registerMcpServerDefinitionProvider) {
    log?.(
      'vscode.lm.registerMcpServerDefinitionProvider not available — skipping native registration. (.vscode/mcp.json install still works.)',
    );
    return null;
  }

  const changeEmitter = new vscode.EventEmitter<void>();

  // VS Code 1.94+ requires every provider id passed here to be declared
  // in package.json's `contributes.mcpServerDefinitionProviders`. The
  // manifest entry for "apicircle-embedded" is pinned by the
  // manifestRegression test, but we wrap the call defensively anyway —
  // a future engine bump that tightens the validation further (e.g.
  // schema-checks the definition shape) shouldn't take activation down.
  let disposable: vscode.Disposable;
  try {
    disposable = lm.registerMcpServerDefinitionProvider('apicircle-embedded', {
      onDidChangeMcpServerDefinitions: changeEmitter.event,
      provideMcpServerDefinitions: () => {
        const info = host.info();
        if (!info) return [];
        // Structural shape — VS Code's API stabilisation may rename
        // fields. We emit the canonical Streamable-HTTP shape; if the
        // API evolved, the call returns the closest-matching servers
        // and unknown fields are dropped.
        return [
          {
            label: 'APICircle (embedded)',
            name: 'apicircle-embedded',
            // Streamable-HTTP variant fields:
            url: info.url,
            // Some VS Code builds expect headers in a separate
            // `headers` map instead of a query-string token.
            headers: { Authorization: `Bearer ${info.token}` },
          },
        ];
      },
    });
  } catch (err) {
    changeEmitter.dispose();
    log?.(
      `vscode.lm.registerMcpServerDefinitionProvider threw — skipping native registration: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return null;
  }

  log?.('registered apicircle-embedded as a vscode.lm MCP server definition provider');

  return {
    refresh: () => changeEmitter.fire(),
    dispose: () => {
      try {
        disposable.dispose();
      } catch {
        // ignore
      }
      changeEmitter.dispose();
    },
  };
}
