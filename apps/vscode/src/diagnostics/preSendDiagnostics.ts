import * as vscode from 'vscode';
import { preSendValidation, buildScope } from '@apicircle/core';
import { parseRequestFromYaml } from '../fs/requestYaml';
import { uriEntityKind } from '../fs/uriKind';
import type { VsCodeBridge } from '../host/vscodeBridge';
import type { Request as ApiRequest } from '@apicircle/shared';

// =============================================================================
// Pre-send validation diagnostics.
//
// Subscribes to text-document changes on apicircle:// URIs. For each request
// YAML the user edits, runs `preSendValidation` from @apicircle/core and
// surfaces the warnings + blockers as `vscode.Diagnostic` entries in the
// Problems panel.
//
// Blockers map to DiagnosticSeverity.Error, warnings to .Warning.
// `apicircle.sendRequest` checks the diagnostic collection at execute time
// when `apicircle.validation.validateOnSend` is true.
// =============================================================================

const COLLECTION_NAME = 'apicircle-validation';

export class PreSendDiagnostics implements vscode.Disposable {
  private readonly collection: vscode.DiagnosticCollection;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly bridge: VsCodeBridge) {
    this.collection = vscode.languages.createDiagnosticCollection(COLLECTION_NAME);
    this.disposables.push(
      this.collection,
      vscode.workspace.onDidOpenTextDocument((doc) => this.lintDocument(doc)),
      vscode.workspace.onDidChangeTextDocument((e) => this.lintDocument(e.document)),
      vscode.workspace.onDidCloseTextDocument((doc) => this.collection.delete(doc.uri)),
    );
    for (const doc of vscode.workspace.textDocuments) this.lintDocument(doc);
  }

  /**
   * Returns true if the URI is an apicircle:// request YAML AND any blockers
   * have been reported for it. Used by the send command to refuse execution
   * when `validateOnSend` is true.
   */
  hasBlocker(uri: vscode.Uri): boolean {
    const diagnostics = this.collection.get(uri) ?? [];
    return diagnostics.some((d) => d.severity === vscode.DiagnosticSeverity.Error);
  }

  /** Force-relint a specific document. Useful after external state changes. */
  lintDocument(doc: vscode.TextDocument): void {
    if (doc.uri.scheme !== 'apicircle') return;
    if (uriEntityKind(doc.uri) !== 'request') return;

    let request: ApiRequest;
    try {
      const parsed = parseRequestFromYaml(doc.getText());
      request = synthesizeRequest(doc.uri, parsed.patch);
    } catch (e) {
      // YAML parse / required-field errors surface as a single blocker
      this.collection.set(doc.uri, [
        new vscode.Diagnostic(
          new vscode.Range(0, 0, 0, 0),
          e instanceof Error ? e.message : String(e),
          vscode.DiagnosticSeverity.Error,
        ),
      ]);
      return;
    }

    const active = this.bridge.activeWorkspace();
    if (!active) {
      this.collection.delete(doc.uri);
      return;
    }

    void this.lintAsync(doc, request);
  }

  private async lintAsync(doc: vscode.TextDocument, request: ApiRequest): Promise<void> {
    const active = this.bridge.activeWorkspace();
    if (!active) return;
    const state = await active.read();

    // Flatten Environment[] -> Record<envName, Record<varName, value>> as
    // buildScope expects, picking only plaintext (unencrypted) values for the
    // diagnostic pass. Encrypted slots are revealed at send-time through
    // the Phase-4 vault flow (`VsCodeVaultManager.decryptValue`); the
    // diagnostic intentionally avoids unlocking the vault for a check.
    const envByName: Record<string, Record<string, string>> = {};
    for (const [name, env] of Object.entries(state.synced.environments.items)) {
      const vars: Record<string, string> = {};
      for (const v of env.variables) {
        if (!v.encrypted) vars[v.key] = v.value;
      }
      envByName[name] = vars;
    }
    const priorityOrder = state.synced.environments.priorityOrder
      .filter((p) => p.kind === 'local')
      .map((p) => (p as { name: string }).name);

    const scope = buildScope({
      contextVars: request.contextVars,
      environments: envByName,
      activeEnvName: state.synced.environments.activeName,
      priorityOrder,
    });

    // Pass `folders` so the validator resolves `auth: inherit` against the
    // folder chain — catches empty-token / empty-key folder auth before send
    // instead of letting it fail on the wire.
    const verdicts = preSendValidation({
      request,
      scope,
      folders: state.synced.collections.folders,
    });
    const diagnostics: vscode.Diagnostic[] = [];
    const range = new vscode.Range(0, 0, 0, 0);

    for (const w of verdicts.warnings) {
      diagnostics.push(
        new vscode.Diagnostic(range, `[${w.kind}] ${w.message}`, vscode.DiagnosticSeverity.Warning),
      );
    }
    for (const b of verdicts.blockers) {
      diagnostics.push(
        new vscode.Diagnostic(range, `[${b.kind}] ${b.message}`, vscode.DiagnosticSeverity.Error),
      );
    }
    this.collection.set(doc.uri, diagnostics);
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}

function synthesizeRequest(
  uri: vscode.Uri,
  patch: ReturnType<typeof parseRequestFromYaml>['patch'],
): ApiRequest {
  // The parsed YAML omits read-only fields; we synthesize the missing ones so
  // `preSendValidation` receives a full Request shape.
  const idMatch = uri.path.match(/\/requests\/([^.]+)/);
  const id = idMatch ? idMatch[1] : 'unknown';
  return {
    id,
    name: patch.name ?? '',
    folderId: null,
    method: patch.method ?? 'GET',
    url: patch.url ?? '',
    headers: patch.headers ?? [],
    query: patch.query ?? [],
    cookies: patch.cookies,
    pathParams: patch.pathParams,
    body: patch.body ?? { type: 'none', content: '' },
    auth: patch.auth ?? { type: 'none' },
    contextVars: patch.contextVars ?? [],
    extractions: patch.extractions ?? [],
    assertions: patch.assertions ?? [],
    createdAt: '',
    updatedAt: '',
  };
}
